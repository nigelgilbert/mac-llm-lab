// Issue #022 — server prompt/decode `timings` capture for Config B (OpenCode).
//
// Config A (the retired claw stack) recovered the llama.cpp prompt/decode split
// via the LiteLLM `_bridge.jsonl` time-window join. Config B
// bypasses LiteLLM, so that path is gone — BUT it is the *same llama.cpp engine*
// and emits the same `timings.prompt_ms` / `timings.predicted_ms`. This module
// recovers them so the split renders on BOTH sides, into the SAME iteration-record
// field names (`server_prompt_eval_ms` / `server_decode_ms` / `server_total_ms`)
// so the report can JOIN them to the right iteration.
//
// CAPTURE MECHANISM (primary): the OpenCode-dedicated `llama-server` is launched
// with `--metrics` and writes a human-readable timing block to its own log
// (/tmp/opencode-llama-server.log, or ...-16.log for tier-16) per completed
// request:
//
//   slot print_timing: id  0 | task 113 |
//   prompt eval time =     132.30 ms /    23 tokens ( 5.75 ms per token, 173.85 tokens per second)
//          eval time =     440.69 ms /    18 tokens (24.48 ms per token,  40.84 tokens per second)
//         total time =     572.99 ms /    41 tokens
//
// These lines carry NO wall-clock timestamp, so a run cannot be sliced by a time
// window the way `_bridge.jsonl` is. Instead the runner brackets a run with a
// **log cursor**: the server log's byte length at run-start and run-finish. The
// slice between the two offsets is exactly the requests this run issued (the
// phase-swap topology means one server, one client — request order == iteration
// order), and pairing is ordinal: the k-th completed request → the k-th iteration.
//
// CAPTURE MECHANISM (alternative, forward-compat): a thin logging proxy on the
// OpenCode->server hop can record each request's response `timings` JSON with
// timestamps. `normalizeProxyRecords` converts that shape into the same normalized
// record, so `joinServerTimings` works unchanged if a proxy is ever built. We do
// NOT ship a live proxy: the log-cursor path needs no new runtime component and
// adds no hop to the measured wall-clock. See docs/OPENCODE-SERVER-TIMINGS.md.
//
// ENABLE FLAG: this is an OPTIONAL / post-v1 secondary metric. It is OPT-IN via
// `OPENCODE_SERVER_TIMINGS=1`. When disabled, nothing is captured and the report
// omits the split entirely (no implied parity, no v1 dependency).

import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Enable flag (opt-in).
// ---------------------------------------------------------------------------

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} true iff server-timings capture is enabled.
 */
export function serverTimingsEnabled(env = process.env) {
  return env.OPENCODE_SERVER_TIMINGS === '1';
}

// ---------------------------------------------------------------------------
// Log cursor — brackets a run by byte offset in the server's own log.
// ---------------------------------------------------------------------------

/**
 * Resolve the conventional log path for an OpenCode server tier.
 * @param {number|string} tier  64 (default) or 16.
 * @returns {string}
 */
export function defaultServerLogPath(tier) {
  const t = String(tier ?? 64);
  return t === '16'
    ? '/tmp/opencode-llama-server-16.log'
    : '/tmp/opencode-llama-server.log';
}

function fileSizeOrZero(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * Open a cursor at the current end of the server log. Call at run-start.
 * Safe if the log does not exist yet (byteStart = 0).
 * @param {string} logPath
 * @returns {{ path: string, byteStart: number }}
 */
export function openServerLogCursor(logPath) {
  return { path: logPath, byteStart: fileSizeOrZero(logPath) };
}

/**
 * Close a cursor at the current end of the server log. Call at run-finish.
 * @param {{ path: string, byteStart: number }} cursor
 * @returns {{ path: string, byteStart: number, byteEnd: number }}
 */
export function closeServerLogCursor(cursor) {
  return { ...cursor, byteEnd: fileSizeOrZero(cursor.path) };
}

/**
 * Read the [byteStart, byteEnd) slice of a file as UTF-8 text. Tolerates a log
 * that was rotated/truncated mid-run (start past current EOF -> empty slice).
 * @param {string} p
 * @param {number} byteStart
 * @param {number} [byteEnd]
 * @returns {string}
 */
export function readLogSlice(p, byteStart, byteEnd) {
  if (!fs.existsSync(p)) return '';
  const size = fileSizeOrZero(p);
  const start = Math.max(0, Math.min(byteStart ?? 0, size));
  const end = Math.max(start, Math.min(byteEnd ?? size, size));
  if (end <= start) return '';
  const fd = fs.openSync(p, 'r');
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Parse — llama.cpp human-readable timing blocks from the server log.
// ---------------------------------------------------------------------------

const RE_PRINT_TIMING = /slot print_timing:\s*id\s+(\d+)\s*\|\s*task\s+(-?\d+)/;
// Captures: ms, tokens, [tokens-per-second] (tps only on the per-token lines).
const RE_TIMING_LINE =
  /time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens(?:\s*\(\s*[\d.]+\s*ms per token,\s*([\d.]+)\s*tokens per second\))?/;

// The ONE exported coercing `numOrNull` shared across the OpenCode modules
// (issue #017): Number()-coercing because this log parser feeds regex string
// captures ('42' → 42). Number() edges are pinned by unit tests ('' → 0,
// true → 1). The transcript's strict variant is `strictNumOrNull` over in
// opencode_transcript.js ('42' → null) — deliberately distinct names so the
// divergent semantics can never be silently merged again.
export function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function finishBlock(block, seq) {
  // total time wins if present; else reconstruct from prompt + decode.
  let total = block.server_total_ms;
  if (total == null) {
    const p = block.server_prompt_eval_ms;
    const d = block.server_decode_ms;
    if (p != null || d != null) total = (p ?? 0) + (d ?? 0);
  }
  return {
    source: 'llama_server_log',
    seq,
    slot_id: block.slot_id,
    task_id: block.task_id,
    server_prompt_eval_ms: block.server_prompt_eval_ms,
    server_decode_ms: block.server_decode_ms,
    server_total_ms: total,
    server_queue_ms: null, // llama.cpp does not expose queue time.
    server_tokens_per_second: block.server_tokens_per_second,
    prompt_tokens: block.prompt_tokens,
    decode_tokens: block.decode_tokens,
  };
}

/**
 * Parse llama.cpp timing blocks out of server-log text, in order of appearance.
 * Non-timing lines are ignored; multiple slots/tasks are handled; a decode-only
 * block (cached prompt, no `prompt eval time` line) is tolerated.
 *
 * @param {string} text
 * @returns {Array<object>} normalized timing records (see finishBlock shape)
 */
export function parseServerLogTimings(text) {
  const out = [];
  if (!text) return out;
  const lines = text.split('\n');
  let meta = { slot_id: null, task_id: null };
  let pending = null;

  const flush = () => {
    if (
      pending &&
      (pending.server_prompt_eval_ms != null || pending.server_decode_ms != null)
    ) {
      out.push(finishBlock(pending, out.length));
    }
    pending = null;
  };

  for (const raw of lines) {
    const pt = raw.match(RE_PRINT_TIMING);
    if (pt) {
      meta = { slot_id: numOrNull(pt[1]), task_id: numOrNull(pt[2]) };
      continue;
    }
    const line = raw.trim();

    if (line.startsWith('prompt eval time')) {
      // A new block begins; flush any prior block that never saw `total time`.
      flush();
      const m = line.match(RE_TIMING_LINE);
      pending = {
        slot_id: meta.slot_id,
        task_id: meta.task_id,
        server_prompt_eval_ms: m ? numOrNull(m[1]) : null,
        prompt_tokens: m ? numOrNull(m[2]) : null,
        server_decode_ms: null,
        decode_tokens: null,
        server_total_ms: null,
        server_tokens_per_second: null,
      };
      continue;
    }

    if (line.startsWith('eval time')) {
      // Decode line. Start a block if this is a decode-only request.
      if (!pending) {
        pending = {
          slot_id: meta.slot_id,
          task_id: meta.task_id,
          server_prompt_eval_ms: null,
          prompt_tokens: null,
          server_decode_ms: null,
          decode_tokens: null,
          server_total_ms: null,
          server_tokens_per_second: null,
        };
      }
      const m = line.match(RE_TIMING_LINE);
      if (m) {
        pending.server_decode_ms = numOrNull(m[1]);
        pending.decode_tokens = numOrNull(m[2]);
        pending.server_tokens_per_second = numOrNull(m[3]);
      }
      continue;
    }

    if (line.startsWith('total time')) {
      if (!pending) continue;
      const m = line.match(RE_TIMING_LINE);
      if (m) pending.server_total_ms = numOrNull(m[1]);
      flush();
      continue;
    }
  }

  flush();
  return out;
}

/**
 * Convenience: read a run's log slice via its cursor and parse it.
 * @param {{ path: string, byteStart: number, byteEnd?: number }} cursor
 * @returns {Array<object>}
 */
export function captureServerTimings(cursor) {
  if (!cursor || !cursor.path) return [];
  const text = readLogSlice(cursor.path, cursor.byteStart, cursor.byteEnd);
  return parseServerLogTimings(text);
}

// ---------------------------------------------------------------------------
// Parse — proxy JSONL (forward-compat alternative source).
// ---------------------------------------------------------------------------

/**
 * Normalize logging-proxy records into the same shape as the log parser. Each
 * raw record is expected to carry the llama.cpp response `timings` object plus
 * (optionally) request timestamps and a sequence number. Sorted by timestamp,
 * falling back to an explicit `seq`, falling back to input order.
 *
 * @param {Array<object>} rawRecords
 * @returns {Array<object>}
 */
export function normalizeProxyRecords(rawRecords) {
  if (!Array.isArray(rawRecords)) return [];
  const mapped = rawRecords.map((r, i) => {
    const t = (r && (r.timings || r)) || {};
    const promptMs = numOrNull(t.prompt_ms ?? r.server_prompt_eval_ms);
    const decodeMs = numOrNull(t.predicted_ms ?? r.server_decode_ms);
    let totalMs = numOrNull(r.server_total_ms);
    if (totalMs == null && (promptMs != null || decodeMs != null)) {
      totalMs = (promptMs ?? 0) + (decodeMs ?? 0);
    }
    return {
      source: 'proxy',
      _inputOrder: i,
      seq: numOrNull(r.seq ?? r.bridge_request_seq),
      request_started_ms: numOrNull(r.request_started_ms),
      request_finished_ms: numOrNull(r.request_finished_ms),
      slot_id: numOrNull(r.slot_id),
      task_id: numOrNull(r.task_id),
      server_prompt_eval_ms: promptMs,
      server_decode_ms: decodeMs,
      server_total_ms: totalMs,
      server_queue_ms: null,
      server_tokens_per_second: numOrNull(t.predicted_per_second),
      prompt_tokens: numOrNull(t.prompt_n),
      decode_tokens: numOrNull(t.predicted_n),
    };
  });
  mapped.sort((a, b) => {
    const ta = a.request_started_ms;
    const tb = b.request_started_ms;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    const sa = a.seq;
    const sb = b.seq;
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    return a._inputOrder - b._inputOrder;
  });
  return mapped.map((r, i) => {
    const { _inputOrder, ...rest } = r;
    return { ...rest, seq: i };
  });
}

// ---------------------------------------------------------------------------
// Join — attach server timings to iteration records (ordinal pairing).
// ---------------------------------------------------------------------------

const SERVER_FIELDS = [
  'server_prompt_eval_ms',
  'server_decode_ms',
  'server_total_ms',
  'server_queue_ms',
  'server_tokens_per_second',
];

function blankServerFields() {
  return {
    server_prompt_eval_ms: null,
    server_decode_ms: null,
    server_total_ms: null,
    server_queue_ms: null,
    server_tokens_per_second: null,
    server_timing_source: null,
    server_timing_task_id: null,
  };
}

/**
 * Join normalized server-timing records onto iteration records by ordinal
 * position (k-th timing -> k-th iteration). The phase-swap topology guarantees
 * a single server + single client, so completion order == iteration order.
 *
 * Returns shallow-copied iterations with the server_* fields filled, plus a
 * `join_status` mirroring the claw vocabulary:
 *   - 'disabled'           capture flag off; no fields added
 *   - 'no_server_timings'  enabled but zero timing records parsed (fields null)
 *   - 'ok'                 counts equal
 *   - 'count_mismatch'     counts differ; min(len) paired, rest null
 *
 * @param {Array<object>} iterations
 * @param {Array<object>} timings
 * @param {{ enabled?: boolean }} [opts]
 * @returns {{ iterations: Array<object>, join_status: string,
 *             n_iterations: number, n_timings: number, n_matched: number }}
 */
export function joinServerTimings(iterations, timings, opts = {}) {
  const iters = Array.isArray(iterations) ? iterations : [];
  const enabled = opts.enabled !== false;

  if (!enabled) {
    return {
      iterations: iters.map((it) => ({ ...it })),
      join_status: 'disabled',
      n_iterations: iters.length,
      n_timings: 0,
      n_matched: 0,
    };
  }

  const tims = Array.isArray(timings) ? timings : [];
  const n = Math.min(iters.length, tims.length);

  const joined = iters.map((it, k) => {
    const base = { ...it, ...blankServerFields() };
    if (k < n) {
      const t = tims[k];
      for (const f of SERVER_FIELDS) base[f] = t[f] ?? null;
      base.server_timing_source = t.source ?? null;
      base.server_timing_task_id = t.task_id ?? null;
    }
    return base;
  });

  let status;
  if (tims.length === 0) status = 'no_server_timings';
  else if (iters.length === tims.length) status = 'ok';
  else status = 'count_mismatch';

  return {
    iterations: joined,
    join_status: status,
    n_iterations: iters.length,
    n_timings: tims.length,
    n_matched: n,
  };
}

// ---------------------------------------------------------------------------
// Sidecar — write the joined timings keyed compatibly with iterations.jsonl.
// ---------------------------------------------------------------------------

/**
 * Write `server.timings.jsonl` into a run's sidecar dir, one record per matched
 * iteration, keyed by run_id + iter so it joins to iterations.jsonl downstream.
 * Returns the path written, or null when disabled / nothing to write.
 *
 * @param {string} runDir
 * @param {string} runId
 * @param {{iterations: Array<object>, join_status: string}} joinResult
 * @returns {string|null}
 */
export function writeServerTimingsSidecar(runDir, runId, joinResult) {
  if (!joinResult || joinResult.join_status === 'disabled') return null;
  const records = (joinResult.iterations || [])
    .filter((it) => it.server_total_ms != null || it.server_decode_ms != null)
    .map((it) => ({
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      iter: it.iter ?? null,
      assistant_message_index: it.assistant_message_index ?? null,
      join_status: joinResult.join_status,
      server_prompt_eval_ms: it.server_prompt_eval_ms ?? null,
      server_decode_ms: it.server_decode_ms ?? null,
      server_total_ms: it.server_total_ms ?? null,
      server_queue_ms: it.server_queue_ms ?? null,
      server_tokens_per_second: it.server_tokens_per_second ?? null,
      server_timing_source: it.server_timing_source ?? null,
      server_timing_task_id: it.server_timing_task_id ?? null,
    }));
  const p = path.join(runDir, 'server.timings.jsonl');
  fs.writeFileSync(
    p,
    records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''),
  );
  return p;
}

// ---------------------------------------------------------------------------
// Summarize + render — the report-side contract (render-or-omit).
// ---------------------------------------------------------------------------

/**
 * Aggregate the prompt/decode split over a run's iterations.
 * @param {Array<object>} iterations
 * @returns {null | { total_server_prompt_eval_ms: number,
 *                    total_server_decode_ms: number,
 *                    total_server_total_ms: number,
 *                    n_iterations_with_split: number }}
 */
export function summarizeServerTimings(iterations) {
  const iters = Array.isArray(iterations) ? iterations : [];
  let prompt = 0;
  let decode = 0;
  let total = 0;
  let n = 0;
  for (const it of iters) {
    if (it.server_decode_ms == null && it.server_total_ms == null) continue;
    prompt += it.server_prompt_eval_ms ?? 0;
    decode += it.server_decode_ms ?? 0;
    total += it.server_total_ms ?? (it.server_prompt_eval_ms ?? 0) + (it.server_decode_ms ?? 0);
    n += 1;
  }
  if (n === 0) return null;
  return {
    total_server_prompt_eval_ms: prompt,
    total_server_decode_ms: decode,
    total_server_total_ms: total,
    n_iterations_with_split: n,
  };
}

function fmtMs(v) {
  return v == null ? '—' : `${Math.round(v)} ms`;
}

/**
 * Render the server prompt/decode split for the report. AC: rendered for BOTH
 * configs WHEN ENABLED; OMITTED (empty string, no implied parity) when disabled
 * or when no side has data.
 *
 * @param {Array<{ label: string, summary: object|null }>} sides
 * @param {{ enabled?: boolean }} [opts]
 * @returns {string} markdown section, or '' to omit.
 */
export function renderServerDecodeSplit(sides, opts = {}) {
  if (opts.enabled === false) return '';
  const present = (Array.isArray(sides) ? sides : []).filter((s) => s && s.summary);
  if (present.length === 0) return '';
  const rows = present.map((s) => {
    const m = s.summary;
    return `| ${s.label} | ${fmtMs(m.total_server_prompt_eval_ms)} | ${fmtMs(
      m.total_server_decode_ms,
    )} | ${fmtMs(m.total_server_total_ms)} | ${m.n_iterations_with_split} |`;
  });
  return [
    '#### Server prompt/decode split (llama.cpp `timings`)',
    '',
    '| Config | Prompt eval | Decode | Server total | Iters w/ split |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
