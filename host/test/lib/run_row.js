// Sprint 0 sign-off bridge: assemble a run-registry row from a claw run,
// then validate + append it. Closes sign-off criteria 1 (a single run lands
// in the registry with all mandatory fields populated) and 2 (the row
// carries a resolvable `model_config_id`) without duplicating logic across
// each tier-eval test file.
//
// Inputs:
//   - clawResult: a RunnerResult-shaped object as returned by a runner (today
//     lib/opencode.js runOpenCode; historically the retired claw runner —
//     hence the parameter name): runId, runDir, iterationsPath,
//     runSummaryPath, code, elapsedMs, etc.
//   - ctx: caller-supplied registry context — at minimum:
//       run_kind, hardware_tier, memory_gb, config_id, model_config_id,
//       test_id, test_version, oracle_type, harness_version
//     config_id (the coarse A/B bundle label) is REQUIRED with no default
//     (issue #009): the live path supplies it via resolveConfigId(); the
//     offline harvester supplies it via its required --config-id flag.
//     Optional fields: canonical_status (default 'canonical'),
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
  // Issue #009: config_id (the coarse A/B bundle label) is REQUIRED — no
  // 'claw-rig' default. Minting the historical baseline label by omission is
  // exactly how an offline-recovered opencode run lands on the wrong side of
  // the A/B (it passes the pairing gate's enum check and buckets as baseline).
  // 'claw-rig' stays in the schema enum for the preserved historical
  // registries; it just can never again be stamped implicitly. The live path
  // supplies config_id via resolveConfigId(); the offline harvester via its
  // required --config-id flag.
  if (ctx.config_id === undefined || ctx.config_id === null || ctx.config_id === '') {
    throw new RunRowAssemblyError(
      "ctx.config_id is required (no 'claw-rig' default — issue #009): pass the "
      + "run's coarse bundle label explicitly (live path: resolveConfigId(); "
      + 'offline harvest: --config-id).',
    );
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

  // #002 (Option A, decision 2026-06-10): a mid-run llama-server context
  // overflow is re-typed harness_error so the row drops out of pass-rate
  // denominators per the schema's Layer-A discipline (run_registry.schema.json
  // `terminal_status` description). The signal is the sidecar's
  // `context_overflow` flag, set from the pinned llama-server n_ctx-exceeded
  // log line in the run's capture window — by the transcript build in-run
  // (lib/opencode_transcript.js, OPENCODE_SERVER_TIMINGS=1) or by the driver's
  // post-arm host-slice patch (scripts/patch-context-overflow.mjs) when
  // virtiofs froze the in-container view. This replaces the retired claw-era
  // bridge-slice detector (its LiteLLM-side writers died with the claw stack).
  const upstreamFailure = detectContextOverflow(summary);

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
    // Coarse bundle label (issue #002). Always threaded from run context;
    // required with no default since issue #009 (guard above).
    config_id: ctx.config_id,
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
    // #010 (decision 2026-06-10): tool-call telemetry promoted verbatim from
    // the run_summary sidecar (computed by lib/opencode_transcript.js). Drift
    // telemetry ONLY — no threshold, no exclusion rule, no eligibility effect
    // (paired_bootstrap.isEligible ignores unknown row fields, #012); the
    // threshold decision is deferred to issue #018. Null whenever the sidecar
    // carries no counters: historical claw-rig rows, outcome-only/degraded
    // runs, and absent sidecars all stay valid. truncated_tool_call_count
    // (#017) preserves the censoring-aware split — in-flight parts at
    // hard-kill are truncation, NOT tool errors.
    tool_call_count: countOrNull(summary?.tool_call_count),
    error_tool_call_count: countOrNull(summary?.error_tool_call_count),
    truncated_tool_call_count: countOrNull(summary?.truncated_tool_call_count),
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

// #010 telemetry promotion: a counter is only a counter — accept non-negative
// integers verbatim (including 0, which is a real observation, not "absent");
// anything else (missing field, null, strings, floats, negatives from a
// corrupt sidecar) maps to null so the row stays schema-valid and the absence
// is distinguishable downstream (#018 reads null as "no telemetry").
function countOrNull(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

function pickTerminalStatus(clawResult, summary, upstreamFailure) {
  // #002: a typed upstream failure (llama-server context overflow in the run's
  // capture window) is harness-side, not test-content. Relabel before the
  // generic bucketing so Layer-A pass-rate denominators stay clean. The
  // recovered-run carve-out (overflow line present but the run finished clean
  // → NOT a kill-the-run failure → no relabel) lives in detectContextOverflow,
  // so a non-null upstreamFailure here is always relabel-worthy — including
  // the documented tier-16 shape where the overflow burns the wall-clock and
  // the sidecar says 'timeout' (the claw-era exit-code gate would miss it).
  if (upstreamFailure) {
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

// #002 per-run context-overflow detector (Option A, decision 2026-06-10).
// Reads the run_summary sidecar's `context_overflow` flag — the opencode-native
// successor to the retired claw-era bridge-slice detector (which parsed
// LiteLLM failure classes out of the per-run bridge slice; its writers died
// with the claw stack, tag claw-stack-final). The flag's oracle is the pinned
// llama-server n_ctx-exceeded log line scanned out of the run's per-run
// capture window (lib/opencode_server_timings.js CONTEXT_OVERFLOW_RE), set by:
//   - the in-run transcript build when the window was readable in-container
//     (context_overflow_detected_via: 'in_run_capture'), or
//   - the driver's post-arm host-slice patch when virtiofs froze the
//     in-container view (context_overflow_detected_via: 'host_slice_post_arm';
//     scripts/patch-context-overflow.mjs, run-config-ab.sh).
//
// Recovered-run carve-out: an overflow line in the window on a run that still
// finished clean ('done') means the client recovered (compaction/retry) — the
// overflow is recorded on the sidecar but the run is NOT a kill-the-run
// failure, so no relabel (the workspace oracle decides pass/fail).
//
// Returns null when no relabel applies; otherwise { harness_error: 'context_overflow' }.
function detectContextOverflow(summary) {
  if (!summary || summary.context_overflow !== true) return null;
  if (summary.terminal_status === 'done') return null; // recovered, not killed
  return { harness_error: 'context_overflow' };
}
