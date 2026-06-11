// Issue #002 (Option A, decision 2026-06-10) — context-overflow → harness_error
// relabel at the ROW level. The oracle is the pinned llama-server
// n_ctx-exceeded log line in the run's capture window; the signal reaches
// run_row.js as the run_summary sidecar's `context_overflow: true` flag (set by
// the in-run transcript scan or the driver's post-arm host-slice patch). Pins:
//
//   1. an overflow run assembles terminal_status 'harness_error' / passed null
//      (excluded from pass denominators — paired_bootstrap.isEligible),
//      OVERRIDING an assertion_result that would otherwise make it an eligible
//      failure;
//   2. the relabel fires even when the sidecar's own terminal_status is still
//      'timeout'/'error' (the documented tier-16 shape: the overflow burns the
//      wall-clock budget — the retired claw-era exit-code gate would miss it);
//   3. the recovered-run carve-out: overflow recorded on a run that finished
//      clean ('done') does NOT relabel — the workspace oracle decides;
//   4. a non-overflow failure is untouched (eligible model failure).
//
// The retired claw-era bridge-slice detector is gone; this file is its
// replacement's contract.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRow } from '../../lib/registry.js';
import { assembleRow } from '../../lib/run_row.js';
import { isEligible } from '../../lib/paired_bootstrap.js';

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

const MODEL_CONFIG_ID = 'test-config-002';
function writeManifest() {
  const dir = makeTmp('rro-manifest-');
  const p = path.join(dir, 'manifest.json');
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

function baseCtx(manifestPath) {
  return {
    run_kind: 'smoke',
    hardware_tier: 16,
    memory_gb: 16,
    config_id: 'opencode-a',
    model_config_id: MODEL_CONFIG_ID,
    test_id: 'expression-eval',
    test_version: 'v1',
    oracle_type: 'public_verifier',
    harness_version: 'h-test',
    manifestPath,
  };
}

// Build a runDir whose sidecar mirrors a real emit-path input
// (registry_emit.js: code from summary.exit_code, timeout from summary.timeout).
function writeRunDir({ summary, assertion }) {
  const runDir = makeTmp('rro-run-');
  fs.writeFileSync(
    path.join(runDir, 'run_summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
  if (assertion) {
    fs.writeFileSync(
      path.join(runDir, 'assertion_result.json'),
      JSON.stringify(assertion, null, 2) + '\n',
    );
  }
  return runDir;
}

const OVERFLOW_LINE =
  'srv    send_error: task id = 0, error: request (728 tokens) exceeds the available context size (256 tokens), try increasing it';

function summaryBase(runId, overrides = {}) {
  return {
    schema_version: 1,
    run_id: runId,
    test_id: 'expression-eval',
    run_started_ms: 1781000000000,
    run_finished_ms: 1781000600000,
    run_elapsed_ms: 600000,
    iter_count: 0,
    terminal_status: 'timeout',
    passed: null,
    timeout: true,
    exit_code: null,
    censored: true,
    ...overrides,
  };
}

describe('#002 overflow relabel — assembled row (fixture-driven)', () => {
  it('in-run-relabeled sidecar → row harness_error / passed null / typed, ineligible', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: summaryBase('run-ovf-1', {
        terminal_status: 'harness_error',
        context_overflow: true,
        harness_error: 'context_overflow',
        context_overflow_detected_via: 'in_run_capture',
        context_overflow_line: OVERFLOW_LINE,
      }),
      // The oracle failed the run — but an overflow run must NOT count as an
      // eligible model failure: passed must come out null, not false.
      assertion: { passed: false, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-ovf-1', runDir, code: null, timeout: true },
      baseCtx(manifestPath),
    );
    assert.equal(row.terminal_status, 'harness_error');
    assert.equal(row.passed, null);
    assert.equal(row.harness_error, 'context_overflow');
    assert.deepEqual(validateRow(row), []);
    assert.equal(isEligible(row), false); // dropped from pass denominators
  });

  it('overflow flag on a sidecar still labeled timeout (tier-16 wall-clock shape) → relabeled', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: summaryBase('run-ovf-2', {
        terminal_status: 'timeout',
        context_overflow: true,
        context_overflow_detected_via: 'host_slice_post_arm',
        context_overflow_line: OVERFLOW_LINE,
      }),
      assertion: { passed: false, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-ovf-2', runDir, code: null, timeout: true },
      baseCtx(manifestPath),
    );
    assert.equal(row.terminal_status, 'harness_error');
    assert.equal(row.passed, null);
    assert.equal(row.harness_error, 'context_overflow');
    assert.deepEqual(validateRow(row), []);
    assert.equal(isEligible(row), false);
  });

  it('recovered-run carve-out: overflow + done sidecar → NOT relabeled, oracle decides', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: summaryBase('run-ovf-3', {
        terminal_status: 'done',
        timeout: false,
        exit_code: 0,
        censored: false,
        context_overflow: true,
        context_overflow_detected_via: 'in_run_capture',
        context_overflow_line: OVERFLOW_LINE,
      }),
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-ovf-3', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
    assert.equal(row.terminal_status, 'done');
    assert.equal(row.passed, true);
    assert.equal(row.harness_error, null);
    assert.equal(isEligible(row), true);
  });

  it('non-overflow timeout failure stays an ELIGIBLE model failure (no phantom relabel)', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: summaryBase('run-clean-1'),
      assertion: { passed: false, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-clean-1', runDir, code: null, timeout: true },
      baseCtx(manifestPath),
    );
    assert.equal(row.terminal_status, 'timeout');
    assert.equal(row.passed, false);
    assert.equal(row.harness_error, null);
    assert.equal(isEligible(row), true);
  });
});
