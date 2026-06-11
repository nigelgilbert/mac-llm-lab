// Issue #009: harvester config_id provenance. The offline recovery harvester
// (scripts/harvest-runs-to-registry.mjs) used to omit config_id entirely,
// letting assembleRow's old 'claw-rig' default silently stamp recovered
// opencode runs as the historical claw baseline. These tests pin the fix:
//
//   1. --config-id is REQUIRED: invocation without it exits nonzero and prints
//      usage naming the flag.
//   2. --config-id is validated against lib/config.js VALID_CONFIGS: an
//      out-of-enum value exits nonzero naming the enum.
//   3. With --config-id <arm>, every emitted row carries that label verbatim —
//      and in particular is NOT 'claw-rig'.
//   4. A config_id inside the --ctx JSON that conflicts with the flag is
//      refused (the flag is the single source of the label).
//
// The script calls main() at import time, so it is exercised as a subprocess
// (process.execPath) rather than imported.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_CONFIGS } from '../../lib/config.js';

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

// One self-contained fixture world: a runtime root holding a single completed
// run sidecar, a tests dir with a matching @manifest header, a model-config
// manifest, and a ctx JSON. Mirrors exactly what runOpenCode leaves on disk
// (run_summary.json / iterations.jsonl / assertion_result.json).
function makeFixture({ ctxExtra = {} } = {}) {
  const root = makeTmp('harvest-cid-');

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
  const runId = 'run-0001';
  const runDir = path.join(runtimeRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run_summary.json'), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    test_id: TEST_ID,
    run_started_ms: 1781000000000,
    run_finished_ms: 1781000060000,
    run_elapsed_ms: 60000,
    terminal_status: 'done',
    passed: null,
    timeout: false,
    exit_code: 0,
  }));
  fs.writeFileSync(path.join(runDir, 'assertion_result.json'), JSON.stringify({ passed: true }));
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), `${JSON.stringify({ iter: 1 })}\n`);

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
    ...ctxExtra,
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
  ];
}

function readRows(registryPath) {
  if (!fs.existsSync(registryPath)) return [];
  return fs.readFileSync(registryPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('harvest-runs-to-registry --config-id (issue #009)', () => {
  it('exits nonzero with usage when --config-id is missing', () => {
    const fx = makeFixture();
    const { status, stderr } = runHarvester(baseArgs(fx));
    assert.notEqual(status, 0, 'must exit nonzero without --config-id');
    assert.match(stderr, /--config-id required/);
    assert.match(stderr, /Usage: node harvest-runs-to-registry\.mjs/);
    assert.equal(readRows(fx.registryPath).length, 0, 'must not emit any row');
  });

  it('exits nonzero when --config-id is not in VALID_CONFIGS', () => {
    const fx = makeFixture();
    const { status, stderr } = runHarvester([...baseArgs(fx), '--config-id', 'bogus-rig']);
    assert.notEqual(status, 0, 'must exit nonzero on out-of-enum --config-id');
    assert.match(stderr, /not in VALID_CONFIGS/);
    for (const c of VALID_CONFIGS) {
      assert.ok(stderr.includes(c), `usage must list valid config "${c}"`);
    }
    assert.equal(readRows(fx.registryPath).length, 0, 'must not emit any row');
  });

  it('stamps every emitted row with the declared --config-id (never claw-rig by omission)', () => {
    const fx = makeFixture();
    const { status, stdout } = runHarvester([...baseArgs(fx), '--config-id', 'opencode-a+prompt']);
    assert.equal(status, 0, `harvest must succeed, stdout:\n${stdout}`);
    const rows = readRows(fx.registryPath);
    assert.equal(rows.length, 1, 'exactly one harvested row');
    assert.equal(rows[0].config_id, 'opencode-a+prompt');
    assert.equal(rows[0].test_id, TEST_ID);
    assert.equal(rows[0].passed, true);
    assert.ok(!rows.some((r) => r.config_id === 'claw-rig'), 'no row may be labeled claw-rig');
  });

  it('refuses a ctx-file config_id that conflicts with --config-id', () => {
    const fx = makeFixture({ ctxExtra: { config_id: 'opencode-a' } });
    const { status, stderr } = runHarvester([...baseArgs(fx), '--config-id', 'opencode-a+prompt']);
    assert.notEqual(status, 0, 'conflicting ctx config_id must be refused');
    assert.match(stderr, /conflicts with --config-id/);
    assert.equal(readRows(fx.registryPath).length, 0, 'must not emit any row');
  });
});
