// Issue #023: idempotent harvest + strict --since validation for
// scripts/harvest-runs-to-registry.mjs. The harvester is not transactional —
// it can exit 1 mid-stream after some rows already appended, inviting an
// operator retry — and it used to re-append a row for EVERY run on a re-run
// over the same --runtime-root, silently inflating per-task N downstream
// (nothing in the chain dedupes run_id). These tests pin the fix:
//
//   1. Harvest twice over the same runtime-root → the registry holds zero
//      duplicate run_ids; the second run appends nothing and reports each
//      pre-existing run as `skipped: already_in_registry`.
//   2. A non-numeric --since exits 2 with a message and harvests nothing
//      (it used to parse to NaN and silently DISABLE the filter, harvesting
//      everything).
//   3. A numeric --since still filters by run_started_ms (regression guard).
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
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'harvest-runs-to-registry.mjs');

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

const TEST_ID = 'harvest-fixture';
const MODEL_CONFIG_ID = 'test-config-001';

// Fixture world mirroring harvest-config-id.test.js, but with TWO completed
// runs (distinct run_ids and run_started_ms) so re-harvest and --since
// filtering are observable.
function makeFixture() {
  const root = makeTmp('harvest-idem-');

  const manifestPath = path.join(root, 'model_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    [MODEL_CONFIG_ID]: {
      model_config_id: MODEL_CONFIG_ID,
      model_id: 'test/model@rev',
      model_family: 'test',
      quantization: 'Q4_K_M',
      context_limit: 8192,
      runtime_backend: 'llama-server@test',
      sampler_config_id: 'sampler-001',
      harness_version: 'h-test',
      prompt_pack_version: 'pp-test',
    },
  }));

  const runtimeRoot = path.join(root, 'runtime');
  const runs = [
    { runId: 'run-0001', startedMs: 1781000000000 },
    { runId: 'run-0002', startedMs: 1781000200000 },
  ];
  for (const { runId, startedMs } of runs) {
    const runDir = path.join(runtimeRoot, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run_summary.json'), JSON.stringify({
      schema_version: 1,
      run_id: runId,
      test_id: TEST_ID,
      run_started_ms: startedMs,
      run_finished_ms: startedMs + 60000,
      run_elapsed_ms: 60000,
      terminal_status: 'done',
      passed: null,
      timeout: false,
      exit_code: 0,
    }));
    fs.writeFileSync(path.join(runDir, 'assertion_result.json'), JSON.stringify({ passed: true }));
    fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), `${JSON.stringify({ iter: 1 })}\n`);
  }

  const testsDir = path.join(root, 'tests');
  fs.mkdirSync(testsDir);
  fs.writeFileSync(path.join(testsDir, `${TEST_ID}.test.js`), `
/** @manifest
 * {
 *   "test_id": "${TEST_ID}",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "fixture only"
 * }
 */
`);

  const ctxPath = path.join(root, 'ctx.json');
  fs.writeFileSync(ctxPath, JSON.stringify({
    run_kind: 'smoke',
    hardware_tier: 16,
    memory_gb: 16,
    model_config_id: MODEL_CONFIG_ID,
    harness_version: 'h-test',
    manifestPath,
  }));

  const registryPath = path.join(root, 'out_registry.jsonl');
  return { runtimeRoot, testsDir, ctxPath, registryPath };
}

function runHarvester(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function baseArgs(fx) {
  return [
    '--runtime-root', fx.runtimeRoot,
    '--tests-dir', fx.testsDir,
    '--ctx', fx.ctxPath,
    '--registry', fx.registryPath,
    '--config-id', 'opencode-a',
  ];
}

function readRows(registryPath) {
  if (!fs.existsSync(registryPath)) return [];
  return fs.readFileSync(registryPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('harvest-runs-to-registry idempotency (issue #023)', () => {
  it('harvest twice over the same runtime-root → zero duplicate run_ids; second run reports skips', () => {
    const fx = makeFixture();

    const first = runHarvester(baseArgs(fx));
    assert.equal(first.status, 0, `first harvest must succeed, stdout:\n${first.stdout}\n${first.stderr}`);
    const rowsAfterFirst = readRows(fx.registryPath);
    assert.equal(rowsAfterFirst.length, 2, 'first harvest appends both runs');

    const second = runHarvester(baseArgs(fx));
    assert.equal(second.status, 0, `second harvest must succeed, stdout:\n${second.stdout}\n${second.stderr}`);
    const rowsAfterSecond = readRows(fx.registryPath);
    assert.equal(rowsAfterSecond.length, 2, 'second harvest must append NOTHING');

    const runIds = rowsAfterSecond.map((r) => r.run_id);
    assert.equal(new Set(runIds).size, runIds.length, 'zero duplicate run_ids');

    assert.match(second.stdout, /skip {2}run-0001 \(skipped: already_in_registry\)/);
    assert.match(second.stdout, /skip {2}run-0002 \(skipped: already_in_registry\)/);
    assert.match(second.stdout, /appended=0/);
    assert.match(second.stdout, /already_in_registry=2/);
  });

  it('a partial registry (mid-stream exit, operator retry) is topped up without re-appending', () => {
    const fx = makeFixture();

    // Simulate the mid-stream-failure shape: run-0001 already landed.
    const solo = runHarvester([...baseArgs(fx), '--run-id', 'run-0001']);
    assert.equal(solo.status, 0, `single-run harvest must succeed:\n${solo.stdout}\n${solo.stderr}`);
    assert.equal(readRows(fx.registryPath).length, 1);

    // The retry harvests the whole root: appends ONLY the missing run.
    const retry = runHarvester(baseArgs(fx));
    assert.equal(retry.status, 0);
    const rows = readRows(fx.registryPath);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.run_id).sort(), ['run-0001', 'run-0002']);
    assert.match(retry.stdout, /skip {2}run-0001 \(skipped: already_in_registry\)/);
    assert.match(retry.stdout, /appended=1/);
  });
});

describe('harvest-runs-to-registry --since validation (issue #023)', () => {
  it('--since notanumber → exit 2 with a message, nothing harvested', () => {
    const fx = makeFixture();
    const { status, stderr } = runHarvester([...baseArgs(fx), '--since', 'notanumber']);
    assert.equal(status, 2, 'non-numeric --since must exit 2');
    assert.match(stderr, /--since "notanumber" is not a finite number/);
    assert.equal(readRows(fx.registryPath).length, 0, 'must not harvest anything');
  });

  it('numeric --since still filters by run_started_ms (regression guard)', () => {
    const fx = makeFixture();
    // Between the two fixture runs' run_started_ms values.
    const { status, stdout } = runHarvester([...baseArgs(fx), '--since', '1781000100000']);
    assert.equal(status, 0, `harvest must succeed:\n${stdout}`);
    const rows = readRows(fx.registryPath);
    assert.equal(rows.length, 1, 'only the run at/after --since is harvested');
    assert.equal(rows[0].run_id, 'run-0002');
  });
});
