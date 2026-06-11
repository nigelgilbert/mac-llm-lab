// Issue #023: duplicate-run_id invariant in the paired-run gate
// (scripts/config-ab-pairing-check.mjs). Nothing downstream dedupes run_id —
// paired_bootstrap counts every row — so a duplicated registry line silently
// inflates per-task N and sails through every other gate green. The gate is
// the natural home for the invariant: a duplicated run_id within the
// (treatment, baseline, tier) scope turns the check RED, naming the run_id
// and the 1-based registry line numbers.
//
// Red output shape (stderr, exit 1) — pinned here because the driver and any
// log-grepping tooling see it:
//   FAIL: <n> run_id(s) appear on multiple registry lines within scope (treatment=X, baseline=Y, tier=Z) — duplicate rows silently inflate per-task N:
//     run_id=<id> lines <a>, <b>[, ...]
//
// The script calls main() at import time, so it is exercised as a subprocess
// (process.execPath) rather than imported — same pattern as
// harvest-config-id.test.js.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'config-ab-pairing-check.mjs');

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// Minimal eligible registry row as the gate (via lib/registry.js readRegistry,
// lib/paired_bootstrap.js summarizeTasks/isEligible) consumes it.
function row(configId, testId, runId, { tier = 16, passed = true } = {}) {
  return {
    run_id: runId,
    config_id: configId,
    hardware_tier: tier,
    test_id: testId,
    terminal_status: 'done',
    passed,
  };
}

// A green two-config, two-task registry: every cell eligible on both sides.
function greenRows() {
  return [
    row('claw-rig', 'task-a', 'b-a-1'),
    row('claw-rig', 'task-a', 'b-a-2', { passed: false }),
    row('claw-rig', 'task-b', 'b-b-1'),
    row('opencode-a', 'task-a', 't-a-1'),
    row('opencode-a', 'task-a', 't-a-2'),
    row('opencode-a', 'task-b', 't-b-1', { passed: false }),
  ];
}

function writeRegistry(rowsOrText) {
  const dir = makeTmp('pairing-check-');
  const p = path.join(dir, 'run_registry.jsonl');
  const text = typeof rowsOrText === 'string'
    ? rowsOrText
    : rowsOrText.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(p, text);
  return p;
}

function runGate(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('config-ab-pairing-check duplicate-run_id invariant (issue #023)', () => {
  it('unique run_ids → green, with an explicit uniqueness OK line', () => {
    const reg = writeRegistry(greenRows());
    const { status, stdout, stderr } = runGate([reg, '--tier', '16']);
    assert.equal(status, 0, `gate must pass:\n${stdout}\n${stderr}`);
    assert.match(stdout, /run_id uniqueness: OK/);
    assert.match(stdout, /PASS/);
  });

  it('duplicated run_id within scope → exit 1 naming the run_id and line numbers', () => {
    const rows = greenRows();
    rows.push(row('opencode-a', 'task-a', 't-a-1')); // duplicate of line 4 → line 7
    const reg = writeRegistry(rows);
    const { status, stdout, stderr } = runGate([reg, '--tier', '16']);
    assert.equal(status, 1, `gate must fail on duplicate:\n${stdout}\n${stderr}`);
    assert.match(stderr, /FAIL: 1 run_id\(s\) appear on multiple registry lines within scope/);
    assert.match(stderr, /treatment=opencode-a, baseline=claw-rig, tier=16/);
    assert.match(stderr, /run_id=t-a-1 lines 4, 7/);
  });

  it('line numbers are FILE line numbers (blank lines do not shift the report)', () => {
    const rows = greenRows();
    // line 1..6 green rows, line 7 blank, line 8 the duplicate of line 1.
    const text = rows.map((r) => JSON.stringify(r)).join('\n')
      + '\n\n'
      + JSON.stringify(row('claw-rig', 'task-a', 'b-a-1'))
      + '\n';
    const reg = writeRegistry(text);
    const { status, stderr } = runGate([reg, '--tier', '16']);
    assert.equal(status, 1);
    assert.match(stderr, /run_id=b-a-1 lines 1, 8/);
  });

  it('duplicate OUTSIDE the (treatment, baseline) pair scope does not redden this pair', () => {
    const rows = greenRows();
    // Third valid config, duplicated — out of scope for the default
    // opencode-a vs claw-rig pair (gating is per (arm, BASELINE) pair).
    rows.push(row('opencode-a+git', 'task-a', 'g-a-1'));
    rows.push(row('opencode-a+git', 'task-a', 'g-a-1'));
    const reg = writeRegistry(rows);
    const { status, stdout, stderr } = runGate([reg, '--tier', '16']);
    assert.equal(status, 0, `out-of-scope duplicate must not fail this pair:\n${stdout}\n${stderr}`);
    // ... but gating the pair that CONTAINS the duplicate goes red.
    const gitPair = runGate([reg, '--tier', '16', '--treatment', 'opencode-a+git', '--baseline', 'claw-rig']);
    assert.equal(gitPair.status, 1);
    assert.match(gitPair.stderr, /run_id=g-a-1 lines 7, 8/);
  });

  it('duplicate at ANOTHER tier does not redden a --tier-scoped check', () => {
    const rows = greenRows();
    rows.push(row('opencode-a', 'task-a', 'other-tier-dup', { tier: 64 }));
    rows.push(row('opencode-a', 'task-a', 'other-tier-dup', { tier: 64 }));
    rows.push(row('claw-rig', 'task-a', 'b64-1', { tier: 64 }));
    const reg = writeRegistry(rows);
    const t16 = runGate([reg, '--tier', '16']);
    assert.equal(t16.status, 0, `tier-16 scope must stay green:\n${t16.stdout}\n${t16.stderr}`);
    const t64 = runGate([reg, '--tier', '64']);
    assert.equal(t64.status, 1, 'tier-64 scope must go red on its own duplicate');
    assert.match(t64.stderr, /run_id=other-tier-dup lines 7, 8/);
  });
});
