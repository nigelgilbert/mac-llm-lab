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
// (/tmp/opencode-llama-server.log, or ...-16.log / ...-32.log for tiers 16/32;
// OPENCODE_LLAMA_LOG overrides verbatim, #007) per completed request:
//
//   slot print_timing: id  0 | task 113 |
//   prompt eval time =     132.30 ms /    23 tokens ( 5.75 ms per token, 173.85 tokens per second)
//          eval time =     440.69 ms /    18 tokens (24.48 ms per token,  40.84 tokens per second)
//         total time =     572.99 ms /    41 tokens
//
// These lines carry NO wall-clock timestamp, so a run cannot be sliced by a time
// window the way `_bridge.jsonl` is. Instead the runner brackets a run with a
// **log cursor**: the server log's byte length at run-start and run-finish. The
// slice between the two offsets is exactly the requests this run issued — but
// NOT only the build iterations: OpenCode also fires a session-title request
// (`agent=title`, `small=true`) at the same server before the first build
// iteration (ws020 evidence), so pairing is keyed on token counts (#008):
// block `prompt_tokens`/`decode_tokens` ↔ iteration `input_tokens`/
// `output_tokens`(+`reasoning_tokens`), order-preserving, exact-first then
// ±TOKEN_MATCH_TOLERANCE. Title/summarize blocks stay unattached. The log path
// honors OPENCODE_LLAMA_LOG verbatim (#007, shared with the bash launcher and
// the run-config-ab.sh bind mount) and a missing/unreadable log at cursor-open
// fails loud (stderr + join_status 'log_unreadable'), never a silent degrade.
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
import { execFileSync } from 'node:child_process';

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
 * Resolve the log path for an OpenCode server tier.
 *
 * `OPENCODE_LLAMA_LOG` (the same variable the bash launcher honors, see
 * llama-server/scripts/opencode-server) wins when set and non-empty and is used
 * VERBATIM — this is the #007 contract with run-config-ab.sh, which bind-mounts
 * the host per-tier log read-only into the eval-runner (at
 * /var/log/opencode-llama-server.log) and points OPENCODE_LLAMA_LOG at it.
 * Otherwise the conventional per-tier host path: tier 16 → `-16.log`,
 * tier 32 → `-32.log`, tier 64 (default) → the unsuffixed resident log.
 *
 * @param {number|string} tier  64 (default), 32 or 16.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultServerLogPath(tier, env = process.env) {
  const override = env ? env.OPENCODE_LLAMA_LOG : null;
  if (typeof override === 'string' && override.length > 0) return override;
  const t = String(tier ?? 64);
  if (t === '16') return '/tmp/opencode-llama-server-16.log';
  if (t === '32') return '/tmp/opencode-llama-server-32.log';
  return '/tmp/opencode-llama-server.log';
}

function fileSizeOrZero(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * Find EOF by READING from `fromOffset`, not by stat. Under sweep load,
 * OrbStack's virtiofs serves stale stat attributes for a bind-mounted file a
 * host process is appending to — the in-container size can freeze at its
 * container-start value for minutes — while reads past the cached EOF still
 * return the fresh bytes (verified live at the T2 boundary, issues/WORKLOG.md).
 * Cursor close therefore derives byteEnd from read truth.
 * @param {string} p
 * @param {number} fromOffset
 * @returns {number} fromOffset + readable bytes past it (>= fromOffset)
 */
export function readEofSize(p, fromOffset) {
  const CHUNK = 256 * 1024;
  let fd;
  try {
    fd = fs.openSync(p, 'r');
  } catch {
    return fromOffset ?? 0;
  }
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = Math.max(0, fromOffset ?? 0);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      pos += n;
      if (n < CHUNK) return pos;
    }
  } catch {
    return fromOffset ?? 0;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Open a cursor at the current end of the server log. Call at run-start.
 *
 * #007 fail-loud contract: the runner only opens a cursor when
 * OPENCODE_SERVER_TIMINGS=1, and at that point a missing/unreadable log is a
 * misconfiguration (wrong tier path, missing bind mount), NOT a quiet server.
 * Instead of silently degrading to `no_server_timings`, this logs an explicit
 * error to stderr and marks the cursor `log_unreadable: true`;
 * `captureServerTimings` then propagates a marker record that
 * `joinServerTimings` surfaces as `join_status: 'log_unreadable'`.
 *
 * @param {string} logPath
 * @returns {{ path: string, byteStart: number, log_unreadable?: boolean, error?: string }}
 */
export function openServerLogCursor(logPath) {
  try {
    fs.accessSync(logPath, fs.constants.R_OK);
    return { path: logPath, byteStart: fs.statSync(logPath).size };
  } catch (e) {
    const error =
      `[opencode_server_timings] server log unreadable at cursor-open: ${logPath} ` +
      `(${e?.code ?? e?.message ?? e}). OPENCODE_SERVER_TIMINGS=1 requires a readable ` +
      `server log (check the per-tier log path / the OPENCODE_LLAMA_LOG bind mount); ` +
      `this run's server-timings join_status will be 'log_unreadable'.`;
    console.error(error);
    return { path: logPath, byteStart: 0, log_unreadable: true, error };
  }
}

/**
 * Close a cursor at the current end of the server log. Call at run-finish.
 * @param {{ path: string, byteStart: number }} cursor
 * @returns {{ path: string, byteStart: number, byteEnd: number }}
 */
export function closeServerLogCursor(cursor) {
  // max(stat, read-EOF): stat alone can be frozen-stale under virtiofs (see
  // readEofSize), while read-EOF is authoritative for appended bytes; max()
  // keeps the cheap stat meaningful on platforms where reads short-read.
  return {
    ...cursor,
    byteEnd: Math.max(
      fileSizeOrZero(cursor.path),
      readEofSize(cursor.path, cursor.byteStart),
    ),
  };
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
  // Do NOT clamp `end` to the stat size: under virtiofs the stat can be
  // frozen-stale while the bytes are readable (see readEofSize). readSync
  // short-reads at true EOF, which bounds the slice naturally; rotation/
  // truncation mid-run still yields an empty/short slice, never a throw.
  const start = Math.max(0, byteStart ?? 0);
  const end = byteEnd ?? readEofSize(p, start);
  if (end <= start) return '';
  const fd = fs.openSync(p, 'r');
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.subarray(0, n).toString('utf8');
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
 *
 * A cursor flagged `log_unreadable` (the #007 fail-loud path in
 * `openServerLogCursor`) yields a single marker record — `serverTimings` is the
 * only channel from the runner's cursor to the transcript-side join, so the
 * marker is how `joinServerTimings` learns to emit `'log_unreadable'` instead
 * of `'no_server_timings'`. Marker shape:
 * `{ source: 'llama_server_log', join_error: 'log_unreadable', log_path, error }`.
 *
 * @param {{ path: string, byteStart: number, byteEnd?: number,
 *           log_unreadable?: boolean, error?: string }} cursor
 * @returns {Array<object>}
 */
export function captureServerTimings(cursor, opts = {}) {
  if (!cursor || !cursor.path) return [];
  if (cursor.log_unreadable) {
    return [
      {
        source: 'llama_server_log',
        join_error: 'log_unreadable',
        log_path: cursor.path,
        error: cursor.error ?? `server log unreadable at cursor-open: ${cursor.path}`,
      },
    ];
  }
  let text = readLogSlice(cursor.path, cursor.byteStart, cursor.byteEnd);
  // Virtiofs freeze fallback (T2 boundary, issues/WORKLOG.md): under sweep
  // load, OrbStack can freeze a container's ENTIRE view of a host-appended
  // bind-mounted file — stat AND reads, file- and dir-mounts alike — at its
  // container-start state, recovering only at idle. A FRESH container always
  // reads truth at mount establishment, so when the in-place slice comes back
  // empty and a relay is configured (canonical sweep topology: the eval-runner
  // has /var/run/docker.sock + docker CLI baked), fetch the slice through a
  // throwaway container with a fresh mount of the HOST log path.
  if (!text) {
    const env = opts.env ?? process.env;
    const hostLog = env.OPENCODE_LLAMA_LOG_HOST;
    const image = env.OPENCODE_TIMINGS_RELAY_IMAGE;
    if (hostLog && image) {
      const relayFn = opts.relayFn ?? relayReadSliceViaDocker;
      const relayed = relayFn(hostLog, cursor.byteStart, image);
      if (relayed != null) {
        console.error(
          `[opencode_server_timings] in-place log slice empty at close ` +
          `(byteStart=${cursor.byteStart}, byteEnd=${cursor.byteEnd}) — virtiofs ` +
          `freeze suspected; relay read via fresh-mount container returned ` +
          `${relayed.length} bytes from ${hostLog}`,
        );
        text = relayed;
      }
    }
  }
  return parseServerLogTimings(text);
}

/**
 * Read everything past `byteStart` of a HOST file through a throwaway docker
 * container with a fresh bind mount (fresh mount session ⇒ fresh view even
 * mid-freeze; see captureServerTimings). Returns the slice text, '' when the
 * host file has nothing past `byteStart`, or null when the relay itself failed
 * (no docker, bad image, mount error) — callers treat null as "no better data".
 * @param {string} hostLogPath  host-side path (the driver's $HOST_LLAMA_LOG)
 * @param {number} byteStart
 * @param {string} image        a locally-present image with `tail` (the driver
 *                              passes the eval-runner image it just ran)
 * @returns {string|null}
 */
export function relayReadSliceViaDocker(hostLogPath, byteStart, image) {
  try {
    const out = execFileSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${hostLogPath}:/oc-relay-log:ro`,
        '--entrypoint', 'tail',
        image,
        '-c', `+${(byteStart ?? 0) + 1}`,
        '/oc-relay-log',
      ],
      { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );
    return out.toString('utf8');
  } catch (e) {
    console.error(
      `[opencode_server_timings] relay read failed for ${hostLogPath} ` +
      `(image ${image}): ${e?.message ?? e}`,
    );
    return null;
  }
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
// Join — attach server timings to iteration records (token-keyed, #008).
// ---------------------------------------------------------------------------

const SERVER_FIELDS = [
  'server_prompt_eval_ms',
  'server_decode_ms',
  'server_total_ms',
  'server_queue_ms',
  'server_tokens_per_second',
];

// #008 token-match tolerance (per field, in tokens). Client- and server-side
// token accounting can each disagree by a BOS/EOS/stop token (off-by-one on
// either side), while DISTINCT requests in the same session differ by whole
// messages (tens-to-hundreds of prompt tokens). 2 absorbs the bookkeeping
// noise without ever bridging the gap between two different requests.
export const TOKEN_MATCH_TOLERANCE = 2;

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

function isLogUnreadableMarker(rec) {
  return !!rec && rec.join_error === 'log_unreadable';
}

// Token key of a parsed timing block: prompt-eval'd (uncached) tokens + decoded
// tokens, straight off the log lines / proxy `timings` JSON.
function blockTokenKey(t) {
  return {
    prompt: numOrNull(t?.prompt_tokens),
    decode: numOrNull(t?.decode_tokens),
  };
}

// Token key of a schema-v1 iteration record. `input_tokens` is the UNCACHED
// input count (ws020 evidence: total = input + output + cache.read), so it
// lines up with the block's prompt-eval token count. The server decodes
// reasoning tokens like any others, so the decode key is output + reasoning.
function iterTokenKey(it) {
  const prompt = numOrNull(it?.input_tokens);
  const output = numOrNull(it?.output_tokens);
  const reasoning = numOrNull(it?.reasoning_tokens) ?? 0;
  return { prompt, decode: output == null ? null : output + reasoning };
}

// A block matches an iteration when at least one token field is comparable
// (non-null on BOTH sides) and EVERY comparable field agrees within `tol`.
function tokenKeyMatches(blockKey, iterKey, tol) {
  let comparable = 0;
  if (blockKey.prompt != null && iterKey.prompt != null) {
    comparable += 1;
    if (Math.abs(blockKey.prompt - iterKey.prompt) > tol) return false;
  }
  if (blockKey.decode != null && iterKey.decode != null) {
    comparable += 1;
    if (Math.abs(blockKey.decode - iterKey.decode) > tol) return false;
  }
  return comparable > 0;
}

/**
 * Join normalized server-timing records onto iteration records, keyed on the
 * token counts BOTH sides already carry (#008): blocks have
 * `prompt_tokens`/`decode_tokens`, iterations have `input_tokens`/
 * `output_tokens` (+`reasoning_tokens`). Pure ordinal pairing is systematically
 * wrong: OpenCode fires a session-title request (`agent=title`, `small=true`)
 * to the SAME server before the first build iteration (ws020 evidence), so a
 * run's log slice carries n_iterations+1 blocks and the k-th block belongs to
 * request k−1.
 *
 * Matching is order-preserving and greedy: for each iteration (in order), scan
 * forward from just past the previously matched block and attach the first
 * exact token match, falling back to the first match within
 * `opts.tokenTolerance` (default TOKEN_MATCH_TOLERANCE = 2) tokens per field.
 * Unmatched blocks (title/summarize traffic) stay unattached; an iteration
 * whose block is genuinely missing gets nulls WITHOUT shifting its neighbors.
 *
 * Legacy ordinal fallback: when token keying is IMPOSSIBLE — no block or no
 * iteration carries any token count (injected/legacy records) — the join falls
 * back to the pre-#008 ordinal pairing (k-th block → k-th iteration,
 * `join_keying: 'ordinal_fallback'`). Real log/proxy blocks always carry token
 * counts, so production runs always take the token-keyed path.
 *
 * `join_status` vocabulary (claw-derived; documented in
 * docs/OPENCODE-SERVER-TIMINGS.md — keep in sync):
 *   - 'disabled'           capture flag off; no server fields added
 *   - 'no_server_timings'  enabled, log readable, but zero timing records
 *                          parsed from the run's slice (fields null)
 *   - 'log_unreadable'     enabled but the log was missing/unreadable at
 *                          cursor-open (#007 fail-loud; fields null)
 *   - 'ok'                 every iteration matched its own request's block
 *                          (extra unattached title/summarize blocks allowed)
 *   - 'count_mismatch'     ≥1 iteration could not be attributed a block
 *                          (genuinely missing/unattributable; that iteration's
 *                          fields are null, neighbors unaffected)
 *
 * @param {Array<object>} iterations
 * @param {Array<object>} timings
 * @param {{ enabled?: boolean, tokenTolerance?: number }} [opts]
 * @returns {{ iterations: Array<object>, join_status: string,
 *             join_keying: 'token'|'ordinal_fallback'|null,
 *             join_error: string|null,
 *             n_iterations: number, n_timings: number, n_matched: number,
 *             n_unmatched_timings: number }}
 */
export function joinServerTimings(iterations, timings, opts = {}) {
  const iters = Array.isArray(iterations) ? iterations : [];
  const enabled = opts.enabled !== false;

  if (!enabled) {
    return {
      iterations: iters.map((it) => ({ ...it })),
      join_status: 'disabled',
      join_keying: null,
      join_error: null,
      n_iterations: iters.length,
      n_timings: 0,
      n_matched: 0,
      n_unmatched_timings: 0,
    };
  }

  const rawTims = Array.isArray(timings) ? timings : [];
  const markers = rawTims.filter(isLogUnreadableMarker);
  const tims = rawTims.filter((t) => !isLogUnreadableMarker(t));

  const blankAll = () => iters.map((it) => ({ ...it, ...blankServerFields() }));

  // #007 fail-loud: the cursor said the log was unreadable at open time — a
  // misconfiguration, NOT a quiet server. Distinct from 'no_server_timings'.
  if (markers.length > 0) {
    return {
      iterations: blankAll(),
      join_status: 'log_unreadable',
      join_keying: null,
      join_error: markers[0].error ?? 'server log unreadable at cursor-open',
      n_iterations: iters.length,
      n_timings: tims.length,
      n_matched: 0,
      n_unmatched_timings: tims.length,
    };
  }

  if (tims.length === 0) {
    return {
      iterations: blankAll(),
      join_status: 'no_server_timings',
      join_keying: null,
      join_error: null,
      n_iterations: iters.length,
      n_timings: 0,
      n_matched: 0,
      n_unmatched_timings: 0,
    };
  }

  const blockKeys = tims.map(blockTokenKey);
  const iterKeys = iters.map(iterTokenKey);
  const keyingPossible =
    blockKeys.some((k) => k.prompt != null || k.decode != null) &&
    iterKeys.some((k) => k.prompt != null || k.decode != null);

  const attach = (base, t) => {
    for (const f of SERVER_FIELDS) base[f] = t[f] ?? null;
    base.server_timing_source = t.source ?? null;
    base.server_timing_task_id = t.task_id ?? null;
  };

  if (!keyingPossible) {
    // Legacy ordinal pairing (pre-#008 semantics) — only reachable with
    // token-less injected/legacy records; real blocks always carry counts.
    const n = Math.min(iters.length, tims.length);
    const joined = iters.map((it, k) => {
      const base = { ...it, ...blankServerFields() };
      if (k < n) attach(base, tims[k]);
      return base;
    });
    return {
      iterations: joined,
      join_status: iters.length === tims.length ? 'ok' : 'count_mismatch',
      join_keying: 'ordinal_fallback',
      join_error: null,
      n_iterations: iters.length,
      n_timings: tims.length,
      n_matched: n,
      n_unmatched_timings: tims.length - n,
    };
  }

  // Token-keyed, order-preserving greedy match. `cursor` only advances past a
  // MATCHED block, so an iteration whose block is missing fails to match
  // without consuming the next iteration's block (no neighbor shift), and
  // leading/interleaved title blocks are simply skipped.
  const tol = numOrNull(opts.tokenTolerance) ?? TOKEN_MATCH_TOLERANCE;
  const matchedBlockFor = new Array(iters.length).fill(-1);
  let cursor = 0;
  for (let k = 0; k < iters.length; k += 1) {
    let exact = -1;
    let loose = -1;
    for (let j = cursor; j < tims.length && exact === -1; j += 1) {
      if (tokenKeyMatches(blockKeys[j], iterKeys[k], 0)) exact = j;
      else if (loose === -1 && tokenKeyMatches(blockKeys[j], iterKeys[k], tol)) loose = j;
    }
    const pick = exact !== -1 ? exact : loose;
    if (pick !== -1) {
      matchedBlockFor[k] = pick;
      cursor = pick + 1;
    }
  }

  const joined = iters.map((it, k) => {
    const base = { ...it, ...blankServerFields() };
    if (matchedBlockFor[k] !== -1) attach(base, tims[matchedBlockFor[k]]);
    return base;
  });
  const nMatched = matchedBlockFor.filter((j) => j !== -1).length;

  return {
    iterations: joined,
    join_status:
      iters.length > 0 && nMatched === iters.length ? 'ok' : 'count_mismatch',
    join_keying: 'token',
    join_error: null,
    n_iterations: iters.length,
    n_timings: tims.length,
    n_matched: nMatched,
    n_unmatched_timings: tims.length - nMatched,
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
