// Issue #022 — unit tests for the Config-B server prompt/decode timings capture.
// Pins: the enable flag (opt-in), parsing real llama.cpp log blocks, byte-offset
// log-cursor slicing, ordinal join to iteration records (incl. count mismatch),
// the proxy-source normalizer, the sidecar writer (keyed compatibly), and the
// render-or-omit report contract.
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
  defaultServerLogPath,
  openServerLogCursor,
  closeServerLogCursor,
  readLogSlice,
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

describe('defaultServerLogPath — per-tier (issue #022)', () => {
  it('maps tier-64 and tier-16 to the conventional log paths', () => {
    assert.equal(defaultServerLogPath(64), '/tmp/opencode-llama-server.log');
    assert.equal(defaultServerLogPath('64'), '/tmp/opencode-llama-server.log');
    assert.equal(defaultServerLogPath(16), '/tmp/opencode-llama-server-16.log');
    assert.equal(defaultServerLogPath(undefined), '/tmp/opencode-llama-server.log');
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

  it('openServerLogCursor on a missing log yields byteStart 0', () => {
    const dir = makeTmp('octimings-missing-');
    const cur = openServerLogCursor(path.join(dir, 'nope.log'));
    assert.equal(cur.byteStart, 0);
    assert.deepEqual(captureServerTimings(closeServerLogCursor(cur)), []);
  });

  it('readLogSlice clamps a start past EOF to an empty slice (rotation safety)', () => {
    const dir = makeTmp('octimings-rot-');
    const p = path.join(dir, 's.log');
    fs.writeFileSync(p, 'short\n');
    assert.equal(readLogSlice(p, 9999, 99999), '');
  });
});

describe('joinServerTimings — ordinal pairing to iteration records', () => {
  const mkIters = (n) =>
    Array.from({ length: n }, (_, i) => ({ run_id: 'r1', iter: i + 1, assistant_message_index: i }));

  it('disabled: adds no server fields, status disabled', () => {
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: false,
    });
    assert.equal(r.join_status, 'disabled');
    assert.equal('server_decode_ms' in r.iterations[0], false);
  });

  it('ok: equal counts pair k-th timing to k-th iteration', () => {
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'ok');
    assert.equal(r.n_matched, 2);
    assert.equal(r.iterations[0].server_decode_ms, 440.69);
    assert.equal(r.iterations[0].server_prompt_eval_ms, 132.3);
    assert.equal(r.iterations[0].server_timing_task_id, 113);
    assert.equal(r.iterations[1].server_decode_ms, 1185.58);
    assert.equal(r.iterations[0].server_timing_source, 'llama_server_log');
  });

  it('count_mismatch (more iters than timings): pairs the prefix, rest null', () => {
    const r = joinServerTimings(mkIters(3), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'count_mismatch');
    assert.equal(r.n_matched, 2);
    assert.equal(r.iterations[2].server_decode_ms, null);
    assert.equal(r.iterations[2].server_timing_source, null);
  });

  it('count_mismatch (more timings than iters): extra timings dropped', () => {
    const r = joinServerTimings(mkIters(1), parseServerLogTimings(LOG_TWO_REQUESTS), {
      enabled: true,
    });
    assert.equal(r.join_status, 'count_mismatch');
    assert.equal(r.n_iterations, 1);
    assert.equal(r.n_timings, 2);
    assert.equal(r.n_matched, 1);
  });

  it('no_server_timings: enabled but zero parsed records', () => {
    const r = joinServerTimings(mkIters(2), [], { enabled: true });
    assert.equal(r.join_status, 'no_server_timings');
    assert.equal(r.iterations[0].server_decode_ms, null);
  });

  it('defaults to enabled when opts omitted', () => {
    const r = joinServerTimings(mkIters(2), parseServerLogTimings(LOG_TWO_REQUESTS));
    assert.equal(r.join_status, 'ok');
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

  it('joins proxy records to iterations identically to log records', () => {
    const raw = [
      { request_started_ms: 1, timings: { prompt_ms: 10, predicted_ms: 100 } },
      { request_started_ms: 2, timings: { prompt_ms: 20, predicted_ms: 200 } },
    ];
    const iters = [
      { run_id: 'r', iter: 1, assistant_message_index: 0 },
      { run_id: 'r', iter: 2, assistant_message_index: 1 },
    ];
    const r = joinServerTimings(iters, normalizeProxyRecords(raw), { enabled: true });
    assert.equal(r.join_status, 'ok');
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
