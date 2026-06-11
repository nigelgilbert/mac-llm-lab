// Issue #022 — unit tests for the Config-B server prompt/decode timings capture.
// Pins: the enable flag (opt-in), parsing real llama.cpp log blocks, byte-offset
// log-cursor slicing, the #007 per-tier log paths + OPENCODE_LLAMA_LOG override
// + fail-loud unreadable-log path, the #008 token-keyed join to iteration
// records (ws020 leading-title-block shape, missing-block no-shift, tolerance,
// ordinal fallback for token-less legacy records), the proxy-source normalizer,
// the sidecar writer (keyed compatibly), and the render-or-omit report contract.
//
// Pure parse/join/render — no llama-server, no docker. Runs under `node --test`
// in the node:22 unit-test container (and locally on Node 22/24).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  numOrNull,
  serverTimingsEnabled,
  TOKEN_MATCH_TOLERANCE,
  defaultServerLogPath,
  openServerLogCursor,
  closeServerLogCursor,
  readLogSlice,
  readEofSize,
  parseServerLogTimings,
  captureServerTimings,
  normalizeProxyRecords,
  joinServerTimings,
  writeServerTimingsSidecar,
  summarizeServerTimings,
  renderServerDecodeSplit,
} from '../../lib/opencode_server_timings.js';

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// Two real-shape llama.cpp request blocks copied from a live
// /tmp/opencode-llama-server.log, plus the surrounding slot/srv noise the parser
// must ignore. Block 1: task 113. Block 2: task 114 (cached prompt, tiny eval).
const LOG_TWO_REQUESTS = `srv  update_slots: all slots are idle
slot update_slots: id  0 | task 113 | prompt processing done, n_tokens = 7808, batch.n_tokens = 4
srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200
slot print_timing: id  0 | task 113 |
prompt eval time =     132.30 ms /    23 tokens (    5.75 ms per token,   173.85 tokens per second)
       eval time =     440.69 ms /    18 tokens (   24.48 ms per token,    40.84 tokens per second)
      total time =     572.99 ms /    41 tokens
slot      release: id  0 | task 113 | stop processing: n_tokens = 7825, truncated = 0
srv  update_slots: all slots are idle
slot print_timing: id  0 | task 114 |
prompt eval time =      58.41 ms /     4 tokens (   14.60 ms per token,    68.49 tokens per second)
       eval time =    1185.58 ms /    42 tokens (   28.23 ms per token,    35.43 tokens per second)
      total time =    1243.99 ms /    46 tokens
slot      release: id  0 | task 114 | stop processing: n_tokens = 70, truncated = 0
`;

// --- ws020-derived fixture (#008) --------------------------------------------
// Derived from the repo's own ws020 evidence capture (gitignored local
// artifact: client/opencode/.opencode-runtime/ws020-evidence/):
//   - messages.raw.jsonl — the 4 build assistant messages carry
//     tokens {input: 561/110/87/19, output: 28/62/46/25, reasoning: 0,
//     cache.read: 7226/7814/7920/8052} (total = input + output + cache.read,
//     i.e. `input` is the UNCACHED prompt count == the server's prompt-eval
//     token count).
//   - run-logs.txt:56 — OpenCode fires the session-title request
//     (`service=llm … small=true agent=title`) BEFORE the first build stream
//     (run-logs.txt:62) at the SAME llama-server, so the run's log slice
//     carries n_iterations+1 timing blocks with the TITLE block leading.
// Pre-#008 ordinal pairing therefore handed iteration k request k−1's split.
const WS020_ITERS = [
  { run_id: 'ws020', iter: 1, assistant_message_index: 0, input_tokens: 561, output_tokens: 28, reasoning_tokens: 0 },
  { run_id: 'ws020', iter: 2, assistant_message_index: 1, input_tokens: 110, output_tokens: 62, reasoning_tokens: 0 },
  { run_id: 'ws020', iter: 3, assistant_message_index: 2, input_tokens: 87, output_tokens: 46, reasoning_tokens: 0 },
  { run_id: 'ws020', iter: 4, assistant_message_index: 3, input_tokens: 19, output_tokens: 25, reasoning_tokens: 0 },
];

// 5 blocks for the 4 ws020 iterations: leading title block (task 0 — small
// prompt, tiny decode; token counts match NO iteration), then one block per
// build iteration whose prompt/decode token counts are exactly the ws020
// message token counts above. Real llama.cpp log line shape throughout.
const WS020_LOG_WITH_TITLE = `srv  update_slots: all slots are idle
slot launch_slot_: id  0 | task 0 | processing task
srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200
slot print_timing: id  0 | task 0 |
prompt eval time =     201.54 ms /   169 tokens (    1.19 ms per token,   838.54 tokens per second)
       eval time =     297.81 ms /    11 tokens (   27.07 ms per token,    36.94 tokens per second)
      total time =     499.35 ms /   180 tokens
slot      release: id  0 | task 0 | stop processing: n_tokens = 180, truncated = 0
slot print_timing: id  0 | task 1 |
prompt eval time =    1450.12 ms /   561 tokens (    2.58 ms per token,   386.86 tokens per second)
       eval time =     612.48 ms /    28 tokens (   21.87 ms per token,    45.72 tokens per second)
      total time =    2062.60 ms /   589 tokens
slot      release: id  0 | task 1 | stop processing: n_tokens = 7825, truncated = 0
slot print_timing: id  0 | task 2 |
prompt eval time =     198.34 ms /   110 tokens (    1.80 ms per token,   554.60 tokens per second)
       eval time =    1350.75 ms /    62 tokens (   21.79 ms per token,    45.90 tokens per second)
      total time =    1549.09 ms /   172 tokens
slot      release: id  0 | task 2 | stop processing: n_tokens = 7986, truncated = 0
slot print_timing: id  0 | task 3 |
prompt eval time =     161.02 ms /    87 tokens (    1.85 ms per token,   540.31 tokens per second)
       eval time =    1012.33 ms /    46 tokens (   22.01 ms per token,    45.44 tokens per second)
      total time =    1173.35 ms /   133 tokens
slot      release: id  0 | task 3 | stop processing: n_tokens = 8053, truncated = 0
slot print_timing: id  0 | task 4 |
prompt eval time =      41.88 ms /    19 tokens (    2.20 ms per token,   453.68 tokens per second)
       eval time =     545.91 ms /    25 tokens (   21.84 ms per token,    45.79 tokens per second)
      total time =     587.79 ms /    44 tokens
slot      release: id  0 | task 4 | stop processing: n_tokens = 8096, truncated = 0
`;

describe('numOrNull — the ONE exported coercing numeric guard (#017)', () => {
  it("coerces numeric strings (regex captures): '42' → 42", () => {
    assert.equal(numOrNull('42'), 42);
    assert.equal(numOrNull('132.30'), 132.3);
  });
  it("pins the Number() coercion edges: '' → 0, true → 1", () => {
    // Documented footgun, never reachable from the regex-capture call sites
    // ([\d.]+ never yields '' / true). The transcript's strictNumOrNull
    // returns null for all three — deliberately divergent (#017).
    assert.equal(numOrNull(''), 0);
    assert.equal(numOrNull(true), 1);
  });
  it('still nulls out null/undefined/non-numeric', () => {
    assert.equal(numOrNull(null), null);
    assert.equal(numOrNull(undefined), null);
    assert.equal(numOrNull('abc'), null);
    assert.equal(numOrNull(NaN), null);
  });
});

describe('serverTimingsEnabled — opt-in flag (issue #022)', () => {
  it('is disabled by default', () => {
    assert.equal(serverTimingsEnabled({}), false);
    assert.equal(serverTimingsEnabled({ OPENCODE_SERVER_TIMINGS: '0' }), false);
    assert.equal(serverTimingsEnabled({ OPENCODE_SERVER_TIMINGS: 'true' }), false);
  });
  it('is enabled only by exactly "1"', () => {
    assert.equal(serverTimingsEnabled({ OPENCODE_SERVER_TIMINGS: '1' }), true);
  });
});

describe('defaultServerLogPath — per-tier + OPENCODE_LLAMA_LOG override (#007)', () => {
  it('maps tier-64 and tier-16 to the conventional log paths', () => {
    assert.equal(defaultServerLogPath(64, {}), '/tmp/opencode-llama-server.log');
    assert.equal(defaultServerLogPath('64', {}), '/tmp/opencode-llama-server.log');
    assert.equal(defaultServerLogPath(16, {}), '/tmp/opencode-llama-server-16.log');
    assert.equal(defaultServerLogPath(undefined, {}), '/tmp/opencode-llama-server.log');
  });

  it("tier 32 resolves to the -32 log, NOT the resident tier-64 log (#007)", () => {
    // Pre-#007 bug: 32 fell through to /tmp/opencode-llama-server.log and a
    // TIER=32 run bracketed the resident tier-64 daemon's log.
    assert.equal(defaultServerLogPath(32, {}), '/tmp/opencode-llama-server-32.log');
    assert.equal(defaultServerLogPath('32', {}), '/tmp/opencode-llama-server-32.log');
  });

  it('OPENCODE_LLAMA_LOG is used VERBATIM when set, for every tier (#007)', () => {
    // The run-config-ab.sh contract: the driver bind-mounts the host per-tier
    // log read-only at /var/log/opencode-llama-server.log inside the
    // eval-runner and points OPENCODE_LLAMA_LOG at it.
    const env = { OPENCODE_LLAMA_LOG: '/var/log/opencode-llama-server.log' };
    assert.equal(defaultServerLogPath(64, env), '/var/log/opencode-llama-server.log');
    assert.equal(defaultServerLogPath('32', env), '/var/log/opencode-llama-server.log');
    assert.equal(defaultServerLogPath(16, env), '/var/log/opencode-llama-server.log');
    assert.equal(defaultServerLogPath(undefined, env), '/var/log/opencode-llama-server.log');
  });

  it('an empty OPENCODE_LLAMA_LOG is ignored (falls back to the tier path)', () => {
    assert.equal(
      defaultServerLogPath('32', { OPENCODE_LLAMA_LOG: '' }),
      '/tmp/opencode-llama-server-32.log',
    );
  });

  it('reads process.env by default (the runner passes no env argument)', () => {
    const prev = process.env.OPENCODE_LLAMA_LOG;
    process.env.OPENCODE_LLAMA_LOG = '/mnt/injected/llama.log';
    try {
      assert.equal(defaultServerLogPath('16'), '/mnt/injected/llama.log');
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_LLAMA_LOG;
      else process.env.OPENCODE_LLAMA_LOG = prev;
    }
  });
});

describe('parseServerLogTimings — llama.cpp human-readable blocks', () => {
  it('parses two requests with prompt/decode/total + task ids in order', () => {
    const recs = parseServerLogTimings(LOG_TWO_REQUESTS);
    assert.equal(recs.length, 2);

    assert.deepEqual(
      {
        seq: recs[0].seq,
        task_id: recs[0].task_id,
        slot_id: recs[0].slot_id,
        prompt: recs[0].server_prompt_eval_ms,
        decode: recs[0].server_decode_ms,
        total: recs[0].server_total_ms,
        tps: recs[0].server_tokens_per_second,
        ptok: recs[0].prompt_tokens,
        dtok: recs[0].decode_tokens,
        queue: recs[0].server_queue_ms,
        source: recs[0].source,
      },
      {
        seq: 0,
        task_id: 113,
        slot_id: 0,
        prompt: 132.3,
        decode: 440.69,
        total: 572.99,
        tps: 40.84,
        ptok: 23,
        dtok: 18,
        queue: null,
        source: 'llama_server_log',
      },
    );

    assert.equal(recs[1].seq, 1);
    assert.equal(recs[1].task_id, 114);
    assert.equal(recs[1].server_prompt_eval_ms, 58.41);
    assert.equal(recs[1].server_decode_ms, 1185.58);
    assert.equal(recs[1].server_total_ms, 1243.99);
  });

  it('does not mistake "prompt eval time" for the decode "eval time" line', () => {
    const recs = parseServerLogTimings(LOG_TWO_REQUESTS);
    // If the regex bled, decode would equal prompt. It must not.
    assert.notEqual(recs[0].server_prompt_eval_ms, recs[0].server_decode_ms);
  });

  it('returns [] for empty / non-timing text', () => {
    assert.deepEqual(parseServerLogTimings(''), []);
    assert.deepEqual(parseServerLogTimings('srv all slots idle\nslot release\n'), []);
    assert.deepEqual(parseServerLogTimings(null), []);
  });

  it('reconstructs total from prompt+decode when the total line is absent', () => {
    const txt = `slot print_timing: id  0 | task 5 |
prompt eval time =     100.00 ms /    10 tokens (   10.00 ms per token,   100.00 tokens per second)
       eval time =     200.00 ms /    20 tokens (   10.00 ms per token,   100.00 tokens per second)
slot      release: id  0 | task 5 | stop
`;
    const recs = parseServerLogTimings(txt);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].server_total_ms, 300);
  });

  it('tolerates a decode-only block (cached prompt, no prompt-eval line)', () => {
    const txt = `slot print_timing: id  0 | task 9 |
       eval time =     321.00 ms /    12 tokens (   26.75 ms per token,    37.38 tokens per second)
      total time =     321.00 ms /    12 tokens
`;
    const recs = parseServerLogTimings(txt);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].server_prompt_eval_ms, null);
    assert.equal(recs[0].server_decode_ms, 321);
    assert.equal(recs[0].task_id, 9);
  });

  it('flushes a prior block that never saw a total line before the next request', () => {
    const txt = `slot print_timing: id  0 | task 1 |
prompt eval time =      10.00 ms /     2 tokens (    5.00 ms per token,   200.00 tokens per second)
       eval time =      20.00 ms /     3 tokens (    6.67 ms per token,   150.00 tokens per second)
slot print_timing: id  0 | task 2 |
prompt eval time =      30.00 ms /     4 tokens (    7.50 ms per token,   133.00 tokens per second)
       eval time =      40.00 ms /     5 tokens (    8.00 ms per token,   125.00 tokens per second)
      total time =      70.00 ms /     9 tokens
`;
    const recs = parseServerLogTimings(txt);
    assert.equal(recs.length, 2);
    assert.equal(recs[0].task_id, 1);
    assert.equal(recs[0].server_total_ms, 30); // reconstructed 10 + 20
    assert.equal(recs[1].task_id, 2);
    assert.equal(recs[1].server_total_ms, 70);
  });
});

describe('log cursor — byte-offset run bracketing', () => {
  it('open/close capture file size before and after appended requests', () => {
    const dir = makeTmp('octimings-log-');
    const p = path.join(dir, 'server.log');
    fs.writeFileSync(p, 'pre-existing noise from an earlier run\n');

    const cur0 = openServerLogCursor(p);
    assert.equal(cur0.byteStart, fs.statSync(p).size);
    assert.equal(cur0.log_unreadable, undefined); // readable → no fail-loud marker

    fs.appendFileSync(p, LOG_TWO_REQUESTS);
    const cur1 = closeServerLogCursor(cur0);
    assert.ok(cur1.byteEnd > cur1.byteStart);

    // Only the run's slice is parsed — the pre-existing noise is excluded.
    const slice = readLogSlice(p, cur1.byteStart, cur1.byteEnd);
    assert.ok(!slice.includes('pre-existing noise'));
    const recs = captureServerTimings(cur1);
    assert.equal(recs.length, 2);
    assert.deepEqual(recs.map((r) => r.task_id), [113, 114]);
  });

  it('openServerLogCursor on a missing log FAILS LOUD: stderr + unreadable marker (#007)', () => {
    // Pre-#007 silent degrade: byteStart 0, capture [], join 'no_server_timings'
    // — indistinguishable from a quiet server. Now: explicit stderr line + a
    // log_unreadable cursor whose capture propagates a marker record.
    const dir = makeTmp('octimings-missing-');
    const bogus = path.join(dir, 'nope.log');
    const errLines = [];
    const realErr = console.error;
    console.error = (msg) => { errLines.push(String(msg)); };
    let cur;
    try {
      cur = openServerLogCursor(bogus);
    } finally {
      console.error = realErr;
    }
    assert.equal(cur.log_unreadable, true);
    assert.equal(cur.byteStart, 0);
    assert.match(cur.error, /unreadable at cursor-open/);
    assert.match(cur.error, /log_unreadable/);
    assert.equal(errLines.length, 1);
    assert.match(errLines[0], new RegExp(bogus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const captured = captureServerTimings(closeServerLogCursor(cur));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].join_error, 'log_unreadable');
    assert.equal(captured[0].log_path, bogus);
  });

  it('readLogSlice clamps a start past EOF to an empty slice (rotation safety)', () => {
    const dir = makeTmp('octimings-rot-');
    const p = path.join(dir, 's.log');
    fs.writeFileSync(p, 'short\n');
    assert.equal(readLogSlice(p, 9999, 99999), '');
  });
});

describe('joinServerTimings — token-keyed pairing to iteration records (#008)', () => {
  // Token-less legacy iteration records (pre-#008 fixtures, kept verbatim:
  // they must still join IDENTICALLY via the ordinal fallback).
  const mkIters = (n) =>
    Array.from({ length: n }, (_, i) => ({ run_id: 'r1', iter: i + 1, assistant_message_index: i }));
  // Token-carrying equivalents keyed to LOG_TWO_REQUESTS (23/18, 4/42).
  const mkTokenIters = () => [
    { run_id: 'r1', iter: 1, assistant_message_index: 0, input_tokens: 23, output_tokens: 18, reasoning_tokens: 0 },
    { run_id: 'r1', iter: 2, assistant_message_index: 1, input_tokens: 4, output_tokens: 42, reasoning_tokens: 0 },
  ];

  it('pins the #008 token-match tolerance at 2 tokens per field', () => {
    assert.equal(TOKEN_MATCH_TOLERANCE, 2);
  });

  it('disabled: adds no server fields, status disabled', () => {
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: false,
    });
    assert.equal(r.join_status, 'disabled');
    assert.equal(r.join_keying, null);
    assert.equal('server_decode_ms' in r.iterations[0], false);
  });

  it('ok: equal counts, token-keyed — each iteration gets its own block', () => {
    const r = joinServerTimings(mkTokenIters(), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.join_keying, 'token');
    assert.equal(r.n_matched, 2);
    assert.equal(r.iterations[0].server_decode_ms, 440.69);
    assert.equal(r.iterations[0].server_prompt_eval_ms, 132.3);
    assert.equal(r.iterations[0].server_timing_task_id, 113);
    assert.equal(r.iterations[1].server_decode_ms, 1185.58);
    assert.equal(r.iterations[0].server_timing_source, 'llama_server_log');
  });

  it('REGRESSION: pre-#008 token-less equal-count fixture joins identically (ordinal fallback)', () => {
    // Token keying is impossible on token-less legacy/injected records (e.g.
    // the buildOpenCodeArtifacts contract test injects timing records without
    // token counts); the join falls back to the pre-#008 ordinal pairing and
    // produces byte-identical attachments + status.
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS).map(
      ({ prompt_tokens, decode_tokens, ...rest }) => rest,
    ), { enabled: true });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.join_keying, 'ordinal_fallback');
    assert.equal(r.n_matched, 2);
    assert.equal(r.iterations[0].server_decode_ms, 440.69);
    assert.equal(r.iterations[0].server_timing_task_id, 113);
    assert.equal(r.iterations[1].server_decode_ms, 1185.58);
  });

  it('REGRESSION: token-less ITERATIONS against token-carrying blocks also fall back ordinally', () => {
    // The other half of "existing fixtures join identically": the original
    // mkIters(2) fixture (no token fields) against the real parsed blocks.
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.join_keying, 'ordinal_fallback');
    assert.equal(r.iterations[0].server_decode_ms, 440.69);
    assert.equal(r.iterations[1].server_decode_ms, 1185.58);
  });

  it('count_mismatch (more token-less iters than timings): pairs the prefix, rest null', () => {
    const r = joinServerTimings(mkIters(3), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'count_mismatch');
    assert.equal(r.join_keying, 'ordinal_fallback');
    assert.equal(r.n_matched, 2);
    assert.equal(r.iterations[2].server_decode_ms, null);
    assert.equal(r.iterations[2].server_timing_source, null);
  });

  it('count_mismatch (more timings than token-less iters): extra timings dropped', () => {
    const r = joinServerTimings(mkIters(1), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'count_mismatch');
    assert.equal(r.n_iterations, 1);
    assert.equal(r.n_timings, 2);
    assert.equal(r.n_matched, 1);
    assert.equal(r.n_unmatched_timings, 1);
  });

  it('no_server_timings: enabled but zero parsed records', () => {
    const r = joinServerTimings(mkIters(2), [], { enabled: true });
    assert.equal(r.join_status, 'no_server_timings');
    assert.equal(r.iterations[0].server_decode_ms, null);
  });

  it('defaults to enabled when opts omitted', () => {
    const r = joinServerTimings(mkTokenIters(), parseServerLogTimings(LOG_TWO_REQUESTS));
    assert.equal(r.join_status, 'ok');
  });
});

describe('joinServerTimings — ws020 leading-title-block shape (#008)', () => {
  it('n_iterations+1 blocks: every iteration joins its OWN request; title unattached; clean join', () => {
    const blocks = parseServerLogTimings(WS020_LOG_WITH_TITLE);
    assert.equal(blocks.length, WS020_ITERS.length + 1); // the ws020 shape: 5 blocks, 4 iters

    const r = joinServerTimings(WS020_ITERS, blocks, { enabled: true });
    assert.equal(r.join_status, 'ok'); // clean join — extra title traffic is NOT a mismatch
    assert.equal(r.join_keying, 'token');
    assert.equal(r.n_iterations, 4);
    assert.equal(r.n_timings, 5);
    assert.equal(r.n_matched, 4);
    assert.equal(r.n_unmatched_timings, 1); // exactly the title block

    // Each iteration carries ITS OWN request's split (tasks 1..4) — the title
    // block (task 0) is attached to nobody.
    assert.deepEqual(r.iterations.map((it) => it.server_timing_task_id), [1, 2, 3, 4]);
    assert.equal(r.iterations[0].server_prompt_eval_ms, 1450.12);
    assert.equal(r.iterations[0].server_decode_ms, 612.48);
    assert.equal(r.iterations[3].server_decode_ms, 545.91);
    assert.equal(r.iterations[3].server_total_ms, 587.79);
  });

  it('pre-#008 ordinal bug pinned: iteration 1 must NOT receive the title block’s split', () => {
    const r = joinServerTimings(WS020_ITERS, parseServerLogTimings(WS020_LOG_WITH_TITLE), {
      enabled: true,
    });
    // Ordinal pairing handed iteration k request k−1's timings: iter 1 got the
    // title request's 201.54/297.81 and every later iteration shifted by one.
    assert.notEqual(r.iterations[0].server_prompt_eval_ms, 201.54);
    assert.notEqual(r.iterations[0].server_timing_task_id, 0);
    assert.notEqual(r.iterations[3].server_prompt_eval_ms, 161.02); // iter4 ≠ iter3's block
  });

  it('genuinely missing block: nulls for THAT iteration only, neighbors NOT shifted', () => {
    // Drop iteration 3's block (task 3) from the ws020 log — e.g. a request
    // whose timing lines were lost — keeping title + blocks 1, 2, 4.
    const missingBlock = `slot print_timing: id  0 | task 3 |
prompt eval time =     161.02 ms /    87 tokens (    1.85 ms per token,   540.31 tokens per second)
       eval time =    1012.33 ms /    46 tokens (   22.01 ms per token,    45.44 tokens per second)
      total time =    1173.35 ms /   133 tokens
slot      release: id  0 | task 3 | stop processing: n_tokens = 8053, truncated = 0
`;
    const logMissing = WS020_LOG_WITH_TITLE.replace(missingBlock, '');
    const blocks = parseServerLogTimings(logMissing);
    assert.equal(blocks.length, 4); // title + 3 build blocks

    const r = joinServerTimings(WS020_ITERS, blocks, { enabled: true });
    assert.equal(r.join_status, 'count_mismatch'); // a genuinely unattributable gap
    assert.equal(r.join_keying, 'token');
    assert.equal(r.n_matched, 3);
    assert.equal(r.n_unmatched_timings, 1); // the title block
    // Iter 3 is null; its neighbors keep their OWN blocks (no ordinal shift).
    assert.deepEqual(r.iterations.map((it) => it.server_timing_task_id), [1, 2, null, 4]);
    assert.equal(r.iterations[2].server_decode_ms, null);
    assert.equal(r.iterations[2].server_prompt_eval_ms, null);
    assert.equal(r.iterations[1].server_decode_ms, 1350.75); // iter 2 unshifted
    assert.equal(r.iterations[3].server_decode_ms, 545.91);  // iter 4 unshifted
  });

  it('matches within ±TOKEN_MATCH_TOLERANCE tokens, rejects beyond it', () => {
    const mkBlock = (promptTok, decodeTok) => parseServerLogTimings(
      `slot print_timing: id  0 | task 7 |
prompt eval time =     100.00 ms /   ${promptTok} tokens (    1.00 ms per token,  1000.00 tokens per second)
       eval time =     200.00 ms /    ${decodeTok} tokens (   10.00 ms per token,   100.00 tokens per second)
      total time =     300.00 ms /   ${promptTok + decodeTok} tokens
`,
    );
    const iter = [{ run_id: 'r', iter: 1, input_tokens: 100, output_tokens: 50, reasoning_tokens: 0 }];

    // Off by exactly the tolerance (stop/BOS bookkeeping noise) → still matches.
    const near = joinServerTimings(iter, mkBlock(100, 50 + TOKEN_MATCH_TOLERANCE), { enabled: true });
    assert.equal(near.join_status, 'ok');
    assert.equal(near.iterations[0].server_decode_ms, 200);

    // One past the tolerance → a different request; do NOT attach.
    const far = joinServerTimings(iter, mkBlock(100, 50 + TOKEN_MATCH_TOLERANCE + 1), { enabled: true });
    assert.equal(far.join_status, 'count_mismatch');
    assert.equal(far.iterations[0].server_decode_ms, null);
  });

  it('decode key includes reasoning tokens (server decodes them like any others)', () => {
    const iter = [{ run_id: 'r', iter: 1, input_tokens: 100, output_tokens: 40, reasoning_tokens: 10 }];
    const blocks = parseServerLogTimings(
      `slot print_timing: id  0 | task 8 |
prompt eval time =     100.00 ms /   100 tokens (    1.00 ms per token,  1000.00 tokens per second)
       eval time =     500.00 ms /    50 tokens (   10.00 ms per token,   100.00 tokens per second)
      total time =     600.00 ms /   150 tokens
`,
    );
    const r = joinServerTimings(iter, blocks, { enabled: true });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.iterations[0].server_decode_ms, 500);
  });

  it('prefers an exact token match over an earlier within-tolerance one', () => {
    const iter = [{ run_id: 'r', iter: 1, input_tokens: 100, output_tokens: 50, reasoning_tokens: 0 }];
    const blocks = parseServerLogTimings(
      `slot print_timing: id  0 | task 1 |
prompt eval time =     111.00 ms /   100 tokens (    1.11 ms per token,   900.00 tokens per second)
       eval time =     222.00 ms /    51 tokens (    4.35 ms per token,   229.73 tokens per second)
      total time =     333.00 ms /   151 tokens
slot print_timing: id  0 | task 2 |
prompt eval time =     444.00 ms /   100 tokens (    4.44 ms per token,   225.23 tokens per second)
       eval time =     555.00 ms /    50 tokens (   11.10 ms per token,    90.09 tokens per second)
      total time =     999.00 ms /   150 tokens
`,
    );
    const r = joinServerTimings(iter, blocks, { enabled: true });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.iterations[0].server_timing_task_id, 2); // exact (50) beats loose (51)
    assert.equal(r.iterations[0].server_decode_ms, 555);
  });
});

describe('joinServerTimings — log_unreadable fail-loud path (#007)', () => {
  it('flag on + bogus log path → join_status log_unreadable, NOT no_server_timings', () => {
    const dir = makeTmp('octimings-unreadable-');
    const bogus = path.join(dir, 'does-not-exist.log');
    const realErr = console.error;
    console.error = () => {};
    let captured;
    try {
      captured = captureServerTimings(closeServerLogCursor(openServerLogCursor(bogus)));
    } finally {
      console.error = realErr;
    }
    const iters = [
      { run_id: 'r', iter: 1, input_tokens: 10, output_tokens: 5, reasoning_tokens: 0 },
      { run_id: 'r', iter: 2, input_tokens: 20, output_tokens: 6, reasoning_tokens: 0 },
    ];
    const r = joinServerTimings(iters, captured, { enabled: true });
    assert.equal(r.join_status, 'log_unreadable');
    assert.notEqual(r.join_status, 'no_server_timings');
    assert.match(r.join_error, /unreadable at cursor-open/);
    assert.equal(r.n_timings, 0); // the marker is NOT a timing record
    assert.equal(r.n_matched, 0);
    assert.equal(r.iterations[0].server_decode_ms, null);
    assert.equal(r.iterations[1].server_total_ms, null);
  });

  it('flag off short-circuits before the marker: status stays disabled', () => {
    const marker = [{ source: 'llama_server_log', join_error: 'log_unreadable', log_path: '/x', error: 'x' }];
    const r = joinServerTimings([{ iter: 1 }], marker, { enabled: false });
    assert.equal(r.join_status, 'disabled');
    assert.equal('server_decode_ms' in r.iterations[0], false);
  });
});

describe('normalizeProxyRecords — forward-compat proxy source', () => {
  it('maps llama.cpp timings JSON + sorts by request_started_ms', () => {
    const raw = [
      { request_started_ms: 200, timings: { prompt_ms: 50, predicted_ms: 500, predicted_per_second: 40 } },
      { request_started_ms: 100, timings: { prompt_ms: 30, predicted_ms: 300, predicted_per_second: 33 } },
    ];
    const recs = normalizeProxyRecords(raw);
    assert.equal(recs.length, 2);
    // Reordered by timestamp: the t=100 request comes first.
    assert.equal(recs[0].server_prompt_eval_ms, 30);
    assert.equal(recs[0].server_decode_ms, 300);
    assert.equal(recs[0].server_total_ms, 330);
    assert.equal(recs[0].seq, 0);
    assert.equal(recs[0].source, 'proxy');
    assert.equal(recs[1].server_decode_ms, 500);
  });

  it('joins proxy records to iterations identically to log records (token-keyed)', () => {
    // prompt_n/predicted_n are the proxy-source token counts: a leading
    // title-shaped record stays unattached exactly like a log title block.
    const raw = [
      { request_started_ms: 1, timings: { prompt_ms: 5, predicted_ms: 50, prompt_n: 169, predicted_n: 11 } },
      { request_started_ms: 2, timings: { prompt_ms: 10, predicted_ms: 100, prompt_n: 30, predicted_n: 7 } },
      { request_started_ms: 3, timings: { prompt_ms: 20, predicted_ms: 200, prompt_n: 60, predicted_n: 9 } },
    ];
    const iters = [
      { run_id: 'r', iter: 1, assistant_message_index: 0, input_tokens: 30, output_tokens: 7, reasoning_tokens: 0 },
      { run_id: 'r', iter: 2, assistant_message_index: 1, input_tokens: 60, output_tokens: 9, reasoning_tokens: 0 },
    ];
    const r = joinServerTimings(iters, normalizeProxyRecords(raw), { enabled: true });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.join_keying, 'token');
    assert.equal(r.n_unmatched_timings, 1); // the title-shaped record
    assert.equal(r.iterations[0].server_decode_ms, 100);
    assert.equal(r.iterations[1].server_decode_ms, 200);
    assert.equal(r.iterations[1].server_timing_source, 'proxy');
  });

  it('returns [] for non-array input', () => {
    assert.deepEqual(normalizeProxyRecords(null), []);
  });
});

describe('writeServerTimingsSidecar — keyed compatibly with iterations.jsonl', () => {
  it('writes one record per matched iteration, keyed by run_id + iter', () => {
    const dir = makeTmp('octimings-side-');
    const join = joinServerTimings(
      [
        { run_id: 'run-xyz', iter: 1, assistant_message_index: 0 },
        { run_id: 'run-xyz', iter: 2, assistant_message_index: 1 },
      ],
      parseServerLogTimings(LOG_TWO_REQUESTS),
      { enabled: true },
    );
    const p = writeServerTimingsSidecar(dir, 'run-xyz', join);
    assert.ok(p.endsWith('server.timings.jsonl'));
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(
      { run_id: lines[0].run_id, iter: lines[0].iter, decode: lines[0].server_decode_ms },
      { run_id: 'run-xyz', iter: 1, decode: 440.69 },
    );
    assert.equal(lines[1].iter, 2);
    assert.equal(lines[1].server_timing_task_id, 114);
  });

  it('returns null and writes nothing when disabled', () => {
    const dir = makeTmp('octimings-side-off-');
    const join = joinServerTimings([{ run_id: 'r', iter: 1 }], [], { enabled: false });
    assert.equal(writeServerTimingsSidecar(dir, 'r', join), null);
    assert.equal(fs.existsSync(path.join(dir, 'server.timings.jsonl')), false);
  });
});

describe('summarizeServerTimings — aggregate the split', () => {
  it('sums prompt/decode/total over iterations that have a split', () => {
    const join = joinServerTimings(
      [
        { iter: 1 },
        { iter: 2 },
      ],
      parseServerLogTimings(LOG_TWO_REQUESTS),
      { enabled: true },
    );
    const s = summarizeServerTimings(join.iterations);
    assert.equal(s.n_iterations_with_split, 2);
    assert.equal(Math.round(s.total_server_prompt_eval_ms), Math.round(132.3 + 58.41));
    assert.equal(Math.round(s.total_server_decode_ms), Math.round(440.69 + 1185.58));
  });

  it('returns null when no iteration carries a split', () => {
    assert.equal(summarizeServerTimings([{ iter: 1, server_decode_ms: null }]), null);
    assert.equal(summarizeServerTimings([]), null);
  });
});

describe('renderServerDecodeSplit — render-or-omit report contract', () => {
  const summary = { total_server_prompt_eval_ms: 190, total_server_decode_ms: 1626, total_server_total_ms: 1816, n_iterations_with_split: 2 };

  it('renders both configs when enabled and both have data', () => {
    const md = renderServerDecodeSplit(
      [
        { label: 'claw-rig', summary },
        { label: 'opencode-a', summary },
      ],
      { enabled: true },
    );
    assert.match(md, /Server prompt\/decode split/);
    assert.match(md, /claw-rig/);
    assert.match(md, /opencode-a/);
  });

  it('omits entirely (empty string) when disabled — no implied parity', () => {
    assert.equal(
      renderServerDecodeSplit([{ label: 'claw-rig', summary }], { enabled: false }),
      '',
    );
  });

  it('omits when no side has data (no implied parity)', () => {
    assert.equal(
      renderServerDecodeSplit(
        [
          { label: 'claw-rig', summary: null },
          { label: 'opencode-a', summary: null },
        ],
        { enabled: true },
      ),
      '',
    );
  });

  it('renders only the side(s) that actually have data', () => {
    const md = renderServerDecodeSplit(
      [
        { label: 'claw-rig', summary },
        { label: 'opencode-a', summary: null },
      ],
      { enabled: true },
    );
    assert.match(md, /claw-rig/);
    assert.doesNotMatch(md, /opencode-a/);
  });
});

// ---------------------------------------------------------------------------
// T2 boundary fix — read-based EOF (OrbStack virtiofs stale-stat hardening).
// Under sweep load, stat attrs of a host-appended bind-mounted file can freeze
// in-container while reads still return fresh bytes; byteEnd must come from
// read truth. (Live evidence: issues/WORKLOG.md, T2 boundary.)
// ---------------------------------------------------------------------------
describe('readEofSize / unclamped readLogSlice (virtiofs stale-stat hardening)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-timings-eof-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('readEofSize finds EOF by reading from an arbitrary offset', () => {
    const p = path.join(tmp, 'grow.log');
    fs.writeFileSync(p, 'a'.repeat(1000));
    assert.equal(readEofSize(p, 0), 1000);
    assert.equal(readEofSize(p, 400), 1000);
    fs.appendFileSync(p, 'b'.repeat(50));
    assert.equal(readEofSize(p, 400), 1050);
  });

  it('readEofSize past-EOF offset and missing file degrade to the offset', () => {
    const p = path.join(tmp, 'short.log');
    fs.writeFileSync(p, 'xyz');
    assert.equal(readEofSize(p, 9999), 9999);
    assert.equal(readEofSize(path.join(tmp, 'nope.log'), 123), 123);
  });

  it('readEofSize crosses chunk boundaries exactly', () => {
    const p = path.join(tmp, 'big.log');
    const size = 256 * 1024 + 7;
    fs.writeFileSync(p, Buffer.alloc(size, 0x61));
    assert.equal(readEofSize(p, 0), size);
  });

  it('closeServerLogCursor byteEnd >= read-EOF even if stat were stale', () => {
    const p = path.join(tmp, 'cursor.log');
    fs.writeFileSync(p, 'start');
    const cur = openServerLogCursor(p);
    fs.appendFileSync(p, '-appended-bytes');
    const closed = closeServerLogCursor(cur);
    assert.equal(closed.byteEnd, fs.statSync(p).size);
  });

  it('readLogSlice tolerates byteEnd beyond actual EOF (short read, no throw)', () => {
    const p = path.join(tmp, 'slice.log');
    fs.writeFileSync(p, 'hello world');
    assert.equal(readLogSlice(p, 6, 9999), 'world');
    assert.equal(readLogSlice(p, 0, 5), 'hello');
    assert.equal(readLogSlice(p, 50, 60), '');
  });
});

describe('captureServerTimings virtiofs-freeze relay fallback', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-timings-relay-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const BLOCK = [
    'slot print_timing: id  0 | task 42 |',
    'prompt eval time =     100.00 ms /    10 tokens ( 10.00 ms per token, 100.00 tokens per second)',
    '       eval time =     200.00 ms /    20 tokens (10.00 ms per token, 100.00 tokens per second)',
    '      total time =     300.00 ms /    30 tokens',
    '',
  ].join('\n');

  function frozenCursor() {
    // Simulates the freeze: cursor brackets zero growth, so the in-place
    // slice is empty even though the host log really grew.
    const p = path.join(tmp, 'frozen.log');
    fs.writeFileSync(p, 'preexisting');
    const size = fs.statSync(p).size;
    return { path: p, byteStart: size, byteEnd: size };
  }

  it('relays when the slice is empty and relay env + fn are provided', () => {
    const calls = [];
    const recs = captureServerTimings(frozenCursor(), {
      env: { OPENCODE_LLAMA_LOG_HOST: '/host/tmp/x.log', OPENCODE_TIMINGS_RELAY_IMAGE: 'img:local' },
      relayFn: (hostLog, byteStart, image) => { calls.push([hostLog, byteStart, image]); return BLOCK; },
    });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].task_id, 42);
    assert.equal(recs[0].server_decode_ms, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/host/tmp/x.log');
    assert.equal(calls[0][2], 'img:local');
  });

  it('does not relay without the env contract; empty stays empty', () => {
    let called = false;
    const recs = captureServerTimings(frozenCursor(), {
      env: {},
      relayFn: () => { called = true; return BLOCK; },
    });
    assert.deepEqual(recs, []);
    assert.equal(called, false);
  });

  it('a failed relay (null) degrades to no records, not a throw', () => {
    const recs = captureServerTimings(frozenCursor(), {
      env: { OPENCODE_LLAMA_LOG_HOST: '/h', OPENCODE_TIMINGS_RELAY_IMAGE: 'i' },
      relayFn: () => null,
    });
    assert.deepEqual(recs, []);
  });

  it('a non-empty in-place slice never triggers the relay', () => {
    const p = path.join(tmp, 'healthy.log');
    fs.writeFileSync(p, BLOCK);
    let called = false;
    const recs = captureServerTimings(
      { path: p, byteStart: 0, byteEnd: fs.statSync(p).size },
      { env: { OPENCODE_LLAMA_LOG_HOST: '/h', OPENCODE_TIMINGS_RELAY_IMAGE: 'i' },
        relayFn: () => { called = true; return ''; } },
    );
    assert.equal(recs.length, 1);
    assert.equal(called, false);
  });
});
