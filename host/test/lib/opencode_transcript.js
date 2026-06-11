// OpenCode transcript adapter (issue #021) — normalize an OpenCode session log
// into the EXISTING per-iteration schema (`iterations.jsonl` schema v1, defined
// by the retired claw runner — archived at tag `claw-stack-final`) so
// iteration/token counts stay cross-config comparable with the historical rows.
//
// SOURCE OF TRUTH: the on-disk SQLite DB, NOT the `--format json` stdout stream.
// Two findings from #020 (client/opencode/docs/SESSION-LOG-FORMAT.md) drive this:
//   1. OpenCode 1.16.2 persists the whole session into a single SQLite DB
//      (~/.local/share/opencode/opencode.db + -wal/-shm) — three tables carry the
//      transcript: `session` (run rollup), `message` (one row per turn), `part`
//      (ordered pieces within a turn). Read WITH the -wal/-shm present so SQLite
//      applies the write-ahead log transparently.
//   2. The stdout event stream is LOSSY (no text events, truncates the final
//      step_finish), so it is never the source here.
//
// MAPPING (SESSION-LOG-FORMAT.md §4): one assistant `message` row → one iteration
// record. §4.1 direct fields map cleanly (tokens per-iteration, tool callID/name,
// object-valued args, per-call timestamps). §4.2 gaps are degraded honestly:
//   - server prompt/decode split is NOT in the session log → null here, recovered
//     via the #022 server-timings join (server.timings.jsonl) when enabled.
//   - no LiteLLM bridge → bridge_request_seq/request-timing join fields n/a;
//     join_status = 'n/a_opencode'. Per-iteration wallclock comes from
//     message.data.time.created/completed instead.
//   - reasoning tokens have no claw slot → surfaced as an additive
//     `reasoning_tokens` field (not silently dropped).
//   - cost is always 0 (local model) → ignored.
//   - tool error = state.status !== 'completed' OR (bash) metadata.exit !== 0;
//     EXCEPT on a censored (timeout) run, where a part still pending/running was
//     in flight when the container was hard-killed → classified 'truncated'
//     (result_truncated, truncated_tool_call_count), not an error (#017).
//   - unmapped tools → workspace_changed=null AND flagged (`tool_unmapped`).
//
// A wedged/killed run leaves a partial or absent DB (#020 §6). Every entry point
// here degrades — returns null / empty rather than throwing — so the runner can
// fall back to its outcome-only sidecar (the claw `terminal_status:'timeout'`
// analog) and never hang.
//
// The small pure helpers (sha256OfStable, makeArgSummary, classifyError,
// extractErrorSignature, stringifySorted, strictNumOrNull) were duplicated from
// the retired claw runner — the original schema-v1 writer — deliberately, to
// avoid importing its heavy module graph (workspace/run_row/test_manifest/
// config) into the runner's hot path. This module is now their canonical home.
// (The Number()-coercing `numOrNull` lives in opencode_server_timings.js —
// issue #017 keeps exactly one exported coercing version across both modules.)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import {
  joinServerTimings,
  writeServerTimingsSidecar,
  findContextOverflowMarker,
} from './opencode_server_timings.js';

const SCHEMA_VERSION = 1;

// OpenCode build-agent tool set → workspace-mutation map (SESSION-LOG-FORMAT.md
// §5). The analog of claw's WORKSPACE_CHANGED_BY_TOOL. `true` mutates the
// workspace tree; `false` is read-only; `null` is conditional/unknown (caller
// decides). The 12 tools are the authoritative registered set from the working
// run's `tool.registry status=started` log lines.
export const OPENCODE_WORKSPACE_CHANGED_BY_TOOL = {
  write: true,       // creates/overwrites a file
  edit: true,        // edits a file (oldString/newString, emits a diff)
  bash: null,        // conditional — inspect metadata.exit + command (mirrors claw)
  read: false,       // read-only
  glob: false,       // path search
  grep: false,       // content search
  webfetch: false,   // network read
  todowrite: false,  // mutates todo state, NOT the workspace tree
  skill: false,      // injects instructions into context
  question: false,   // interactive prompt (denied in headless)
  invalid: false,    // error placeholder for an unrecognized tool call
  task: null,        // spawns a sub-agent that may mutate via its OWN tools → unknown here
};

// Schema-v1 error-class conventions (carried over from the retired claw runner).
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

// ---------------------------------------------------------------------------
// SQLite reader — pull the three transcript tables for a run's session.
// ---------------------------------------------------------------------------

/**
 * Read an OpenCode session out of its SQLite DB. Selects the latest session row
 * (a `run --rm` DB holds exactly one; the persistent-exec path may hold several
 * — newest wins) and its messages + parts, with `data` JSON pre-parsed.
 *
 * Engine: Node's built-in `node:sqlite` (stable in Node 24, our test image)
 * applies the -wal/-shm transparently. Falls back to the `sqlite3` CLI when the
 * builtin is unavailable. Returns null when the DB is missing/empty/unreadable
 * (wedged run, #020 §6) so the caller can degrade — never throws.
 *
 * @param {string} dbPath  Path to opencode.db (with sibling -wal/-shm present).
 * @returns {{ session: object|null, messages: object[], parts: object[] } | null}
 */
export function readOpenCodeSession(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  try {
    const raw = readViaNodeSqlite(dbPath) ?? readViaSqliteCli(dbPath);
    if (!raw) return null;
    return shapeRawTables(raw);
  } catch (e) {
    console.error(`[opencode-transcript] DB read failed for ${dbPath}: ${e.message}`);
    return null;
  }
}

const SESSION_SQL =
  'SELECT * FROM session ORDER BY time_created DESC, id DESC LIMIT 1;';
const MESSAGE_SQL =
  'SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id;';
const PART_SQL =
  'SELECT id, message_id, session_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id;';

function readViaNodeSqlite(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'));
  } catch {
    return null; // builtin not present (older Node) → caller tries the CLI
  }
  const db = new DatabaseSync(dbPath);
  try {
    const session = db.prepare(SESSION_SQL).get() ?? null;
    if (!session) return { session: null, messages: [], parts: [] };
    const messages = db.prepare(MESSAGE_SQL).all(session.id);
    const parts = db.prepare(PART_SQL).all(session.id);
    return { session, messages, parts };
  } finally {
    db.close();
  }
}

/**
 * Build the sqlite3-CLI argv for a query, splicing an optional bind value in
 * as a single-quoted SQL string literal. #017 hardening of the degrade path
 * (only reached when node:sqlite is absent): the old inline
 * sql.replace('?', `'${bind}'`) left single quotes unescaped AND let
 * String.replace interpret `$`-patterns ($&, $', …) in the bind. Quotes are
 * doubled per SQL ('' escaping) and the replacement is a FUNCTION, which
 * String.replace inserts verbatim — no $-pattern expansion. Exported for the
 * unit test that pins this.
 *
 * @param {string} dbPath
 * @param {string} sql           Query with at most one `?` placeholder.
 * @param {string} [bind]        Value spliced into the `?` (session id).
 * @returns {string[]} argv for spawnSync('sqlite3', argv).
 */
export function buildSqliteCliArgs(dbPath, sql, bind) {
  const bound = bind == null
    ? sql
    : sql.replace('?', () => `'${String(bind).replace(/'/g, "''")}'`);
  return ['-readonly', '-json', dbPath, bound];
}

function readViaSqliteCli(dbPath) {
  const q = (sql, bind) => {
    const args = buildSqliteCliArgs(dbPath, sql, bind);
    const r = spawnSync('sqlite3', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`sqlite3 exited ${r.status}: ${(r.stderr || '').trim()}`);
    const out = (r.stdout || '').trim();
    return out ? JSON.parse(out) : [];
  };
  const sessions = q(SESSION_SQL);
  const session = sessions[0] ?? null;
  if (!session) return { session: null, messages: [], parts: [] };
  return {
    session,
    messages: q(MESSAGE_SQL, session.id),
    parts: q(PART_SQL, session.id),
  };
}

// Parse the JSON `data` blob on each message/part row; drop rows whose blob is
// malformed (reflected later as missing iterations rather than a crash).
function shapeRawTables({ session, messages, parts }) {
  return {
    session,
    messages: (messages || []).map((r) => withParsedData(r)).filter(Boolean),
    parts: (parts || []).map((r) => withParsedData(r)).filter(Boolean),
  };
}

function withParsedData(row) {
  if (!row || typeof row !== 'object') return null;
  let data = row.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  return { ...row, data };
}

// ---------------------------------------------------------------------------
// Normalizer — PURE: parsed DB rows → iteration records + run_summary.
// ---------------------------------------------------------------------------

/**
 * Normalize a parsed OpenCode session into schema-v1 iteration records plus a
 * run_summary. Pure (no I/O) so it is unit-tested directly against fixtures
 * extracted from real DB bytes.
 *
 * @param {Object} o
 * @param {object|null} o.session        The `session` row (columns; `model` is a JSON string).
 * @param {object[]}    o.messages       Message rows with `data` parsed (user + assistant).
 * @param {object[]}    o.parts          Part rows with `data` parsed.
 * @param {string}      o.runId
 * @param {number}      [o.runStartedMs]
 * @param {number}      [o.runFinishedMs]
 * @param {number|null} [o.code]         Agent exit code (null on timeout).
 * @param {boolean}     [o.timeout=false]
 * @param {number}      [o.timeoutMs]
 * @param {object|null} [o.contextOverflow]  #002: the context-overflow marker
 *   scanned out of this run's server-log capture window (shape from
 *   opencode_server_timings.scanContextOverflow), or null. When present and
 *   the run did NOT finish clean, the run_summary is re-typed
 *   terminal_status 'harness_error' (Layer-A: serving artifact, not a model
 *   capability failure) so the emitted row drops out of pass denominators.
 * @returns {{ iterRecords: object[], runSummary: object }}
 */
export function normalizeOpenCodeSession({
  session = null,
  messages = [],
  parts = [],
  runId,
  runStartedMs = null,
  runFinishedMs = null,
  code = null,
  timeout = false,
  timeoutMs = null,
  contextOverflow = null,
}) {
  // Assistant message = one iteration; user message is skipped. Ordered by the
  // DB read (time_created, id); re-sort defensively in case caller reordered.
  const assistantMsgs = messages
    .filter((m) => m?.data && m.data.role === 'assistant')
    .sort((a, b) => (a.time_created - b.time_created) || cmp(a.id, b.id));

  // Group parts by their message_id, preserving (time_created, id) order.
  const partsByMessage = new Map();
  for (const p of parts) {
    if (!p?.message_id) continue;
    if (!partsByMessage.has(p.message_id)) partsByMessage.set(p.message_id, []);
    partsByMessage.get(p.message_id).push(p);
  }
  for (const arr of partsByMessage.values()) {
    arr.sort((a, b) => (a.time_created - b.time_created) || cmp(a.id, b.id));
  }

  const seenCalls = new Map(); // `${name}::${argHash}` → last result_hash
  const iterRecords = [];
  const totals = {
    inputTokens: 0, outputTokens: 0, cacheCreate: 0, cacheRead: 0,
    reasoningTokens: 0, toolElapsedMs: 0, nonModelGapMs: 0,
  };
  let toolElapsedSeen = false;
  let maxInputTokens = 0;
  let toolCallCountTotal = 0;
  let workspaceChangedCount = 0;
  let resultChangedCount = 0;
  let noProgressRepeatCount = 0;
  let errorToolCallCount = 0;
  let truncatedToolCallCount = 0;
  let unmappedToolCallCount = 0;
  let repeatedToolCallCount = 0;
  const uniqueArgHashes = new Set();

  for (let k = 0; k < assistantMsgs.length; k++) {
    const am = assistantMsgs[k];
    const d = am.data || {};
    const tokens = d.tokens || {};
    const cache = tokens.cache || {};

    const inputTokens = strictNumOrNull(tokens.input);
    const outputTokens = strictNumOrNull(tokens.output);
    const reasoningTokens = strictNumOrNull(tokens.reasoning) ?? 0;
    const cacheCreate = strictNumOrNull(cache.write) ?? 0;
    const cacheRead = strictNumOrNull(cache.read) ?? 0;

    if (inputTokens != null) totals.inputTokens += inputTokens;
    if (outputTokens != null) totals.outputTokens += outputTokens;
    totals.reasoningTokens += reasoningTokens;
    totals.cacheCreate += cacheCreate;
    totals.cacheRead += cacheRead;
    if (inputTokens != null && inputTokens > maxInputTokens) maxInputTokens = inputTokens;

    const createdMs = strictNumOrNull(d.time?.created);
    const completedMs = strictNumOrNull(d.time?.completed);

    const msgParts = partsByMessage.get(am.id) || [];
    const toolParts = msgParts.filter((p) => p?.data && p.data.type === 'tool');
    toolCallCountTotal += toolParts.length;

    let iterToolElapsedMs = null;
    const toolCalls = toolParts.map((p) => {
      const t = p.data;
      const st = t.state || {};
      const name = t.tool ?? null;
      const input = st.input;
      const argHash = sha256OfStable(input);
      const argSummary = makeArgSummary(input);
      const output = st.output ?? '';
      const resultHash = sha256OfStable(output);

      // §4.2.5 error shape: any non-'completed' status, or a non-zero bash exit.
      // EXCEPT (#017): on a censored run a part still pending/running was simply
      // in flight when the container was hard-killed (`docker rm -f`) — that is
      // truncation, not a tool failure. Truncated calls are excluded from error
      // counts (own counter instead) and their workspace_changed is null
      // (unknown — the kill raced the tool). An actually-errored part on a
      // censored run (status 'error', non-zero bash exit) still counts.
      const isTruncated = !!timeout && (st.status === 'pending' || st.status === 'running');
      const statusErr = st.status != null && st.status !== 'completed';
      const bashExit = name === 'bash' ? strictNumOrNull(st.metadata?.exit) : null;
      const isError = !isTruncated && (statusErr || (bashExit != null && bashExit !== 0));
      const errorClass = isError ? classifyError(output) : null;
      const errorSignature = isError ? extractErrorSignature(output) : null;

      const startedMs = strictNumOrNull(st.time?.start);
      const finishedMs = strictNumOrNull(st.time?.end);
      const elapsedMs = startedMs != null && finishedMs != null ? finishedMs - startedMs : null;
      if (elapsedMs != null) {
        iterToolElapsedMs = (iterToolElapsedMs ?? 0) + elapsedMs;
        toolElapsedSeen = true;
      }

      const seenKey = `${name}::${argHash}`;
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

      const toolUnmapped = name == null || !(name in OPENCODE_WORKSPACE_CHANGED_BY_TOOL);
      if (toolUnmapped) unmappedToolCallCount += 1;
      // Truncated → null (unknown), NOT the pre-#017 forced false via isError.
      const workspaceChanged = isTruncated ? null : computeWorkspaceChanged(name, isError);
      if (workspaceChanged === true) workspaceChangedCount += 1;
      if (isError) errorToolCallCount += 1;
      if (isTruncated) truncatedToolCallCount += 1;

      return {
        id: t.callID ?? null,
        name,
        // OpenCode carries per-call timestamps (claw outcome-only leaves null) — §4.3.
        started_ms: startedMs,
        finished_ms: finishedMs,
        elapsed_ms: elapsedMs,
        arg_hash: argHash,
        arg_summary: argSummary,
        workspace_changed: workspaceChanged,
        // Flag a tool not in OPENCODE_WORKSPACE_CHANGED_BY_TOOL (AC: recorded, not
        // crashing, and flagged). Distinct from bash/task which ARE mapped to null.
        tool_unmapped: toolUnmapped,
        result_hash: resultHash,
        result_changed_vs_previous_same_call: resultChangedVsPrev,
        result_is_error: isError,
        // #017: in-flight (pending/running) at hard-kill on a censored run.
        result_truncated: isTruncated,
        result_error_class: errorClass,
        result_error_signature: errorSignature,
      };
    });
    if (iterToolElapsedMs != null) totals.toolElapsedMs += iterToolElapsedMs;

    // Boundary timing mirrors claw's semantics but off message timestamps (§4.2.2):
    // iteration_elapsed = next.created - this.created (final → runFinished - created);
    // non_model_gap = next.created - this.completed (final → runFinished - completed).
    const next = assistantMsgs[k + 1];
    const nextCreatedMs = next ? strictNumOrNull(next.data?.time?.created) : null;
    let iterationElapsedMs = null;
    if (createdMs != null) {
      if (nextCreatedMs != null) iterationElapsedMs = nextCreatedMs - createdMs;
      else if (runFinishedMs != null) iterationElapsedMs = runFinishedMs - createdMs;
      else if (completedMs != null) iterationElapsedMs = completedMs - createdMs;
    }
    let nonModelGapMs = null;
    if (completedMs != null) {
      if (nextCreatedMs != null) nonModelGapMs = nextCreatedMs - completedMs;
      else if (runFinishedMs != null) nonModelGapMs = runFinishedMs - completedMs;
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
      // No LiteLLM bridge for OpenCode (§4.2.2) — bridge join fields are n/a.
      bridge_request_seq: null,
      join_status: 'n/a_opencode',
      // Per-iteration wallclock window from message timestamps (NOT pure model time).
      request_started_ms: createdMs,
      request_finished_ms: completedMs,
      // Pure model time is not isolable from the session log (turn window includes
      // tool exec) → null; the server split is recovered separately via #022.
      model_elapsed_ms: null,
      iter_tool_elapsed_ms: iterToolElapsedMs,
      non_model_gap_ms: nonModelGapMs,
      non_model_gap_source: 'next_message_created_minus_current_message_completed',
      iteration_elapsed_ms: iterationElapsedMs,
      // §4.2.1: prompt/decode split absent from the session log → null here.
      // Filled by the #022 server-timings join (server.timings.jsonl) when enabled.
      server_prompt_eval_ms: null,
      server_decode_ms: null,
      server_total_ms: null,
      server_queue_ms: null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
      // Additive vs claw: reasoning tokens have no claw slot (§4.2.3) — surfaced,
      // not dropped. 0 for Config B (thinking off) but honestly carried.
      reasoning_tokens: reasoningTokens,
      stop_reason: d.finish ?? null,
      tool_calls: toolCalls,
      iteration_status: iterationStatus,
      run_status: runStatus,
    });
  }

  const runSummary = buildRunSummary({
    session, runId, runStartedMs, runFinishedMs, code, timeout, timeoutMs,
    contextOverflow,
    iterRecords, totals, toolElapsedSeen, maxInputTokens, toolCallCountTotal,
    workspaceChangedCount, resultChangedCount, noProgressRepeatCount,
    errorToolCallCount, truncatedToolCallCount, unmappedToolCallCount,
    uniqueArgHashesCount: uniqueArgHashes.size, repeatedToolCallCount,
  });

  return { iterRecords, runSummary };
}

function buildRunSummary({
  session, runId, runStartedMs, runFinishedMs, code, timeout, timeoutMs,
  contextOverflow = null,
  iterRecords, totals, toolElapsedSeen, maxInputTokens, toolCallCountTotal,
  workspaceChangedCount, resultChangedCount, noProgressRepeatCount,
  errorToolCallCount, truncatedToolCallCount, unmappedToolCallCount,
  uniqueArgHashesCount, repeatedToolCallCount,
}) {
  const empty = iterRecords.length === 0;
  const join_status = empty ? 'empty_session' : 'n/a_opencode';

  // #002 Layer-A relabel (Option A, decision 2026-06-10): a mid-run llama-server
  // context overflow (the pinned `send_error … exceeds the available context
  // size` line inside this run's capture window) on a run that did NOT finish
  // clean is a serving artifact, not a model capability failure — re-type it
  // 'harness_error' so run_row/pickPassed emit passed=null and
  // paired_bootstrap.isEligible drops the row from pass denominators. A run
  // that overflowed but still exited 0 RECOVERED (client compaction/retry):
  // the overflow is recorded (context_overflow: true) but the run keeps its
  // honest 'done' label and the workspace oracle decides pass/fail.
  const rawTerminalStatus = timeout ? 'timeout' : (code === 0 ? 'done' : 'error');
  const overflowed = !!contextOverflow;
  const overflowRelabel = overflowed && rawTerminalStatus !== 'done';

  const timing_caveats = [
    // §4.2.1 — honest about the session log itself, regardless of the #022 gate.
    'server_prompt_decode_split_absent_from_session_log: server_prompt_eval_ms/' +
      'server_decode_ms/server_total_ms/server_queue_ms are null from the OpenCode ' +
      'DB alone (same as claw); recover via OPENCODE_SERVER_TIMINGS=1 → ' +
      'server.timings.jsonl (#022).',
    // §4.2.2 — no bridge to join.
    'no_litellm_bridge: bridge_request_seq / request-timing join fields are n/a ' +
      'for OpenCode (bypasses LiteLLM); per-iteration wallclock uses ' +
      'message.data.time.created/completed; join_status=n/a_opencode.',
  ];
  if (unmappedToolCallCount > 0) {
    timing_caveats.push(
      `unmapped_tools: ${unmappedToolCallCount} tool call(s) not in ` +
      'OPENCODE_WORKSPACE_CHANGED_BY_TOOL; workspace_changed=null, flagged via tool_unmapped.',
    );
  }
  if (timeout) {
    timing_caveats.push(
      'run_censored_timeout: the run was hard-killed; the session may be partial ' +
      '(a wedged/killed container leaves an incomplete DB, #020 §6) — counts ' +
      'reflect only what reached the DB before the kill.',
    );
  }
  if (truncatedToolCallCount > 0) {
    timing_caveats.push(
      `truncated_tool_calls: ${truncatedToolCallCount} tool part(s) still ` +
      'pending/running at hard-kill — classified truncated (#017): excluded ' +
      'from error_tool_call_count, workspace_changed=null (unknown).',
    );
  }
  if (empty) {
    timing_caveats.push('empty_session: no assistant messages in the DB.');
  }
  if (overflowRelabel) {
    timing_caveats.push(
      'context_overflow_relabel: llama-server rejected a request in this ' +
      "run's capture window (n_ctx exceeded) — terminal_status re-typed " +
      'harness_error / passed null per #002 Layer-A (excluded from pass ' +
      `denominators). Oracle line: ${contextOverflow.line ?? 'n/a'}`,
    );
  } else if (overflowed) {
    timing_caveats.push(
      'context_overflow_recovered: an n_ctx-exceeded rejection appeared in ' +
      "this run's capture window but the run finished clean (exit 0) — " +
      'recorded, NOT re-typed (#002); the workspace oracle decides pass/fail.',
    );
  }

  // Prefer the session row's own rollups (authoritative); fall back to the
  // per-iteration sums when a column is absent.
  const sTokIn = strictNumOrNull(session?.tokens_input);
  const sTokOut = strictNumOrNull(session?.tokens_output);
  const sTokReas = strictNumOrNull(session?.tokens_reasoning);
  const sCacheRead = strictNumOrNull(session?.tokens_cache_read);
  const sCacheWrite = strictNumOrNull(session?.tokens_cache_write);

  return {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    test_id: process.env.ITER_DIST_TEST_ID ?? null,
    sampler_id: process.env.ITER_DIST_SAMPLER_ID ?? null,
    git_sha: process.env.GIT_SHA ?? null,
    docker_image_digest: process.env.DOCKER_IMAGE_DIGEST ?? null,
    model_id: modelIdFromSession(session),
    model_digest: process.env.MODEL_DIGEST ?? null,
    llama_server_build: process.env.LLAMA_SERVER_BUILD ?? null,
    ctx: process.env.CTX ? parseInt(process.env.CTX, 10) : 65536,
    temperature: floatEnv('SAMPLER_TEMPERATURE'),
    top_p: floatEnv('SAMPLER_TOP_P'),
    top_k: intEnv('SAMPLER_TOP_K'),
    presence_penalty: floatEnv('SAMPLER_PRESENCE_PENALTY'),
    hardware_instance: process.env.HARDWARE_INSTANCE ?? 'M5',
    concurrency: 1,
    timeout_ms: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : null,
    max_iterations: process.env.OPENCODE_MAX_ITERATIONS
      ? parseInt(process.env.OPENCODE_MAX_ITERATIONS, 10) : null,
    run_started_ms: runStartedMs,
    run_finished_ms: runFinishedMs,
    run_elapsed_ms: runStartedMs != null && runFinishedMs != null
      ? runFinishedMs - runStartedMs : null,
    iter_count: iterRecords.length,
    total_input_tokens: sTokIn ?? totals.inputTokens,
    total_output_tokens: sTokOut ?? totals.outputTokens,
    total_cache_creation_input_tokens: sCacheWrite ?? totals.cacheCreate,
    total_cache_read_input_tokens: sCacheRead ?? totals.cacheRead,
    // Additive vs claw (§4.2.3).
    total_reasoning_tokens: sTokReas ?? totals.reasoningTokens,
    // No isolable pure-model time from the session log.
    total_model_elapsed_ms: null,
    // OpenCode HAS per-tool timestamps (§4.3) — claw outcome-only leaves this null.
    total_iter_tool_elapsed_ms: toolElapsedSeen ? totals.toolElapsedMs : null,
    total_non_model_gap_ms: totals.nonModelGapMs,
    non_model_gap_source: 'next_message_created_minus_current_message_completed',
    // The split lands in server.timings.jsonl (#022), not these totals.
    total_server_decode_ms: null,
    total_server_prompt_eval_ms: null,
    total_server_total_ms: null,
    max_input_tokens: maxInputTokens,
    tool_call_count: toolCallCountTotal,
    unique_tool_arg_hash_count: uniqueArgHashesCount,
    repeated_tool_call_count: repeatedToolCallCount,
    workspace_changed_count: workspaceChangedCount,
    result_changed_vs_prev_count: resultChangedCount,
    no_progress_repeat_count: noProgressRepeatCount,
    error_tool_call_count: errorToolCallCount,
    // Additive vs claw (#017): in-flight (pending/running) parts at hard-kill
    // on a censored run — truncation, not tool failure. 0 on non-censored runs.
    truncated_tool_call_count: truncatedToolCallCount,
    // Additive vs claw.
    unmapped_tool_call_count: unmappedToolCallCount,
    // #002: overflow re-types a non-clean run 'harness_error' (see relabel
    // block above); run_row.js's summary-precedence path carries it onto the
    // registry row, where pickPassed forces passed=null.
    terminal_status: overflowRelabel ? 'harness_error' : rawTerminalStatus,
    passed: null,
    timeout: !!timeout,
    // #002: true iff the pinned llama-server overflow line was scanned out of
    // this run's capture window (in-run detection; the driver's post-arm
    // host-slice patch sets the same fields for freeze-blinded runs).
    context_overflow: overflowed,
    ...(overflowRelabel ? { harness_error: 'context_overflow' } : {}),
    ...(overflowed ? {
      context_overflow_detected_via: 'in_run_capture',
      context_overflow_line: contextOverflow.line ?? null,
    } : {}),
    exit_code: code,
    join_status,
    censored: !!timeout,
    timing_caveats,
    session_id: session?.id ?? null,
    session_workspace_root: session?.directory ?? null,
    session_created_at_ms: strictNumOrNull(session?.time_created),
    // Marker that this sidecar carries normalized transcript telemetry (vs the
    // runner's outcome_only fallback).
    telemetry: 'transcript',
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — read + normalize + write the per-run sidecar files.
// ---------------------------------------------------------------------------

/**
 * Read a run's DB, normalize it, and write the sidecar files into runDir:
 *   - iterations.jsonl   (schema-v1 per-iteration records)
 *   - run_summary.json   (per-run rollup)
 *   - server.timings.jsonl  (only when server timings were captured + enabled)
 *
 * When OPENCODE_SERVER_TIMINGS captured timing records (passed in by the runner,
 * which owns the log-cursor bracketing), they are joined ordinally onto the
 * iteration records (#022) and the joined server_* fields are written inline AND
 * to the sidecar. Returns a meta object, or null when there is no usable DB
 * (caller falls back to its outcome-only sidecar).
 *
 * @param {Object} o
 * @param {string} o.dbPath
 * @param {string} o.runDir
 * @param {string} o.runId
 * @param {number} [o.runStartedMs]
 * @param {number} [o.runFinishedMs]
 * @param {number|null} [o.code]
 * @param {boolean} [o.timeout=false]
 * @param {number} [o.timeoutMs]
 * @param {object[]} [o.serverTimings=[]]   Normalized #022 timing records.
 * @param {boolean} [o.serverTimingsEnabled=false]
 * @returns {{ runDir: string, iterationsPath: string, runSummaryPath: string,
 *             serverTimingsPath: string|null, iterCount: number,
 *             joinStatus: string, serverTimingsJoinStatus: string|null } | null}
 */
export function buildOpenCodeArtifacts({
  dbPath, runDir, runId,
  runStartedMs = null, runFinishedMs = null,
  code = null, timeout = false, timeoutMs = null,
  serverTimings = [], serverTimingsEnabled = false,
  // Injectable for tests — defaults to the real SQLite reader / #022 join.
  readSession = readOpenCodeSession,
  joinTimings = joinServerTimings,
  writeTimingsSidecar = writeServerTimingsSidecar,
}) {
  const session = readSession(dbPath);
  if (!session) return null; // no DB / unreadable → caller degrades to outcome_only

  // #002: the runner's captureServerTimings rides the overflow signal back on
  // the serverTimings array as a marker record (the array is the only
  // runner→transcript channel). Detection is therefore coupled to
  // OPENCODE_SERVER_TIMINGS=1 by design (decision doc's soft dependency on
  // #007): flag off → no capture window → no in-run overflow typing.
  const contextOverflow = serverTimingsEnabled
    ? findContextOverflowMarker(serverTimings)
    : null;

  const { iterRecords: baseRecords, runSummary } = normalizeOpenCodeSession({
    session: session.session,
    messages: session.messages,
    parts: session.parts,
    runId, runStartedMs, runFinishedMs, code, timeout, timeoutMs,
    contextOverflow,
  });

  // #022 ordinal join (k-th server timing → k-th iteration). Lazily imported so
  // the transcript module has no hard dependency on the timings module for the
  // disabled path. Server fields are written inline AND into the sidecar.
  let iterRecords = baseRecords;
  let serverTimingsPath = null;
  let serverTimingsJoinStatus = null;
  if (serverTimingsEnabled) {
    const join = joinTimings(baseRecords, serverTimings, { enabled: true });
    iterRecords = join.iterations;
    serverTimingsJoinStatus = join.join_status;
    serverTimingsPath = writeTimingsSidecar(runDir, runId, join);
    runSummary.server_timings_join_status = join.join_status;
    runSummary.timing_caveats.push(
      `server_timings_join_${join.join_status}: #022 log-cursor split ` +
      `(${join.n_timings} timing record(s) over ${join.n_iterations} iteration(s)).`,
    );
  }

  fs.mkdirSync(runDir, { recursive: true });
  const iterationsPath = path.join(runDir, 'iterations.jsonl');
  fs.writeFileSync(
    iterationsPath,
    iterRecords.map((r) => JSON.stringify(r)).join('\n') + (iterRecords.length ? '\n' : ''),
  );
  const runSummaryPath = path.join(runDir, 'run_summary.json');
  fs.writeFileSync(runSummaryPath, JSON.stringify(runSummary, null, 2) + '\n');

  return {
    runDir,
    iterationsPath,
    runSummaryPath,
    serverTimingsPath,
    iterCount: iterRecords.length,
    joinStatus: runSummary.join_status,
    serverTimingsJoinStatus,
  };
}

// ---------------------------------------------------------------------------
// Shared pure helpers (schema-v1 conventions).
// ---------------------------------------------------------------------------

export function computeWorkspaceChanged(toolName, isError) {
  if (isError) return false;            // a failed call did nothing observable
  if (toolName == null) return null;
  if (toolName in OPENCODE_WORKSPACE_CHANGED_BY_TOOL) {
    return OPENCODE_WORKSPACE_CHANGED_BY_TOOL[toolName];
  }
  return null;                          // unmapped → caller decides (and we flag it)
}

function modelIdFromSession(session) {
  if (!session || session.model == null) return null;
  let m = session.model;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return m || null; }
  }
  if (m && typeof m === 'object') {
    const provider = m.providerID ?? null;
    const id = m.id ?? null;
    if (provider && id) return `${provider}/${id}`;
    return id ?? provider ?? null;
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
  const s = typeof value === 'string' ? value : stringifySorted(value ?? null);
  return 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
}

function stringifySorted(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stringifySorted).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringifySorted(value[k])).join(',') + '}';
}

// STRICT numeric guard ('42' → null): DB-sourced token/timestamp fields are
// already typed numbers, and silently coercing a string here would mask a
// schema drift. Deliberately distinct from the ONE exported coercing
// `numOrNull` in opencode_server_timings.js ('42' → 42, needed for regex
// captures) — issue #017 killed the same-name duplication. Exported so tests
// pin both behaviors.
export function strictNumOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
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
