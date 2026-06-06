// Sprint 0 sign-off bridge: assemble a run-registry row from a claw run,
// then validate + append it. Closes sign-off criteria 1 (a single run lands
// in the registry with all mandatory fields populated) and 2 (the row
// carries a resolvable `model_config_id`) without duplicating logic across
// each tier-eval test file.
//
// Inputs:
//   - clawResult: the object returned by runClaw() in lib/claw.js (has runId,
//     runDir, iterationsPath, runSummaryPath, code, elapsedMs, etc).
//   - ctx: caller-supplied registry context — at minimum:
//       run_kind, hardware_tier, memory_gb, model_config_id,
//       test_id, test_version, oracle_type, harness_version
//     Optional fields: canonical_status (default 'canonical'),
//       config_id (coarse bundle label, default 'claw-rig'),
//       seed, prompt_pack_version, screening_only, iteration_budget,
//       timeout_budget_ms, manifestPath (override for model-config lookup),
//       registryPath (override target jsonl), now (clock injection for tests).
//
// Behavior:
//   - Reads assertion_result.json + run_summary.json + iterations.jsonl from
//     the run sidecar to populate `passed`, `terminal_status`, `start_time`,
//     `end_time`, and `trace_artifact_uri`.
//   - Resolves model_config_id via lib/model_config.js and denormalizes
//     model_id, quantization, context_limit, sampler_config_id onto the row.
//   - Validates against run_registry.schema.json; throws RegistryValidationError
//     on any failure (caller decides whether to drop the row or rerun).
//
// This module deliberately does NOT spawn claw — that's the test/driver's
// job. It only assembles the row from artifacts on disk.

import fs from 'node:fs';
import path from 'node:path';

import { appendRow, validateRow, REGISTRY_PATH, RegistryValidationError } from './registry.js';
import { resolveConfig } from './model_config.js';

const TERMINAL_STATUS_ALLOWED = new Set(['done', 'error', 'timeout', 'interrupted', 'harness_error']);

export class RunRowAssemblyError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RunRowAssemblyError';
    if (cause) this.cause = cause;
  }
}

export function assembleRow(clawResult, ctx) {
  if (!clawResult || typeof clawResult !== 'object') {
    throw new RunRowAssemblyError('clawResult is required');
  }
  if (!ctx || typeof ctx !== 'object') {
    throw new RunRowAssemblyError('ctx is required');
  }
  for (const k of [
    'run_kind', 'hardware_tier', 'memory_gb', 'model_config_id',
    'test_id', 'test_version', 'oracle_type', 'harness_version',
  ]) {
    if (ctx[k] === undefined || ctx[k] === null || ctx[k] === '') {
      throw new RunRowAssemblyError(`ctx.${k} is required`);
    }
  }

  const runId = clawResult.runId;
  if (!runId) throw new RunRowAssemblyError('clawResult.runId is required');

  // Resolve manifest entry and denormalize four fields onto the row. Caller
  // passes manifestPath through ctx for tests; production reads
  // lib/model_configs.json by default.
  const config = resolveConfig(ctx.model_config_id, { manifestPath: ctx.manifestPath });

  const iterRecords = readIterationsJsonl(clawResult.iterationsPath);

  // Pull `passed` and timestamps from sidecar artifacts. assertion_result.json
  // is written by tier-eval tests via writeAssertionResult; its `passed` field
  // is the authoritative pass/fail signal. Fall back to run_summary.json's
  // `passed` (currently always null) and finally to claw exit code.
  const assertion = readJsonIfExists(clawResult.runDir, 'assertion_result.json');
  const summary = readJsonIfExists(clawResult.runDir, 'run_summary.json');

  const start_time = isoFromMs(summary?.run_started_ms);
  const end_time = isoFromMs(summary?.run_finished_ms);

  // Sprint 1.20: if claw exited non-zero AND the per-run bridge slice carries a
  // typed context-overflow failure from LiteLLM, relabel as harness_error so
  // the row drops out of pass-rate denominators per the schema's Layer-A
  // discipline (run_registry.schema.json's `terminal_status` description).
  const upstreamFailure = detectUpstreamFailure(clawResult.runDir);

  const terminal_status = pickTerminalStatus(clawResult, summary, upstreamFailure);
  const passed = pickPassed(assertion, summary, terminal_status);
  const harness_error = ctx.harness_error
    ?? (terminal_status === 'harness_error' ? upstreamFailure?.harness_error ?? null : null);

  const row = {
    run_id: runId,
    run_kind: ctx.run_kind,
    canonical_status: ctx.canonical_status ?? 'canonical',
    hardware_tier: ctx.hardware_tier,
    memory_gb: ctx.memory_gb,
    // Coarse bundle label (issue #002). Threaded from run context; existing
    // claw runs default to 'claw-rig' so pre-opencode callers need no change.
    config_id: ctx.config_id ?? 'claw-rig',
    model_config_id: ctx.model_config_id,
    model_id: config.model_id,
    quantization: config.quantization,
    context_limit: config.context_limit,
    sampler_config_id: config.sampler_config_id,
    seed: ctx.seed ?? null,
    harness_version: ctx.harness_version,
    prompt_pack_version: ctx.prompt_pack_version ?? config.prompt_pack_version ?? null,
    test_id: ctx.test_id,
    test_version: ctx.test_version,
    oracle_type: ctx.oracle_type,
    timeout_budget_ms: ctx.timeout_budget_ms ?? null,
    iteration_budget: ctx.iteration_budget ?? null,
    start_time: start_time ?? new Date().toISOString(),
    end_time,
    terminal_status,
    passed,
    harness_error,
    iters_count: iterRecords.length,
    trace_artifact_uri: clawResult.runDir ?? null,
    screening_only: ctx.screening_only ?? (ctx.run_kind === 'overnight_screen'),
  };

  return row;
}

export function emitRow(clawResult, ctx) {
  const row = assembleRow(clawResult, ctx);
  const errors = validateRow(row);
  if (errors.length) throw new RegistryValidationError(errors, row);
  return appendRow(row, { registryPath: ctx.registryPath ?? REGISTRY_PATH });
}

// --- helpers -----------------------------------------------------------------

function readIterationsJsonl(iterationsPath) {
  if (!iterationsPath || !fs.existsSync(iterationsPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(iterationsPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return out;
}

function readJsonIfExists(runDir, fname) {
  if (!runDir) return null;
  const p = path.join(runDir, fname);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function isoFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function pickTerminalStatus(clawResult, summary, upstreamFailure) {
  // Sprint 1.20: a claw exit-non-zero attributable to a typed upstream failure
  // (e.g. llama-server context-overflow rejection surfaced as LiteLLM
  // BadRequestError) is harness-side, not test-content. Relabel before the
  // generic 'error' bucketing so Layer-A pass-rate denominators stay clean.
  //
  // Gate on claw exit != 0: a transient upstream failure that claw recovered
  // from (e.g. mid-run BadRequestError followed by a successful retry → claw
  // exits 0) is not a harness failure of the run; only kill-the-run failures
  // get the harness_error label.
  if (upstreamFailure
      && !clawResult.timeout
      && !clawResult.signal
      && typeof clawResult.code === 'number'
      && clawResult.code !== 0) {
    return 'harness_error';
  }
  if (summary?.terminal_status && TERMINAL_STATUS_ALLOWED.has(summary.terminal_status)) {
    return summary.terminal_status;
  }
  if (clawResult.timeout) return 'timeout';
  if (clawResult.signal) return 'interrupted';
  if (typeof clawResult.code === 'number') return clawResult.code === 0 ? 'done' : 'error';
  return 'harness_error';
}

function pickPassed(assertion, summary, terminal_status) {
  if (terminal_status === 'harness_error' || terminal_status === 'interrupted') return null;
  if (assertion && typeof assertion.passed === 'boolean') return assertion.passed;
  if (summary && typeof summary.passed === 'boolean') return summary.passed;
  return null;
}

// Sprint 1.20: per-run upstream-failure detector. Reads the bridge slice
// (claw.js:collectRunArtifacts copies the time-windowed _bridge.jsonl segment
// into <runDir>/bridge.iterations.jsonl) and types the failure from LiteLLM's
// callback metadata captured by host/litellm/callbacks/iter_distribution_logger.py.
//
// Patterns:
//   - context_overflow: BadRequestError + message including
//     "exceeds the available context size" — n_ctx ceiling at llama-server.
// Future: other failure_class patterns get their own harness_error label here.
//
// Returns null when no record is typed; otherwise { harness_error: 'context_overflow' }.
function detectUpstreamFailure(runDir) {
  if (!runDir) return null;
  const slicePath = path.join(runDir, 'bridge.iterations.jsonl');
  if (!fs.existsSync(slicePath)) return null;
  for (const line of fs.readFileSync(slicePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec.stream_aborted) continue;
    // BadRequestError → llama-server's typed pre-decode rejection.
    // InternalServerError / APIError → same root cause surfaced as a
    // streaming "Context size has been exceeded" mid-decode (observed in
    // Sprint 1.20 N=8 confirm, expression-eval at 64k). Both are upstream-
    // bound context-overflow; relabel both as harness_error.
    if (typeof rec.failure_message_tail !== 'string') continue;
    if (rec.failure_class === 'BadRequestError'
        && rec.failure_message_tail.includes('exceeds the available context size')) {
      return { harness_error: 'context_overflow' };
    }
    if ((rec.failure_class === 'InternalServerError' || rec.failure_class === 'APIError')
        && rec.failure_message_tail.includes('Context size has been exceeded')) {
      return { harness_error: 'context_overflow' };
    }
  }
  return null;
}
