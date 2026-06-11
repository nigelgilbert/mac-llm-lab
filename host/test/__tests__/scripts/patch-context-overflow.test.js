// Issue #002 — unit tests for scripts/patch-context-overflow.mjs, the post-arm
// PRE-GATE overflow patch. Registry rows are emitted in-run from the on-disk
// sidecar; when the in-run overflow scan was blinded (virtiofs freeze, or an
// outcome-only sidecar from a wedged run), the row enters the registry as an
// ELIGIBLE failure. The driver slices every fresh runDir from the HOST log and
// this script scans the slice and patches run_summary AND the registry row —
// idempotently, before the row audit / pairing gate read the registry.
//
// The slice fixture (fixtures/overflow-server-log.slice) is the REAL capture:
// llama-server build b1-5594d13 (the lab's pinned build), Qwen3-8B-Q4_K_M,
// -c 256, port 18123, over-context /v1/chat/completions, 2026-06-10. The
// oracle line inside it is byte-exact from that log.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyOverflowToSummary,
  patchRegistryRowOverflow,
  scanAndPatchRunDir,
  DETECTED_VIA_POST_ARM,
} from '../../scripts/patch-context-overflow.mjs';
import { SLICE_BASENAME } from '../../scripts/repair-server-timings.mjs';
import { scanContextOverflow } from '../../lib/opencode_server_timings.js';
import { isEligible } from '../../lib/paired_bootstrap.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLICE_FIXTURE = path.join(HERE, 'fixtures', 'overflow-server-log.slice');

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// An outcome-only-shaped sidecar (the wedged-run case: no transcript, no
// server_timings_join_status) that closed as a timeout — the exact shape that
// emits an eligible failure before the patch.
function timeoutSummary(runId) {
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
    telemetry: 'outcome_only',
  };
}

// A minimal-but-realistic registry row as the reporter emitted it: an ELIGIBLE
// model failure (boolean passed, non-harness terminal_status).
function eligibleFailureRow(runId) {
  return {
    run_id: runId,
    run_kind: 'smoke',
    canonical_status: 'canonical',
    hardware_tier: 16,
    memory_gb: 16,
    config_id: 'opencode-a',
    model_config_id: 'qwen35-9b-iq4xs',
    model_id: 'test/model',
    quantization: 'IQ4_XS',
    context_limit: 65536,
    sampler_config_id: 'sampler-001',
    seed: null,
    harness_version: 'h-test',
    prompt_pack_version: null,
    test_id: 'expression-eval',
    test_version: 'v1',
    oracle_type: 'public_verifier',
    timeout_budget_ms: null,
    iteration_budget: null,
    start_time: '2026-06-10T00:00:00.000Z',
    end_time: '2026-06-10T00:10:00.000Z',
    terminal_status: 'timeout',
    passed: false,
    harness_error: null,
    iters_count: 0,
    trace_artifact_uri: '/tmp/x',
    screening_only: false,
  };
}

function writeRunDir({ runId, summary, sliceText }) {
  const runDir = makeTmp('ovf-patch-');
  fs.writeFileSync(
    path.join(runDir, 'run_summary.json'),
    JSON.stringify(summary ?? timeoutSummary(runId), null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(runDir, SLICE_BASENAME),
    sliceText ?? fs.readFileSync(SLICE_FIXTURE, 'utf8'),
  );
  return runDir;
}

function writeRegistry(rows) {
  const dir = makeTmp('ovf-reg-');
  const p = path.join(dir, 'run_registry.jsonl');
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

describe('fixture sanity — the REAL slice carries the pinned oracle line', () => {
  it('scanContextOverflow hits the empirical capture', () => {
    const hit = scanContextOverflow(fs.readFileSync(SLICE_FIXTURE, 'utf8'));
    assert.ok(hit);
    assert.equal(hit.task_id, 0);
    assert.equal(hit.n_prompt_tokens, 728);
    assert.equal(hit.n_ctx, 256);
  });
});

describe('applyOverflowToSummary — pure sidecar transform', () => {
  const overflow = { line: 'srv    send_error: task id = 0, error: request (728 tokens) exceeds the available context size (256 tokens), try increasing it' };

  it('relabels a timeout sidecar with full post-arm provenance', () => {
    const { summary, changed, relabeled } = applyOverflowToSummary(timeoutSummary('r1'), overflow);
    assert.equal(changed, true);
    assert.equal(relabeled, true);
    assert.equal(summary.terminal_status, 'harness_error');
    assert.equal(summary.passed, null);
    assert.equal(summary.context_overflow, true);
    assert.equal(summary.harness_error, 'context_overflow');
    assert.equal(summary.context_overflow_detected_via, DETECTED_VIA_POST_ARM);
    assert.match(summary.context_overflow_line, /exceeds the available context size/);
    assert.equal(summary.timing_caveats.filter((c) => c.startsWith('context_overflow_relabel:')).length, 1);
  });

  it('is idempotent (second application changes nothing)', () => {
    const first = applyOverflowToSummary(timeoutSummary('r2'), overflow);
    const second = applyOverflowToSummary(first.summary, overflow);
    assert.equal(second.changed, false);
    assert.deepEqual(second.summary, first.summary);
  });

  it('preserves in-run provenance on an already-typed transcript sidecar', () => {
    const inRun = {
      ...timeoutSummary('r3'),
      terminal_status: 'harness_error',
      context_overflow: true,
      harness_error: 'context_overflow',
      context_overflow_detected_via: 'in_run_capture',
      context_overflow_line: overflow.line,
      timing_caveats: [
        'no_litellm_bridge: …',
        `context_overflow_relabel: llama-server rejected a request in this run's capture window (n_ctx exceeded) — terminal_status re-typed harness_error / passed null per #002 Layer-A (excluded from pass denominators). Oracle line: ${overflow.line}`,
        'server_timings_join_no_server_timings: #022 log-cursor split (0 timing record(s) over 3 iteration(s)).',
      ],
    };
    const { summary, changed } = applyOverflowToSummary(inRun, overflow);
    assert.equal(summary.context_overflow_detected_via, 'in_run_capture');
    assert.equal(changed, false); // byte-stable: caveat position untouched
  });

  it('recovered-run carve-out: a done sidecar is recorded, not relabeled', () => {
    const done = { ...timeoutSummary('r4'), terminal_status: 'done', timeout: false, exit_code: 0, censored: false };
    const { summary, relabeled } = applyOverflowToSummary(done, overflow);
    assert.equal(relabeled, false);
    assert.equal(summary.terminal_status, 'done');
    assert.equal(summary.context_overflow, true);
    assert.equal(summary.harness_error, undefined);
    assert.ok(summary.timing_caveats.some((c) => c.startsWith('context_overflow_recovered:')));
  });
});

describe('patchRegistryRowOverflow — schema-field row patch, atomic, surgical', () => {
  it('moves an eligible failure to harness_error/passed null and touches NOTHING else', () => {
    const other = eligibleFailureRow('other-run');
    const target = eligibleFailureRow('target-run');
    const reg = writeRegistry([other, target]);
    const before = fs.readFileSync(reg, 'utf8').split('\n');

    const res = patchRegistryRowOverflow(reg, 'target-run');
    assert.equal(res.status, 'patched');
    assert.equal(res.line_no, 2);

    const after = fs.readFileSync(reg, 'utf8').split('\n');
    assert.equal(after[0], before[0]); // foreign row byte-identical
    const patched = JSON.parse(after[1]);
    assert.equal(patched.terminal_status, 'harness_error');
    assert.equal(patched.passed, null);
    assert.equal(patched.harness_error, 'context_overflow');
    // Within-schema patch only: same keys as before, nothing added.
    assert.deepEqual(Object.keys(patched).sort(), Object.keys(target).sort());
    assert.equal(isEligible(patched), false);
    assert.equal(patched.config_id, 'opencode-a'); // untouched fields intact
  });

  it('already-typed row → already_typed, file untouched', () => {
    const row = { ...eligibleFailureRow('r'), terminal_status: 'harness_error', passed: null, harness_error: 'context_overflow' };
    const reg = writeRegistry([row]);
    const before = fs.readFileSync(reg, 'utf8');
    const res = patchRegistryRowOverflow(reg, 'r');
    assert.equal(res.status, 'already_typed');
    assert.equal(fs.readFileSync(reg, 'utf8'), before);
  });

  it('missing run_id → row_absent (cap-killed cell: the audit owns it)', () => {
    const reg = writeRegistry([eligibleFailureRow('someone-else')]);
    assert.equal(patchRegistryRowOverflow(reg, 'ghost').status, 'row_absent');
  });
});

describe('scanAndPatchRunDir — end-to-end over the real fixture slice', () => {
  it('overflow slice + eligible row → both artifacts patched, loud result', () => {
    const runDir = writeRunDir({ runId: 'e2e-run' });
    const reg = writeRegistry([eligibleFailureRow('e2e-run')]);

    const res = scanAndPatchRunDir(runDir, { registryPath: reg });
    assert.equal(res.overflow, true);
    assert.equal(res.relabeled, true);
    assert.equal(res.summary_changed, true);
    assert.equal(res.registry, 'patched');
    assert.equal(res.detected_via, DETECTED_VIA_POST_ARM);
    assert.match(res.line, /exceeds the available context size/);

    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));
    assert.equal(summary.terminal_status, 'harness_error');
    assert.equal(summary.harness_error, 'context_overflow');
    const row = JSON.parse(fs.readFileSync(reg, 'utf8').trim());
    assert.equal(row.terminal_status, 'harness_error');
    assert.equal(row.passed, null);
  });

  it('is idempotent end-to-end (second pass: no writes, already_typed)', () => {
    const runDir = writeRunDir({ runId: 'e2e-idem' });
    const reg = writeRegistry([eligibleFailureRow('e2e-idem')]);
    scanAndPatchRunDir(runDir, { registryPath: reg });
    const summaryBytes = fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8');
    const regBytes = fs.readFileSync(reg, 'utf8');

    const res2 = scanAndPatchRunDir(runDir, { registryPath: reg });
    assert.equal(res2.overflow, true);
    assert.equal(res2.summary_changed, false);
    assert.equal(res2.registry, 'already_typed');
    assert.equal(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'), summaryBytes);
    assert.equal(fs.readFileSync(reg, 'utf8'), regBytes);
  });

  it('clean slice → overflow:false, nothing written', () => {
    const runDir = writeRunDir({
      runId: 'e2e-clean',
      sliceText: 'srv  update_slots: all slots are idle\nslot print_timing: id  0 | task 7 |\n',
    });
    const reg = writeRegistry([eligibleFailureRow('e2e-clean')]);
    const before = fs.readFileSync(reg, 'utf8');
    const res = scanAndPatchRunDir(runDir, { registryPath: reg });
    assert.deepEqual(res, { run_id: 'e2e-clean', overflow: false });
    assert.equal(fs.readFileSync(reg, 'utf8'), before);
  });

  it('overflow but no row (cap-killed cell) → sidecar patched, registry row_absent', () => {
    const runDir = writeRunDir({ runId: 'e2e-norow' });
    const reg = writeRegistry([eligibleFailureRow('someone-else')]);
    const res = scanAndPatchRunDir(runDir, { registryPath: reg });
    assert.equal(res.overflow, true);
    assert.equal(res.registry, 'row_absent');
    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));
    assert.equal(summary.terminal_status, 'harness_error');
  });

  it('recovered run (done sidecar) → recorded, row left alone', () => {
    const runDir = writeRunDir({
      runId: 'e2e-done',
      summary: { ...timeoutSummary('e2e-done'), terminal_status: 'done', timeout: false, exit_code: 0, censored: false },
    });
    const doneRow = { ...eligibleFailureRow('e2e-done'), terminal_status: 'done', passed: true };
    const reg = writeRegistry([doneRow]);
    const before = fs.readFileSync(reg, 'utf8');
    const res = scanAndPatchRunDir(runDir, { registryPath: reg });
    assert.equal(res.overflow, true);
    assert.equal(res.relabeled, false);
    assert.equal(res.registry, 'not_relabeled');
    assert.equal(fs.readFileSync(reg, 'utf8'), before);
  });

  it('missing slice → throws loud (the driver slices every fresh runDir; a gap is a bug)', () => {
    const runDir = writeRunDir({ runId: 'e2e-noslice' });
    fs.rmSync(path.join(runDir, SLICE_BASENAME));
    assert.throws(
      () => scanAndPatchRunDir(runDir, { registryPath: '/nonexistent.jsonl' }),
      /no server log slice/,
    );
  });
});
