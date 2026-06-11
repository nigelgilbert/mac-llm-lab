// Unit tests for scripts/expected-attempts.mjs.
//
// Part 1 — the isEmitEligible heuristic: a regex
// (`\b(runAgent|writeAssertionResult)\b`) applied to the raw test source.
// Failure mode if it goes wrong: a Family C test gets falsely marked eligible
// (over-emission, surfaces as missing cells in the post-sweep diff) or a real
// call goes unmatched (under-emission, silent). These tests pin the cases the
// regex must handle so a future tweak can't silently regress them.
//
// Part 2 — the plan/diff CLI as wired into run-config-ab.sh (#003): the plan
// carries the config (arm) dimension, the diff keys on the full
// (test, tier, config, rep) tuple and names missing cells, and --since-line
// implements the REUSE_ROWS fresh-row watermark. Driven via spawnSync of the
// real CLI so the argv contract the driver uses is what's pinned.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEmitEligible } from '../../scripts/expected-attempts.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/expected-attempts.mjs',
);

const tmpdirs = [];
function writeFixture(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-attempts-'));
  tmpdirs.push(d);
  const p = path.join(d, name);
  fs.writeFileSync(p, body);
  return p;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('isEmitEligible', () => {
  it('matches a runAgent call (the lib/runAgent.js helper path)', () => {
    const p = writeFixture('a.test.js', `
      import { runAgent } from '../../lib/runAgent.js';
      describe('x', () => {
        it('y', { timeout: 60_000 }, async (t) => {
          const ctx = await runAgent({ prompt: 'p', testId: 'x', t, clawTimeoutMs: 60_000 });
        });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });

  it('matches a writeAssertionResult call (direct-runner opt-out path)', () => {
    const p = writeFixture('b.test.js', `
      import { runOpenCode } from '../../lib/opencode.js';
      import { writeAssertionResult } from '../../lib/registry_emit.js';
      it('z', async ({ signal }) => {
        const r = await runOpenCode({ prompt: 'p', signal, timeoutMs: 60_000 });
        writeAssertionResult(r.runDir, { passed: true });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });

  it('does not match a file with no mention of either entry point (Family C shape)', () => {
    const p = writeFixture('c.test.js', `
      import { streamMessage } from '../../lib/stream.js';
      it('latency', async () => {
        await streamMessage({ prompt: 'p' });
      });
    `);
    assert.equal(isEmitEligible(p), false);
  });

  it('does not falsely match similar identifiers (runAgentSetup, writeAssertionResultV2)', () => {
    // The regex uses \b boundaries — these longer identifiers must not match
    // the bare names. Pin it: if someone drops the \b, this trips.
    const p = writeFixture('d.test.js', `
      import { runAgentSetup } from '../../lib/legacy.js';
      import { writeAssertionResultV2 } from '../../lib/v2.js';
      it('legacy', async () => {
        await runAgentSetup({});
        writeAssertionResultV2({});
      });
    `);
    assert.equal(isEmitEligible(p), false);
  });

  // Known limitation: the regex matches mentions in comments/strings. Today
  // no test file does this, but if the eligibility check is ever tightened
  // (e.g. to skip comment lines), flip this assertion to `false`.
  it('matches a bare-name mention in a comment (current behavior — known limitation)', () => {
    const p = writeFixture('e.test.js', `
      // previously used runAgent, now migrated to streamMessage
      import { streamMessage } from '../../lib/stream.js';
      it('latency', async () => {
        await streamMessage({ prompt: 'p' });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });
});

// ---------------------------------------------------------------------------
// plan / diff CLI — the #003 driver wiring contract.
// ---------------------------------------------------------------------------

function runCli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function row(test_id, tier, config_id) {
  return JSON.stringify({ test_id, hardware_tier: tier, config_id });
}

describe('plan/diff CLI (#003 run-config-ab.sh wiring)', () => {
  // One shared tests-dir: two emit-eligible stems + one Family C stem.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-attempts-cli-'));
  tmpdirs.push(dir);
  const testsDir = path.join(dir, 'tier-eval');
  fs.mkdirSync(testsDir);
  fs.writeFileSync(path.join(testsDir, 'alpha.test.js'),
    `import { runAgent } from '../../lib/runAgent.js';\nrunAgent({});\n`);
  fs.writeFileSync(path.join(testsDir, 'beta.test.js'),
    `import { writeAssertionResult } from '../../lib/registry_emit.js';\nwriteAssertionResult('x', {});\n`);
  fs.writeFileSync(path.join(testsDir, 'famc.test.js'),
    `import { streamMessage } from '../../lib/stream.js';\nstreamMessage({});\n`);

  const planArgs = (out, extra = []) => [
    'plan', '--tests-dir', testsDir, '--tiers', '64',
    '--configs', 'opencode-a opencode-a+git', '--reps', '2', '--out', out, ...extra,
  ];

  it('plan writes (test × tier × config × rep) cells with the 4-column header', () => {
    const out = path.join(dir, 'plan.csv');
    const r = runCli(planArgs(out));
    assert.equal(r.status, 0, r.stderr);
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines[0], 'test_id,hardware_tier,config_id,rep_index');
    // 2 eligible tests × 1 tier × 2 configs × 2 reps = 8 cells (famc excluded).
    assert.equal(lines.length - 1, 8);
    assert.ok(lines.includes('alpha,64,opencode-a,1'));
    assert.ok(lines.includes('beta,64,opencode-a+git,2'));
    assert.ok(!lines.some((l) => l.startsWith('famc,')));
  });

  it('plan rejects a --filter stem that is not emit-eligible (Family C preflight)', () => {
    const r = runCli(planArgs(path.join(dir, 'plan-bad.csv'), ['--filter', 'famc']));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /famc/);
    assert.match(r.stderr, /not emit-eligible/);
  });

  it('plan requires --configs', () => {
    const r = runCli([
      'plan', '--tests-dir', testsDir, '--tiers', '64', '--reps', '1',
      '--out', path.join(dir, 'plan-noconfigs.csv'),
    ]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--configs required/);
  });

  // A complete fresh registry for the 8-cell plan above.
  const fullRows = [];
  for (const config of ['opencode-a', 'opencode-a+git']) {
    for (const test of ['alpha', 'beta']) {
      fullRows.push(row(test, 64, config), row(test, 64, config)); // 2 reps
    }
  }

  it('diff exits 0 when every planned cell has a row', () => {
    const out = path.join(dir, 'plan-diff.csv');
    assert.equal(runCli(planArgs(out)).status, 0);
    const reg = path.join(dir, 'reg-full.jsonl');
    fs.writeFileSync(reg, fullRows.join('\n') + '\n');
    const r = runCli(['diff', '--expected', out, '--registry', reg]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /missing: {2}0 cells/);
  });

  it('diff exits 1 and names the (task, config, rep) cell when a row is lost', () => {
    const out = path.join(dir, 'plan-diff.csv');
    const reg = path.join(dir, 'reg-short.jsonl');
    // Drop ONE beta×(+git) row: rep 2 of that cell goes missing.
    const short = fullRows.filter((l, i) => i !== fullRows.length - 1);
    fs.writeFileSync(reg, short.join('\n') + '\n');
    const r = runCli(['diff', '--expected', out, '--registry', reg]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing: {2}1 cells/);
    assert.match(r.stdout, /beta config=opencode-a\+git tier=64 rep=2/);
  });

  it('diff scopes a missing arm to its own config (other arm stays satisfied)', () => {
    const out = path.join(dir, 'plan-diff.csv');
    const reg = path.join(dir, 'reg-onearm.jsonl');
    // Only the opencode-a arm emitted; every +git cell must be named, no
    // opencode-a cell may be (the pre-#003 tier-keyed diff would have
    // half-credited the missing arm from the present one's rows).
    const oneArm = fullRows.filter((l) => !l.includes('opencode-a+git'));
    fs.writeFileSync(reg, oneArm.join('\n') + '\n');
    const r = runCli(['diff', '--expected', out, '--registry', reg]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing: {2}4 cells/);
    assert.match(r.stdout, /alpha config=opencode-a\+git tier=64 rep=1/);
    assert.ok(!/config=opencode-a tier/.test(r.stdout));
  });

  it('diff --since-line audits only fresh rows (REUSE_ROWS watermark)', () => {
    const out = path.join(dir, 'plan-diff.csv');
    const reg = path.join(dir, 'reg-reuse.jsonl');
    // 3 pre-existing baseline rows (the watermark), then this sweep's rows.
    const stale = [row('alpha', 64, 'claw-rig'), row('alpha', 64, 'opencode-a'), row('beta', 64, 'opencode-a')];
    fs.writeFileSync(reg, stale.concat(fullRows).join('\n') + '\n');
    const fresh = runCli(['diff', '--expected', out, '--registry', reg, '--since-line', '3']);
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    // Without the watermark the stale opencode-a rows over-fill that arm's
    // plan → over-emission → nonzero. Pins that REUSE_ROWS *needs* the
    // watermark rather than silently double-counting.
    const unwatermarked = runCli(['diff', '--expected', out, '--registry', reg]);
    assert.equal(unwatermarked.status, 1);
    assert.match(unwatermarked.stdout, /over-emission/);
  });

  it('diff treats a missing registry file as all cells missing', () => {
    const out = path.join(dir, 'plan-diff.csv');
    const r = runCli(['diff', '--expected', out, '--registry', path.join(dir, 'nope.jsonl')]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing: {2}8 cells/);
  });
});
