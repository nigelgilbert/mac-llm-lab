// #006 (secondary): a swallowed per-cell registry emit failure must fail the
// cell's rc, not ride stderr-only. writeAssertionResult's emit catch
// (lib/registry_emit.js) sets process.exitCode = 1 — the reporter runs in the
// `node --test` parent process and node:test only ever RAISES the exit code,
// so the cell's process exits nonzero and the driver's ARMS_RC / exit path
// (#003) turns the sweep red. These tests pin:
//   - the catch path (emit throws) sets process.exitCode = 1 and does NOT throw;
//   - the flag-off path (RUN_REGISTRY_EMIT unset) leaves exitCode alone.
// process.exitCode and the env are captured/restored so the suite's own
// verdict is not polluted by the deliberate failure.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeAssertionResult } from '../../lib/registry_emit.js';
import { isEligible } from '../../lib/paired_bootstrap.js';

const tmpdirs = [];
function makeRunDir({ summary }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-emit-fail-'));
  tmpdirs.push(d);
  if (summary !== undefined) fs.writeFileSync(path.join(d, 'run_summary.json'), summary);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

function withEmitEnv(fn) {
  const priorEmit = process.env.RUN_REGISTRY_EMIT;
  const priorExitCode = process.exitCode;
  try {
    return fn();
  } finally {
    if (priorEmit === undefined) delete process.env.RUN_REGISTRY_EMIT;
    else process.env.RUN_REGISTRY_EMIT = priorEmit;
    process.exitCode = priorExitCode;
  }
}

describe('writeAssertionResult emit-failure rc (#006)', () => {
  it('a throwing emit sets process.exitCode = 1 without throwing', () => {
    withEmitEnv(() => {
      process.env.RUN_REGISTRY_EMIT = '1';
      process.exitCode = 0;
      // Malformed run_summary.json → JSON.parse throws inside
      // maybeEmitRegistryRow → the emit catch runs.
      const runDir = makeRunDir({ summary: '{not json' });
      assert.doesNotThrow(() => writeAssertionResult(runDir, { passed: true }));
      assert.equal(process.exitCode, 1);
      // The sidecar itself still landed (the assertion write precedes the emit).
      assert.ok(fs.existsSync(path.join(runDir, 'assertion_result.json')));
    });
  });

  it('with RUN_REGISTRY_EMIT unset the emit path never runs and exitCode is untouched', () => {
    withEmitEnv(() => {
      delete process.env.RUN_REGISTRY_EMIT;
      process.exitCode = 0;
      const runDir = makeRunDir({ summary: '{not json' });
      writeAssertionResult(runDir, { passed: true });
      assert.equal(process.exitCode, 0);
    });
  });

  // #024 part 1a: the ASSERTION-SIDECAR write catch (not just the emit catch)
  // must fail the cell's rc — without the sidecar the row degrades to
  // done/passed:null and silently shrinks the analysis denominator.
  it('a failing assertion-sidecar write sets process.exitCode = 1 without throwing (emit off)', () => {
    withEmitEnv(() => {
      delete process.env.RUN_REGISTRY_EMIT;
      process.exitCode = 0;
      const runDir = makeRunDir({});
      // A DIRECTORY squatting on the sidecar path → writeFileSync throws EISDIR.
      fs.mkdirSync(path.join(runDir, 'assertion_result.json'));
      assert.doesNotThrow(() => writeAssertionResult(runDir, { passed: true }));
      assert.equal(process.exitCode, 1);
    });
  });
});

// --- #024 part 1b: end-to-end emit path in a CHILD process ------------------
// REGISTRY_PATH / MODEL_CONFIG_MANIFEST_PATH are read at module-load time, so
// the full writeAssertionResult → maybeEmitRegistryRow → emitRow path runs in
// a child node with the env prepared — which also makes the rc assertion REAL
// (the actual process exit code, not a restored process.exitCode).

const EMIT_URL = pathToFileURL(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/registry_emit.js',
)).href;

const MODEL_CONFIG_ID = 'test-config-024';

function writeModelManifest() {
  const p = path.join(makeRunDir({}), 'model_configs.json');
  fs.writeFileSync(p, JSON.stringify({
    [MODEL_CONFIG_ID]: {
      model_config_id: MODEL_CONFIG_ID,
      model_id: 'test/model@rev',
      model_family: 'test',
      quantization: 'IQ4_XS',
      context_limit: 65536,
      runtime_backend: 'llama-server@test',
      sampler_config_id: 'sampler-001',
      harness_version: 'h-test',
      prompt_pack_version: 'pp-test',
    },
  }));
  return p;
}

function writeTestsDir() {
  const d = makeRunDir({});
  fs.writeFileSync(path.join(d, 'expression-eval.test.js'), `/** @manifest
 * { "test_id": "expression-eval", "test_version": "v1",
 *   "primary_axis": "spec_precision", "suite_layer": "B",
 *   "difficulty_band": "hard", "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Never drop — fixture for registry-emit-failure tests." }
 */
`);
  return d;
}

function writeEmitRunDir({ summary, sidecarWriteFails = false, assertion = null }) {
  const runDir = makeRunDir({ summary: JSON.stringify(summary, null, 2) + '\n' });
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
  if (sidecarWriteFails) fs.mkdirSync(path.join(runDir, 'assertion_result.json'));
  if (assertion) {
    fs.writeFileSync(path.join(runDir, 'assertion_result.json'), JSON.stringify(assertion) + '\n');
  }
  return runDir;
}

function summaryBase(runId, overrides = {}) {
  return {
    schema_version: 1,
    run_id: runId,
    test_id: 'expression-eval',
    run_started_ms: 1781000000000,
    run_finished_ms: 1781000600000,
    run_elapsed_ms: 600000,
    iter_count: 0,
    terminal_status: 'done',
    passed: null,
    timeout: false,
    exit_code: 0,
    ...overrides,
  };
}

function runEmitChild({ runDir, registryPath, payload }) {
  const script =
    `import { writeAssertionResult } from ${JSON.stringify(EMIT_URL)};\n` +
    'writeAssertionResult(process.env.X_RUN_DIR, JSON.parse(process.env.X_PAYLOAD));\n';
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RUN_REGISTRY_EMIT: '1',
      RUN_REGISTRY_PATH: registryPath,
      RUN_REGISTRY_TESTS_DIR: writeTestsDir(),
      RUN_REGISTRY_MODEL_CONFIG_ID: MODEL_CONFIG_ID,
      MODEL_CONFIG_MANIFEST_PATH: writeModelManifest(),
      RUN_REGISTRY_HARDWARE_TIER: '16',
      RUN_REGISTRY_MEMORY_GB: '16',
      CONFIG: 'opencode-a',
      X_RUN_DIR: runDir,
      X_PAYLOAD: JSON.stringify(payload),
    },
  });
}

function readRows(registryPath) {
  if (!fs.existsSync(registryPath)) return [];
  return fs.readFileSync(registryPath, 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe('#024 assertion-emit-failed stamping (child-process emit path)', () => {
  it('done run + failed sidecar write → exit 1 AND row harness_error=assertion_emit_failed (ineligible)', () => {
    const registryPath = path.join(makeRunDir({}), 'registry.jsonl');
    const runDir = writeEmitRunDir({
      summary: summaryBase('run-024-a'),
      sidecarWriteFails: true,
    });
    const child = runEmitChild({ runDir, registryPath, payload: { passed: true } });
    assert.equal(child.status, 1, `child must exit 1 (stderr: ${child.stderr})`);
    assert.match(child.stderr, /writeAssertionResult failed/);
    const rows = readRows(registryPath);
    assert.equal(rows.length, 1, `expected one emitted row (stderr: ${child.stderr})`);
    const row = rows[0];
    assert.equal(row.run_id, 'run-024-a');
    assert.equal(row.terminal_status, 'done');
    assert.equal(row.passed, null);
    assert.equal(row.harness_error, 'assertion_emit_failed');
    // The existing eligibility predicate already excludes it (passed is not
    // boolean) — the stamp makes the exclusion visible, not silent.
    assert.equal(isEligible(row), false);
  });

  it('done run + healthy sidecar write → exit 0, row carries the verdict, NOT stamped', () => {
    const registryPath = path.join(makeRunDir({}), 'registry.jsonl');
    const runDir = writeEmitRunDir({ summary: summaryBase('run-024-b') });
    const child = runEmitChild({ runDir, registryPath, payload: { passed: true } });
    assert.equal(child.status, 0, `child must exit 0 (stderr: ${child.stderr})`);
    const [row] = readRows(registryPath);
    assert.equal(row.run_id, 'run-024-b');
    assert.equal(row.terminal_status, 'done');
    assert.equal(row.passed, true);
    assert.equal(row.harness_error, null);
    assert.equal(isEligible(row), true);
  });

  it('interrupted run + failed sidecar write → exit 1 but NOT stamped (passed:null is its normal shape)', () => {
    const registryPath = path.join(makeRunDir({}), 'registry.jsonl');
    const runDir = writeEmitRunDir({
      summary: summaryBase('run-024-c', { terminal_status: 'interrupted', exit_code: null }),
      sidecarWriteFails: true,
    });
    const child = runEmitChild({ runDir, registryPath, payload: { passed: false } });
    assert.equal(child.status, 1, `child must exit 1 (stderr: ${child.stderr})`);
    const [row] = readRows(registryPath);
    assert.equal(row.terminal_status, 'interrupted');
    assert.equal(row.passed, null);
    assert.equal(row.harness_error, null);
    assert.equal(isEligible(row), false);
  });

  it("promotes the sidecar's typed harness_error (runAgent post_script_spawn_failed relabel) onto the row", () => {
    const registryPath = path.join(makeRunDir({}), 'registry.jsonl');
    const runDir = writeEmitRunDir({
      summary: summaryBase('run-024-d', {
        terminal_status: 'harness_error',
        harness_error: 'post_script_spawn_failed',
        harness_error_detail: 'status=null, error=spawn node ENOENT',
      }),
    });
    // node:test marked the test failed (typed harness-error throw), so the
    // reporter's payload says passed:false — the row must still read null.
    const child = runEmitChild({ runDir, registryPath, payload: { passed: false } });
    assert.equal(child.status, 0, `child must exit 0 (stderr: ${child.stderr})`);
    const [row] = readRows(registryPath);
    assert.equal(row.terminal_status, 'harness_error');
    assert.equal(row.passed, null);
    assert.equal(row.harness_error, 'post_script_spawn_failed');
    assert.equal(isEligible(row), false);
  });
});
