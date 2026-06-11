// Issue #010 (decision 2026-06-10, measurement-first) — tool-call telemetry
// promotion onto registry rows. The already-computed run_summary counters
// (lib/opencode_transcript.js) are promoted VERBATIM by run_row.js:
//
//   tool_call_count            total tool calls in the transcript
//   error_tool_call_count      execution errors (behavioral, NOT parse health)
//   truncated_tool_call_count  in-flight parts at hard-kill on censored runs
//                              (#017 — truncated != error)
//
// Pins:
//   1. transcript-telemetry sidecar -> counters land on the row (0 preserved
//      as 0, not nulled) and the row validates;
//   2. outcome-only / claw-rig-shaped sidecars (no counters; or no sidecar at
//      all) -> all three null, row still validates — historical registries and
//      the offline harvester keep working;
//   3. NO threshold semantics: a row with a sky-high error count is untouched
//      (terminal_status/passed unchanged) and remains analysis-eligible —
//      paired_bootstrap.isEligible ignores the new fields (#012). The
//      threshold decision is deferred to #018;
//   4. schema: rows missing the keys entirely (pre-#010 historical shape)
//      still validate; malformed counter values are nulled by assembly, and
//      the schema rejects non-integer junk on hand-built rows.

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

const MODEL_CONFIG_ID = 'test-config-010';
function writeManifest() {
  const dir = makeTmp('rrt-manifest-');
  const p = path.join(dir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify({
    [MODEL_CONFIG_ID]: {
      model_config_id: MODEL_CONFIG_ID,
      model_id: 'test/model@rev',
      model_family: 'test',
      quantization: 'Q4_K_XL',
      context_limit: 65536,
      runtime_backend: 'llama-server@test',
      sampler_config_id: 'sampler-001',
      harness_version: 'h-test',
      prompt_pack_version: 'pp-test',
    },
  }));
  return p;
}

function baseCtx(manifestPath, extra = {}) {
  return {
    run_kind: 'smoke',
    hardware_tier: 64,
    memory_gb: 64,
    config_id: 'opencode-a',
    model_config_id: MODEL_CONFIG_ID,
    test_id: 'expression-eval',
    test_version: 'v1',
    oracle_type: 'public_verifier',
    harness_version: 'h-test',
    manifestPath,
    ...extra,
  };
}

function writeRunDir({ summary, assertion } = {}) {
  const runDir = makeTmp('rrt-run-');
  if (summary) {
    fs.writeFileSync(
      path.join(runDir, 'run_summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
  }
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
  if (assertion) {
    fs.writeFileSync(
      path.join(runDir, 'assertion_result.json'),
      JSON.stringify(assertion, null, 2) + '\n',
    );
  }
  return runDir;
}

// A transcript-telemetry-shaped sidecar (the opencode_transcript.js output
// shape, trimmed to what run_row.js reads).
function telemetrySummary(runId, overrides = {}) {
  return {
    schema_version: 1,
    run_id: runId,
    test_id: 'expression-eval',
    run_started_ms: 1781000000000,
    run_finished_ms: 1781000300000,
    run_elapsed_ms: 300000,
    iter_count: 7,
    terminal_status: 'done',
    passed: null,
    timeout: false,
    exit_code: 0,
    censored: false,
    tool_call_count: 11,
    error_tool_call_count: 2,
    truncated_tool_call_count: 0,
    ...overrides,
  };
}

describe('#010 tool-call telemetry promotion — transcript-telemetry sidecar', () => {
  it('promotes all three counters verbatim onto a validating row', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: telemetrySummary('run-tc-1'),
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-tc-1', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
    assert.equal(row.tool_call_count, 11);
    assert.equal(row.error_tool_call_count, 2);
    assert.equal(row.truncated_tool_call_count, 0); // 0 is an observation, not "absent"
    assert.deepEqual(validateRow(row), []);
  });

  it('censored-run shape: truncated split survives (#017 — truncated != error)', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: telemetrySummary('run-tc-2', {
        terminal_status: 'timeout',
        timeout: true,
        exit_code: null,
        censored: true,
        tool_call_count: 9,
        error_tool_call_count: 1,
        truncated_tool_call_count: 3,
      }),
      assertion: { passed: false, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-tc-2', runDir, code: null, timeout: true },
      baseCtx(manifestPath),
    );
    assert.equal(row.tool_call_count, 9);
    assert.equal(row.error_tool_call_count, 1);
    assert.equal(row.truncated_tool_call_count, 3);
    assert.deepEqual(validateRow(row), []);
  });

  it('NO threshold semantics: a high error count changes nothing about the verdict fields', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: telemetrySummary('run-tc-3', {
        tool_call_count: 40,
        error_tool_call_count: 39, // pathological — still telemetry only (#018 decides)
      }),
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-tc-3', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
    assert.equal(row.terminal_status, 'done');
    assert.equal(row.passed, true);
    assert.equal(row.harness_error, null);
    assert.deepEqual(validateRow(row), []);
    assert.equal(isEligible(row), true); // #012 isEligible ignores unknown fields
  });
});

describe('#010 telemetry promotion — outcome-only / claw-rig-shaped runs (nullability)', () => {
  it('outcome-only sidecar (no counter fields) -> all three null, row validates', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: {
        schema_version: 1,
        run_id: 'run-oo-1',
        test_id: 'expression-eval',
        run_started_ms: 1781000000000,
        run_finished_ms: 1781000300000,
        terminal_status: 'done',
        passed: null,
        timeout: false,
        exit_code: 0,
        // telemetry: 'outcome_only' — degraded normalization, no counters.
      },
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-oo-1', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
    assert.equal(row.tool_call_count, null);
    assert.equal(row.error_tool_call_count, null);
    assert.equal(row.truncated_tool_call_count, null);
    assert.deepEqual(validateRow(row), []);
  });

  it('claw-rig-shaped run with NO run_summary at all -> null counters, validates', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({}); // empty runDir: no sidecar (historical harvest shape)
    const row = assembleRow(
      { runId: 'run-claw-1', runDir, code: 0 },
      baseCtx(manifestPath, { config_id: 'claw-rig', hardware_tier: 16, memory_gb: 16 }),
    );
    assert.equal(row.config_id, 'claw-rig');
    assert.equal(row.tool_call_count, null);
    assert.equal(row.error_tool_call_count, null);
    assert.equal(row.truncated_tool_call_count, null);
    assert.deepEqual(validateRow(row), []);
  });

  it('malformed sidecar counters (strings/floats/negatives/null) are nulled, never thrown on', () => {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: telemetrySummary('run-bad-1', {
        tool_call_count: '11',          // coercion is the normalizer's job, not the row's
        error_tool_call_count: 1.5,
        truncated_tool_call_count: -2,
      }),
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    const row = assembleRow(
      { runId: 'run-bad-1', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
    assert.equal(row.tool_call_count, null);
    assert.equal(row.error_tool_call_count, null);
    assert.equal(row.truncated_tool_call_count, null);
    assert.deepEqual(validateRow(row), []);
  });
});

describe('#010 schema contract for the three counter fields', () => {
  function validRowWithCounters() {
    const manifestPath = writeManifest();
    const runDir = writeRunDir({
      summary: telemetrySummary('run-schema-1'),
      assertion: { passed: true, test_id: 'expression-eval' },
    });
    return assembleRow(
      { runId: 'run-schema-1', runDir, code: 0, timeout: false },
      baseCtx(manifestPath),
    );
  }

  it('historical row shape (keys entirely absent) still validates — counters are NOT required', () => {
    const row = validRowWithCounters();
    const {
      tool_call_count, error_tool_call_count, truncated_tool_call_count,
      ...historical
    } = row;
    assert.deepEqual(validateRow(historical), []);
  });

  it('explicit nulls validate (degraded/outcome-only rows)', () => {
    const row = validRowWithCounters();
    assert.deepEqual(validateRow({
      ...row,
      tool_call_count: null,
      error_tool_call_count: null,
      truncated_tool_call_count: null,
    }), []);
  });

  it('rejects non-integer and negative values on hand-built rows', () => {
    const row = validRowWithCounters();
    for (const field of ['tool_call_count', 'error_tool_call_count', 'truncated_tool_call_count']) {
      const typeErrs = validateRow({ ...row, [field]: '3' });
      assert.ok(
        typeErrs.some((e) => e.includes(field) && e.includes('expected integer|null')),
        `${field}='3' must fail type check, got ${JSON.stringify(typeErrs)}`,
      );
      const minErrs = validateRow({ ...row, [field]: -1 });
      assert.ok(
        minErrs.some((e) => e.includes(field) && e.includes('minimum')),
        `${field}=-1 must fail minimum check, got ${JSON.stringify(minErrs)}`,
      );
    }
  });
});
