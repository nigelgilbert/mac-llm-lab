// Spawn the `claw` agent CLI in one-shot mode and capture stdout/stderr,
// plus per-iteration telemetry for the iteration-distribution work
// (TODO-ITERATION-DISTRIBUTION-TEST.md, W1).
//
// The original contract — `{ code, signal, stdout, stderr, elapsedMs }` —
// is preserved and additive fields are appended (`runId`, `iterationsPath`,
// `runSummaryPath`, `iterCount`, `joinStatus`). Existing tests don't have to
// be touched; the sweep driver consumes the new fields.
//
// claw inherits ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY from our env (set by
// docker-compose.yml from ../litellm/.env), so it talks to the bridge with
// the right credentials with no additional plumbing.
//
// Per-run sidecar layout (under /workspace/.claw-runtime/<run-id>/, which is
// host-mounted to host/test/.claw-runtime/<run-id>/):
//   sessions/<workspace-hash>/session-*.jsonl   — moved from /workspace/.claw/
//   bridge.iterations.jsonl                     — slice of _bridge.jsonl by run window
//   iterations.jsonl                            — per-iteration record (W1 schema v1)
//   run_summary.json                            — per-run summary

import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { WORKSPACE } from './workspace.js';
import { emitRow } from './run_row.js';
import { readManifest } from './test_manifest.js';

const SCHEMA_VERSION = 1;
const RUNTIME_ROOT = '/workspace/.claw-runtime';
const SESSIONS_PARENT = path.join(WORKSPACE, '.claw', 'sessions');
const BRIDGE_LOG = path.join(RUNTIME_ROOT, '_bridge.jsonl');
const TELEMETRY_DISABLED = process.env.ITER_DIST_DISABLED === '1';

// Heuristic from canonical claw tool names (see
// /src/claw-code/rust/crates/tools/src/lib.rs, audited 2026-04-28). Any tool
// that mutates the workspace tree maps to `true`. Reads/searches map to
// `false`. `bash` and unknown tools map to `null` (caller must decide).
const WORKSPACE_CHANGED_BY_TOOL = {
  read_file: false,
  write_file: true,
  edit_file: true,
  glob_search: false,
  grep_search: false,
  WebFetch: false,
  WebSearch: false,
  TodoWrite: false,
  ToolSearch: false,
  Skill: false,
  Agent: false,
  NotebookEdit: true,
  Sleep: false,
  SendUserMessage: false,
  Config: false,
  EnterPlanMode: false,
  ExitPlanMode: false,
  AskUserQuestion: false,
  StructuredOutput: false,
  REPL: false,
  PowerShell: null,
  bash: null,
};

const ERROR_CLASS_PATTERNS = [
  [/(?:^|\W)Error: Cannot find module|MODULE_NOT_FOUND/i, 'module_not_found'],
  [/SyntaxError\b/, 'syntax_error'],
  [/TypeError\b/, 'type_error'],
  [/ReferenceError\b/, 'reference_error'],
  [/AssertionError\b/, 'assertion_error'],
  [/(?:^|\W)permission denied|EACCES/i, 'permission_denied'],
  [/(?:^|\W)ENOENT|no such file or directory/i, 'not_found'],
  [/(?:^|\W)timed? ?out|ETIMEDOUT/i, 'timeout'],
  [/(?:^|\s)not exit code 0|exited with code [^0]/i, 'nonzero_exit'],
];

/** @returns {Promise<import('./runAgent.js').RunnerResult>} — minimum contract; extra telemetry fields ride along untyped. */
export function runClaw({
  prompt,
  model,
  signal,
  extraArgs = [],
}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--model', model, ...extraArgs];
    const runId = randomUUID();
    const runStartedMs = Date.now();

    // Sprint 1.22: cancellation is delegated to the caller's AbortSignal
    // (typically node:test's t.signal). The harness no longer holds a
    // setTimeout — node:test's per-test timeout is the single source of truth,
    // so a single dial governs both the assertion failure ('agent timed out')
    // and the child reap.
    const child = spawn('claw', args, {
      cwd: WORKSPACE,
      // CLAW_RUN_ID is informational — claw itself does not read it. The
      // bridge has no header path (see Step 0.5 audit), so run-id is
      // assigned harness-side and bridge records are joined by time-window.
      env: { ...process.env, CLAW_RUN_ID: runId },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });

    child.on('error', (err) => {
      if (err.name === 'AbortError') return;
      reject(err);
    });

    child.on('close', (code, killSig) => {
      const runFinishedMs = Date.now();
      const elapsedMs = runFinishedMs - runStartedMs;
      const aborted = !!signal?.aborted;

      let extras = { runId };
      if (!TELEMETRY_DISABLED) {
        try {
          const meta = collectRunArtifacts({
            runId,
            runStartedMs,
            runFinishedMs,
            code,
            timeout: aborted,
            model,
          });
          extras = { ...extras, ...meta };
        } catch (e) {
          // Best-effort: never fail the test on telemetry hiccups.
          console.error(
            `[iter-distribution] artifact collection failed for ${runId}: ${e.stack || e.message}`,
          );
        }
      }

      // Sprint 1.13 (research-team direction, 2026-04-29 memo): on timeout,
      // resolve with a structured result instead of rejecting. This lets the
      // caller still call writeAssertionResult, so every attempted (test ×
      // tier × rep) cell produces a registry row. Without this, a timeout
      // throws before assertion_result.json is written and Sprint 2's Wilson
      // CIs would be computed against observed N rather than planned N.
      // Test files see r.code === null and r.terminal_status === 'timeout',
      // and their existing assert.equal(r.code, 0) still fails the test —
      // but the row has already landed.
      if (aborted) {
        resolve({
          code: null,
          signal: null,
          stdout,
          stderr,
          elapsedMs,
          terminal_status: 'timeout',
          timeout: true,
          ...extras,
        });
        return;
      }
      resolve({ code, signal: killSig, stdout, stderr, elapsedMs, ...extras });
    });
  });
}

/**
 * Persist the eval-test assertion outcome alongside run_summary.json so
 * `passed` can be propagated into the run table. Without this, run_summary.json
 * sees `passed: null` and the failed-tail stratum misses runs where claw exits
 * 0 but the verify-script assertion fails.
 *
 * Writes <runDir>/assertion_result.json. Best-effort — never throws.
 *
 * Sprint 1.5: when `RUN_REGISTRY_EMIT=1` is set, also assemble + append a
 * tier-eval-v2 registry row using lib/run_row.js. Required envs:
 *   - RUN_REGISTRY_KIND               (default: smoke)
 *   - RUN_REGISTRY_HARDWARE_TIER      (default: TIER env, then 64)
 *   - RUN_REGISTRY_MEMORY_GB          (default: == hardware_tier)
 *   - RUN_REGISTRY_MODEL_CONFIG_ID    (required)
 *   - RUN_REGISTRY_HARNESS_VERSION    (default: GIT_SHA env, then "unknown")
 *   - RUN_REGISTRY_TESTS_DIR          (default: /test/__tests__/tier-eval)
 *   - RUN_REGISTRY_PATH               (default: lib/registry.js DEFAULT)
 *   - MODEL_CONFIG_MANIFEST_PATH      (default: lib/model_configs.json)
 * Test_id is read from run_summary.json (set by ITER_DIST_TEST_ID at run time);
 * test_version + oracle_type are joined from the test_manifest header.
 *
 * Emission failure is logged to stderr but does not throw — discipline is to
 * inspect stderr at sweep tail rather than half-fail an assert.
 */
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

  const model_config_id = process.env.RUN_REGISTRY_MODEL_CONFIG_ID;
  if (!model_config_id) {
    console.error(`[run-registry] RUN_REGISTRY_MODEL_CONFIG_ID required when RUN_REGISTRY_EMIT=1; skipping emit`);
    return;
  }
  const tier = parseInt(process.env.RUN_REGISTRY_HARDWARE_TIER || process.env.TIER || '64', 10);
  const memory = parseInt(process.env.RUN_REGISTRY_MEMORY_GB || String(tier), 10);

  const ctx = {
    run_kind: process.env.RUN_REGISTRY_KIND || 'smoke',
    hardware_tier: tier,
    memory_gb: memory,
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
    // Sprint 1.13: pass null through unchanged when claw aborted on timeout.
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

// --- W1 telemetry ------------------------------------------------------------

function collectRunArtifacts({
  runId,
  runStartedMs,
  runFinishedMs,
  code,
  timeout,
  model,
}) {
  const runDir = path.join(RUNTIME_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const sessionRecords = moveAndReadSessionFiles(runDir);
  const bridgeRecords = sliceBridgeLog(runDir, runStartedMs, runFinishedMs);

  // Claw's persisted session JSONL nests message records under a `message`
  // wrapper: `{ "type": "message", "message": { "role": ..., "blocks": [...], "usage": {...} } }`.
  // Normalize to a flat shape early so the rest of the joiner can ignore the wrapper.
  const messages = sessionRecords
    .filter((r) => r.type === 'message' && r.message && typeof r.message === 'object')
    .map((r) => ({
      role: r.message.role ?? null,
      blocks: r.message.blocks ?? [],
      usage: r.message.usage ?? null,
    }));

  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  const sessionMeta = sessionRecords.find((r) => r.type === 'session_meta') || null;

  const toolResultByUseId = new Map();
  for (const tm of toolMsgs) {
    for (const block of tm.blocks || []) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        toolResultByUseId.set(block.tool_use_id, block);
      }
    }
  }

  const joinStatus = computeJoinStatus({
    assistantMsgs,
    bridgeRecords,
    timeout,
  });

  // Per-iteration: walk seen-call history (state-change diagnostics).
  const seenCalls = new Map();
  const iterRecords = [];
  let totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreate: 0,
    cacheRead: 0,
    modelMs: 0,
    nonModelGapMs: 0,
    serverDecodeMs: 0,
    serverPromptMs: 0,
    serverTotalMs: 0,
  };
  let serverDecodeNullCount = 0;
  let serverTotalNullCount = 0;
  let maxInputTokens = 0;
  let toolCallCountTotal = 0;
  let workspaceChangedCount = 0;
  let resultChangedCount = 0;
  let noProgressRepeatCount = 0;
  let errorToolCallCount = 0;
  const uniqueArgHashes = new Set();
  let repeatedToolCallCount = 0;

  for (let k = 0; k < assistantMsgs.length; k++) {
    const am = assistantMsgs[k];
    const br = bridgeRecords[k] || {};
    const usage = am.usage || {};

    const inputTokens = numOrNull(usage.input_tokens);
    const outputTokens = numOrNull(usage.output_tokens);
    const cacheCreate = numOrNull(usage.cache_creation_input_tokens) ?? 0;
    const cacheRead = numOrNull(usage.cache_read_input_tokens) ?? 0;

    if (inputTokens != null) totals.inputTokens += inputTokens;
    if (outputTokens != null) totals.outputTokens += outputTokens;
    totals.cacheCreate += cacheCreate;
    totals.cacheRead += cacheRead;
    if (inputTokens != null && inputTokens > maxInputTokens) maxInputTokens = inputTokens;

    const modelElapsedMs = numOrNull(br.model_elapsed_ms);
    if (modelElapsedMs != null) totals.modelMs += modelElapsedMs;
    const serverPromptMs = numOrNull(br.server_prompt_eval_ms);
    const serverDecodeMs = numOrNull(br.server_decode_ms);
    const serverTotalMs = numOrNull(br.server_total_ms);
    if (serverPromptMs != null) totals.serverPromptMs += serverPromptMs;
    if (serverDecodeMs != null) totals.serverDecodeMs += serverDecodeMs;
    else serverDecodeNullCount += 1;
    if (serverTotalMs != null) totals.serverTotalMs += serverTotalMs;
    else serverTotalNullCount += 1;

    const toolUses = (am.blocks || []).filter((b) => b.type === 'tool_use');
    toolCallCountTotal += toolUses.length;

    const toolCalls = toolUses.map((tu) => {
      const tr = toolResultByUseId.get(tu.id) || null;
      const argHash = sha256OfStable(tu.input);
      const argSummary = makeArgSummary(tu.input);
      const resultOutput = tr?.output ?? '';
      const resultHash = sha256OfStable(resultOutput);
      const isError = !!tr?.is_error;
      const errorClass = isError ? classifyError(resultOutput) : null;
      const errorSignature = isError ? extractErrorSignature(resultOutput) : null;

      const seenKey = `${tu.name}::${argHash}`;
      const prior = seenCalls.get(seenKey);
      let resultChangedVsPrev = null;
      if (prior !== undefined) {
        resultChangedVsPrev = prior !== resultHash;
        if (resultChangedVsPrev) resultChangedCount += 1;
        else noProgressRepeatCount += 1;
        repeatedToolCallCount += 1;
      } else {
        uniqueArgHashes.add(seenKey);
      }
      seenCalls.set(seenKey, resultHash);

      const workspaceChanged = computeWorkspaceChanged(tu.name, isError);
      if (workspaceChanged === true) workspaceChangedCount += 1;
      if (isError) errorToolCallCount += 1;

      return {
        id: tu.id ?? null,
        name: tu.name ?? null,
        // outcome (b): tool timestamps not available
        started_ms: null,
        finished_ms: null,
        elapsed_ms: null,
        arg_hash: argHash,
        arg_summary: argSummary,
        workspace_changed: workspaceChanged,
        result_hash: resultHash,
        result_changed_vs_previous_same_call: resultChangedVsPrev,
        result_is_error: isError,
        result_error_class: errorClass,
        result_error_signature: errorSignature,
      };
    });

    let iterationElapsedMs = null;
    let nonModelGapMs = null;
    const nextBr = bridgeRecords[k + 1];
    if (br.request_started_ms != null) {
      if (nextBr && nextBr.request_started_ms != null) {
        iterationElapsedMs = nextBr.request_started_ms - br.request_started_ms;
      } else {
        iterationElapsedMs = runFinishedMs - br.request_started_ms;
      }
    }
    if (br.request_finished_ms != null) {
      if (nextBr && nextBr.request_started_ms != null) {
        nonModelGapMs = nextBr.request_started_ms - br.request_finished_ms;
      } else {
        nonModelGapMs = runFinishedMs - br.request_finished_ms;
      }
      if (nonModelGapMs != null) totals.nonModelGapMs += Math.max(0, nonModelGapMs);
    }

    const isFinal = k === assistantMsgs.length - 1;
    const iterationStatus = isFinal ? (timeout ? 'aborted' : 'final') : 'continue';
    const runStatus = isFinal
      ? (timeout ? 'timeout' : (code === 0 ? 'done' : 'error'))
      : null;

    iterRecords.push({
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      test_id: process.env.ITER_DIST_TEST_ID ?? null,
      sampler_id: process.env.ITER_DIST_SAMPLER_ID ?? null,
      iter: k + 1,
      assistant_message_index: k,
      bridge_request_seq: numOrNull(br.bridge_request_seq),
      join_status: joinStatus,
      request_started_ms: numOrNull(br.request_started_ms),
      request_finished_ms: numOrNull(br.request_finished_ms),
      model_elapsed_ms: modelElapsedMs,
      iter_tool_elapsed_ms: null,
      non_model_gap_ms: nonModelGapMs,
      non_model_gap_source: 'next_request_start_minus_current_request_finish',
      iteration_elapsed_ms: iterationElapsedMs,
      server_prompt_eval_ms: serverPromptMs,
      server_decode_ms: serverDecodeMs,
      server_total_ms: serverTotalMs,
      server_queue_ms: null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
      stop_reason: br.stop_reason ?? null,
      tool_calls: toolCalls,
      iteration_status: iterationStatus,
      run_status: runStatus,
    });
  }

  const iterPath = path.join(runDir, 'iterations.jsonl');
  fs.writeFileSync(
    iterPath,
    iterRecords.map((r) => JSON.stringify(r)).join('\n') + (iterRecords.length ? '\n' : ''),
  );

  const runSummary = buildRunSummary({
    runId,
    runStartedMs,
    runFinishedMs,
    code,
    timeout,
    model,
    iterRecords,
    sessionMeta,
    bridgeRecords,
    totals,
    serverDecodeNullCount,
    serverTotalNullCount,
    maxInputTokens,
    toolCallCountTotal,
    workspaceChangedCount,
    resultChangedCount,
    noProgressRepeatCount,
    errorToolCallCount,
    uniqueArgHashesCount: uniqueArgHashes.size,
    repeatedToolCallCount,
    joinStatus,
  });
  const summaryPath = path.join(runDir, 'run_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(runSummary, null, 2) + '\n');

  return {
    runDir,
    iterationsPath: iterPath,
    runSummaryPath: summaryPath,
    bridgeIterationsPath: path.join(runDir, 'bridge.iterations.jsonl'),
    iterCount: iterRecords.length,
    joinStatus,
  };
}

function moveAndReadSessionFiles(runDir) {
  const records = [];
  if (!fs.existsSync(SESSIONS_PARENT)) return records;
  for (const hashDir of fs.readdirSync(SESSIONS_PARENT)) {
    const srcHashDir = path.join(SESSIONS_PARENT, hashDir);
    let st;
    try { st = fs.statSync(srcHashDir); } catch { continue; }
    if (!st.isDirectory()) continue;

    const dstHashDir = path.join(runDir, 'sessions', hashDir);
    fs.mkdirSync(dstHashDir, { recursive: true });

    for (const fname of fs.readdirSync(srcHashDir)) {
      if (!fname.startsWith('session-') || !fname.endsWith('.jsonl')) continue;
      const src = path.join(srcHashDir, fname);
      const dst = path.join(dstHashDir, fname);
      try {
        fs.renameSync(src, dst);
      } catch (e) {
        // If rename fails (cross-device), copy then delete.
        fs.copyFileSync(src, dst);
        try { fs.unlinkSync(src); } catch { /* ignore */ }
      }
      const body = fs.readFileSync(dst, 'utf8');
      for (const line of body.split('\n')) {
        const trim = line.trim();
        if (!trim) continue;
        try {
          records.push(JSON.parse(trim));
        } catch {
          // skip malformed; will be reflected in join_status
        }
      }
    }
  }
  return records;
}

function sliceBridgeLog(runDir, runStartedMs, runFinishedMs) {
  const out = [];
  if (!fs.existsSync(BRIDGE_LOG)) {
    fs.writeFileSync(path.join(runDir, 'bridge.iterations.jsonl'), '');
    return out;
  }
  const all = fs.readFileSync(BRIDGE_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of all) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (typeof rec.request_finished_ms !== 'number') continue;
    if (typeof rec.request_started_ms !== 'number') continue;
    // 100ms epsilon to capture clock skew between Node and Python time bases.
    if (
      rec.request_finished_ms >= runStartedMs - 100 &&
      rec.request_started_ms <= runFinishedMs + 100
    ) {
      out.push(rec);
    }
  }
  out.sort((a, b) => (a.bridge_request_seq ?? 0) - (b.bridge_request_seq ?? 0));
  fs.writeFileSync(
    path.join(runDir, 'bridge.iterations.jsonl'),
    out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''),
  );
  return out;
}

function computeJoinStatus({ assistantMsgs, bridgeRecords, timeout }) {
  if (timeout) {
    if (assistantMsgs.length !== bridgeRecords.length) {
      return 'stream_aborted_mid_run+count_mismatch';
    }
    return 'stream_aborted_mid_run';
  }
  if (assistantMsgs.length === 0 && bridgeRecords.length === 0) {
    return 'empty_run';
  }
  if (assistantMsgs.length !== bridgeRecords.length) {
    if (assistantMsgs.length > bridgeRecords.length) return 'orphan_transcript_record';
    return 'orphan_bridge_record';
  }
  // Token agreement (best-effort, soft check — cache reads can shift accounting).
  for (let i = 0; i < assistantMsgs.length; i++) {
    const am = assistantMsgs[i];
    const br = bridgeRecords[i];
    const aOut = am.usage?.output_tokens;
    if (aOut != null && br.output_tokens != null && aOut !== br.output_tokens) {
      return 'token_mismatch';
    }
  }
  // Sequence monotonic check.
  for (let i = 1; i < bridgeRecords.length; i++) {
    if ((bridgeRecords[i].bridge_request_seq ?? 0) <= (bridgeRecords[i - 1].bridge_request_seq ?? 0)) {
      return 'non_monotonic_seq';
    }
  }
  return 'ok';
}

function buildRunSummary({
  runId,
  runStartedMs,
  runFinishedMs,
  code,
  timeout,
  model,
  iterRecords,
  sessionMeta,
  bridgeRecords,
  totals,
  serverDecodeNullCount,
  serverTotalNullCount,
  maxInputTokens,
  toolCallCountTotal,
  workspaceChangedCount,
  resultChangedCount,
  noProgressRepeatCount,
  errorToolCallCount,
  uniqueArgHashesCount,
  repeatedToolCallCount,
  joinStatus,
}) {
  const timing_caveats = [];
  if (serverDecodeNullCount === iterRecords.length && iterRecords.length > 0) {
    timing_caveats.push(
      'all_iterations_streaming_no_decode_split: server_prompt_eval_ms and server_decode_ms unavailable per iteration; only server_total_ms (LiteLLM-observed upstream wallclock) populated.',
    );
  } else if (serverDecodeNullCount > 0) {
    timing_caveats.push(
      `mixed_streaming_decode_split: ${serverDecodeNullCount}/${iterRecords.length} iterations missing prompt/decode split.`,
    );
  }
  if (joinStatus !== 'ok') {
    timing_caveats.push(`join_status_${joinStatus}`);
  }

  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    test_id: process.env.ITER_DIST_TEST_ID ?? null,
    sampler_id: process.env.ITER_DIST_SAMPLER_ID ?? null,
    git_sha: process.env.GIT_SHA ?? null,
    docker_image_digest: process.env.DOCKER_IMAGE_DIGEST ?? null,
    model_id: model,
    model_digest: process.env.MODEL_DIGEST ?? null,
    llama_server_build: process.env.LLAMA_SERVER_BUILD ?? null,
    ctx: process.env.CTX ? parseInt(process.env.CTX, 10) : 65536,
    temperature: floatEnv('SAMPLER_TEMPERATURE'),
    top_p: floatEnv('SAMPLER_TOP_P'),
    top_k: intEnv('SAMPLER_TOP_K'),
    presence_penalty: floatEnv('SAMPLER_PRESENCE_PENALTY'),
    hardware_instance: process.env.HARDWARE_INSTANCE ?? 'M5',
    concurrency: 1,
    // Sprint 1.22: dropped from runClaw's signature when cancellation moved to
    // the caller's AbortSignal. Build-run-table.py propagates null through.
    timeout_ms: null,
    max_iterations: process.env.CLAW_MAX_ITERATIONS ? parseInt(process.env.CLAW_MAX_ITERATIONS, 10) : null,
    run_started_ms: runStartedMs,
    run_finished_ms: runFinishedMs,
    run_elapsed_ms: runFinishedMs - runStartedMs,
    iter_count: iterRecords.length,
    total_input_tokens: totals.inputTokens,
    total_output_tokens: totals.outputTokens,
    total_cache_creation_input_tokens: totals.cacheCreate,
    total_cache_read_input_tokens: totals.cacheRead,
    total_model_elapsed_ms: totals.modelMs || null,
    total_iter_tool_elapsed_ms: null,
    total_non_model_gap_ms: totals.nonModelGapMs,
    non_model_gap_source: 'next_request_start_minus_current_request_finish',
    total_server_decode_ms:
      serverDecodeNullCount === iterRecords.length ? null : totals.serverDecodeMs,
    total_server_prompt_eval_ms:
      serverDecodeNullCount === iterRecords.length ? null : totals.serverPromptMs,
    total_server_total_ms:
      serverTotalNullCount === iterRecords.length ? null : totals.serverTotalMs,
    max_input_tokens: maxInputTokens,
    tool_call_count: toolCallCountTotal,
    unique_tool_arg_hash_count: uniqueArgHashesCount,
    repeated_tool_call_count: repeatedToolCallCount,
    workspace_changed_count: workspaceChangedCount,
    result_changed_vs_prev_count: resultChangedCount,
    no_progress_repeat_count: noProgressRepeatCount,
    error_tool_call_count: errorToolCallCount,
    terminal_status: timeout ? 'timeout' : (code === 0 ? 'done' : 'error'),
    passed: null,
    timeout: !!timeout,
    context_overflow: false,
    exit_code: code,
    join_status: joinStatus,
    censored: !!timeout,
    timing_caveats,
    session_id: sessionMeta?.session_id ?? null,
    session_workspace_root: sessionMeta?.workspace_root ?? null,
    session_created_at_ms: sessionMeta?.created_at_ms ?? null,
  };
}

function computeWorkspaceChanged(toolName, isError) {
  if (isError) return false;  // failed call did nothing observable
  if (toolName == null) return null;
  if (toolName in WORKSPACE_CHANGED_BY_TOOL) {
    return WORKSPACE_CHANGED_BY_TOOL[toolName];
  }
  return null;
}

function classifyError(text) {
  if (typeof text !== 'string') text = String(text ?? '');
  for (const [re, label] of ERROR_CLASS_PATTERNS) {
    if (re.test(text)) return label;
  }
  return 'other';
}

function extractErrorSignature(text) {
  if (typeof text !== 'string') text = String(text ?? '');
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/error|fail|denied|not found|exit/i.test(t) || /[A-Z][a-z]+Error\b/.test(t)) {
      return t.slice(0, 200);
    }
  }
  return lines[0]?.trim().slice(0, 200) ?? null;
}

function makeArgSummary(input) {
  if (input == null) return null;
  let obj;
  try {
    obj = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return { _raw_arg_string_excerpt: String(input).slice(0, 200) };
  }
  if (typeof obj !== 'object' || obj === null) {
    return { value: obj };
  }
  // Copy small primitives; truncate long strings.
  const summary = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      summary[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      summary[k] = v;
    } else if (Array.isArray(v)) {
      summary[k] = `[array len=${v.length}]`;
    } else {
      summary[k] = '[object]';
    }
  }
  return summary;
}

function sha256OfStable(value) {
  let s;
  if (typeof value === 'string') {
    s = value;
  } else {
    s = stringifySorted(value ?? null);
  }
  return 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
}

function stringifySorted(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stringifySorted).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringifySorted(value[k])).join(',') + '}';
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function floatEnv(name) {
  const v = process.env[name];
  if (v == null || v === '') return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function intEnv(name) {
  const v = process.env[name];
  if (v == null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

