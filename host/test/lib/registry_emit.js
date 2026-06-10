// Sidecar assertion-result writer + inline registry-row emitter.
//
// Extracted from the retired claw runner module (issue #010; the claw stack is
// archived at the `claw-stack-final` tag) — these two functions are
// runner-agnostic and remain the single emit path for every config arm:
// the registry reporter calls writeAssertionResult after each tier-eval test,
// and (when RUN_REGISTRY_EMIT=1) maybeEmitRegistryRow assembles + appends the
// config_id-stamped registry row from the run sidecar.
//
// Persist the eval-test assertion outcome alongside run_summary.json so
// `passed` can be propagated into the run table. Without this, run_summary.json
// sees `passed: null` and the failed-tail stratum misses runs where the agent
// exits 0 but the verify-script assertion fails.
//
// Writes <runDir>/assertion_result.json. Best-effort — never throws.
//
// When `RUN_REGISTRY_EMIT=1` is set, also assemble + append a tier-eval-v2
// registry row using lib/run_row.js. Required envs:
//   - RUN_REGISTRY_KIND               (default: smoke)
//   - RUN_REGISTRY_HARDWARE_TIER      (default: TIER env, then 64)
//   - RUN_REGISTRY_MEMORY_GB          (default: == hardware_tier)
//   - RUN_REGISTRY_MODEL_CONFIG_ID    (optional for opencode arms — auto-picked
//                                      per tier via modelConfigIdFor)
//   - RUN_REGISTRY_HARNESS_VERSION    (default: GIT_SHA env, then "unknown")
//   - RUN_REGISTRY_TESTS_DIR          (default: /test/__tests__/tier-eval)
//   - RUN_REGISTRY_PATH               (default: lib/registry.js DEFAULT)
//   - MODEL_CONFIG_MANIFEST_PATH      (default: lib/model_configs.json)
// Test_id is read from run_summary.json (set by ITER_DIST_TEST_ID at run time);
// test_version + oracle_type are joined from the test_manifest header.
//
// Emission failure is logged to stderr but does not throw — discipline is to
// inspect stderr at sweep tail rather than half-fail an assert.

import fs from 'node:fs';
import path from 'node:path';

import { emitRow } from './run_row.js';
import { readManifest } from './test_manifest.js';
import { resolveConfigId, modelConfigIdFor } from './config.js';

export function writeAssertionResult(runDir, payload) {
  if (!runDir) return;
  try {
    fs.writeFileSync(
      path.join(runDir, 'assertion_result.json'),
      JSON.stringify({ ...payload, written_at_ms: Date.now() }, null, 2) + '\n',
    );
  } catch (e) {
    console.error(
      `[iter-distribution] writeAssertionResult failed for ${runDir}: ${e.message}`,
    );
  }
  if (process.env.RUN_REGISTRY_EMIT === '1') {
    try {
      maybeEmitRegistryRow(runDir);
    } catch (e) {
      console.error(`[run-registry] emit failed for ${runDir}: ${e.stack || e.message}`);
    }
  }
}

function maybeEmitRegistryRow(runDir) {
  const summaryPath = path.join(runDir, 'run_summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.error(`[run-registry] no run_summary.json under ${runDir}; skipping emit`);
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const test_id = summary.test_id;
  if (!test_id) {
    console.error(`[run-registry] run_summary.test_id is null (ITER_DIST_TEST_ID was unset at run time); skipping emit`);
    return;
  }

  const testsDir = process.env.RUN_REGISTRY_TESTS_DIR || '/test/__tests__/tier-eval';
  const testFile = path.join(testsDir, `${test_id}.test.js`);
  if (!fs.existsSync(testFile)) {
    console.error(`[run-registry] no test file at ${testFile} for test_id=${test_id}; skipping emit`);
    return;
  }
  const manifest = readManifest(testFile);

  // Coarse bundle label (issue #011 selector → #002 dimension). The single
  // CONFIG env that picks the runner also labels the row, so a row's config_id
  // can never disagree with the runner that produced it.
  const config_id = resolveConfigId();
  const tierStr = process.env.RUN_REGISTRY_HARDWARE_TIER || process.env.TIER || '64';
  // Auto-pick the tier's serving fingerprint for the active opencode arm so a
  // driver need only set CONFIG=<arm> + TIER; an explicit env still wins.
  const model_config_id = process.env.RUN_REGISTRY_MODEL_CONFIG_ID
    || modelConfigIdFor({ configId: config_id, tier: tierStr });
  if (!model_config_id) {
    console.error(`[run-registry] RUN_REGISTRY_MODEL_CONFIG_ID required when RUN_REGISTRY_EMIT=1; skipping emit`);
    return;
  }
  const tier = parseInt(tierStr, 10);
  const memory = parseInt(process.env.RUN_REGISTRY_MEMORY_GB || String(tier), 10);

  const ctx = {
    run_kind: process.env.RUN_REGISTRY_KIND || 'smoke',
    hardware_tier: tier,
    memory_gb: memory,
    config_id,
    model_config_id,
    test_id,
    test_version: manifest.test_version,
    oracle_type: manifest.oracle_type,
    harness_version: process.env.RUN_REGISTRY_HARNESS_VERSION || process.env.GIT_SHA || 'unknown',
    canonical_status: process.env.RUN_REGISTRY_CANONICAL_STATUS || 'canonical',
  };

  const written = emitRow({
    runId: summary.run_id,
    runDir,
    iterationsPath: path.join(runDir, 'iterations.jsonl'),
    runSummaryPath: summaryPath,
    // Pass null through unchanged when the agent aborted on timeout.
    // run_summary.json's terminal_status='timeout' takes precedence in
    // run_row.js's pickTerminalStatus, so the row reads correctly even with
    // code=null.
    code: typeof summary.exit_code === 'number' ? summary.exit_code : null,
    timeout: !!summary.timeout,
    signal: null,
    elapsedMs: summary.run_elapsed_ms ?? null,
  }, ctx);
  console.error(`[run-registry] appended ${test_id} row → ${written}`);
}
