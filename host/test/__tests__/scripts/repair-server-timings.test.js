// Unit tests for scripts/repair-server-timings.mjs (#007 final AC — host-slice
// repair of the virtiofs-freeze 'no_server_timings' signature).
//
// Part 1 — the index→window mapping (mapIndexToWindow / parseIndexText): the
// driver's host ticker writes "<epoch_ms> <host_log_size>" lines every ~3s;
// the mapping floors to the tick at-or-before run_started_ms then pads ONE
// tick earlier (the session-title request fires ~at run start), ceils to the
// tick at-or-after run_finished_ms then pads ONE tick later, and falls back
// to byte 0 / the caller-supplied host EOF when the pads run off the index.
// Failure mode if it goes wrong: a too-narrow window silently drops timing
// blocks → the repair re-lands 'no_server_timings'/'count_mismatch' even
// though the host log has the data.
//
// Part 2 — the repair transform (repairRunDir): given a runDir with
// iterations.jsonl + run_summary.json + server-log.slice, re-run the SAME
// parse (parseServerLogTimings) + join (joinServerTimings) the original
// writer used, REWRITE server.timings.jsonl, and patch run_summary.json
// exactly as buildOpenCodeArtifacts shapes it (field + mechanical caveat),
// plus explicit repair provenance (server_timings_repaired_via: 'host_slice').
// Idempotent; never touches iterations.jsonl / assertion_result.json.
//
// Part 3 — the CLI argv contract run-config-ab.sh uses (spawnSync of the real
// script): `window --run-dir --index --eof` prints "<byteStart> <byteEnd>";
// `repair --run-dir` prints a one-line JSON summary.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseIndexText,
  mapIndexToWindow,
  repairRunDir,
  SLICE_BASENAME,
} from '../../scripts/repair-server-timings.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/repair-server-timings.mjs',
);

const tmpdirs = [];
function mkTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-timings-'));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// Ticker index: ticks every ~3s around a run window of [100_000, 130_000].
const INDEX_TEXT = [
  '95000 1000',
  '98000 1200',
  '101000 1500',
  '115000 2000',
  '128000 2600',
  '131000 3000',
  '134000 3400',
].join('\n') + '\n';

// llama.cpp timing blocks in the EXACT log shape parseServerLogTimings pins:
// a leading title-request block (26/9 tokens — matches NO iteration) followed
// by the two build-iteration blocks (561/28 and 110/62 tokens — ws020-style
// token counts that match the fixture iterations exactly).
const SLICE_TEXT = `srv  log_server_r: request: POST /v1/chat/completions
slot print_timing: id  0 | task 0 |
prompt eval time =     201.54 ms /    26 tokens ( 7.75 ms per token, 129.01 tokens per second)
       eval time =     220.45 ms /     9 tokens (24.49 ms per token,  40.83 tokens per second)
      total time =     421.99 ms /    35 tokens
slot print_timing: id  0 | task 7 |
prompt eval time =    1530.22 ms /   561 tokens ( 2.73 ms per token, 366.61 tokens per second)
       eval time =     685.71 ms /    28 tokens (24.49 ms per token,  40.83 tokens per second)
      total time =    2215.93 ms /   589 tokens
slot print_timing: id  0 | task 9 |
prompt eval time =     300.10 ms /   110 tokens ( 2.73 ms per token, 366.61 tokens per second)
       eval time =    1518.04 ms /    62 tokens (24.49 ms per token,  40.83 tokens per second)
      total time =    1818.14 ms /   172 tokens
`;

function iterRecord(iter, inputTokens, outputTokens) {
  return {
    schema_version: 1,
    run_id: 'fixture-run-1',
    test_id: 'deep-equal',
    iter,
    assistant_message_index: iter - 1,
    join_status: 'n/a_opencode',
    server_prompt_eval_ms: null,
    server_decode_ms: null,
    server_total_ms: null,
    server_queue_ms: null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: 0,
    iteration_status: 'tool_call',
    run_status: 'done',
  };
}

// A freeze-signature runDir exactly as runOpenCode + buildOpenCodeArtifacts
// leave it on a frozen sweep: transcript telemetry present, empty
// server.timings.jsonl, join_status 'no_server_timings' + its caveat.
function writeFrozenRunDir() {
  const runDir = mkTmpDir();
  const iterations = [iterRecord(1, 561, 28), iterRecord(2, 110, 62)];
  fs.writeFileSync(
    path.join(runDir, 'iterations.jsonl'),
    iterations.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  const summary = {
    schema_version: 1,
    run_id: 'fixture-run-1',
    test_id: 'deep-equal',
    run_started_ms: 100000,
    run_finished_ms: 130000,
    iter_count: 2,
    join_status: 'n/a_opencode',
    timing_caveats: [
      'server_prompt_decode_split_absent_from_session_log: …same as claw…',
      'no_litellm_bridge: …join_status=n/a_opencode.',
      'server_timings_join_no_server_timings: #022 log-cursor split ' +
        '(0 timing record(s) over 2 iteration(s)).',
    ],
    server_timings_join_status: 'no_server_timings',
    telemetry: 'transcript',
  };
  fs.writeFileSync(
    path.join(runDir, 'run_summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(runDir, 'server.timings.jsonl'), '');
  fs.writeFileSync(
    path.join(runDir, 'assertion_result.json'),
    JSON.stringify({ passed: true }) + '\n',
  );
  fs.writeFileSync(path.join(runDir, SLICE_BASENAME), SLICE_TEXT);
  return runDir;
}

function readJsonl(p) {
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Part 1 — index parsing + window mapping
// ---------------------------------------------------------------------------

describe('parseIndexText', () => {
  it('parses "<epoch_ms> <size>" lines, skips junk, sorts by time', () => {
    const ticks = parseIndexText('98000 1200\nnot a tick\n95000 1000\n\n101000 1500\n');
    assert.deepEqual(ticks, [
      { t: 95000, size: 1000 },
      { t: 98000, size: 1200 },
      { t: 101000, size: 1500 },
    ]);
  });

  it('returns [] for empty/absent text', () => {
    assert.deepEqual(parseIndexText(''), []);
    assert.deepEqual(parseIndexText(null), []);
  });
});

describe('mapIndexToWindow', () => {
  const ticks = parseIndexText(INDEX_TEXT);

  it('floors start to the at-or-before tick and pads ONE tick earlier (title request lands)', () => {
    // start=100000: at-or-before tick is t=98000 (size 1200); pad → t=95000.
    const w = mapIndexToWindow(ticks, 100000, 130000, { eofSize: 9999 });
    assert.equal(w.byteStart, 1000);
  });

  it('ceils end to the at-or-after tick and pads ONE tick later', () => {
    // end=130000: at-or-after tick is t=131000 (size 3000); pad → t=134000.
    const w = mapIndexToWindow(ticks, 100000, 130000, { eofSize: 9999 });
    assert.equal(w.byteEnd, 3400);
  });

  it('start before every tick → byte 0 (over-inclusive is safe: token-keyed join)', () => {
    const w = mapIndexToWindow(ticks, 90000, 130000, { eofSize: 9999 });
    assert.equal(w.byteStart, 0);
  });

  it('start at the FIRST tick → no earlier tick to pad to, uses the first tick itself', () => {
    const w = mapIndexToWindow(ticks, 95000, 130000, { eofSize: 9999 });
    assert.equal(w.byteStart, 1000);
  });

  it('end after the LAST tick → falls back to the host EOF', () => {
    const w = mapIndexToWindow(ticks, 100000, 140000, { eofSize: 5555 });
    assert.equal(w.byteEnd, 5555);
  });

  it('end ceils to the LAST tick → the one-later pad runs off the index → host EOF', () => {
    // end=133000: first at-or-after tick is t=134000 (the last) → pad off-end.
    const w = mapIndexToWindow(ticks, 100000, 133000, { eofSize: 5555 });
    assert.equal(w.byteEnd, 5555);
  });

  it('empty index → [0, eofSize] (whole log; join keying filters foreign blocks)', () => {
    const w = mapIndexToWindow([], 100000, 130000, { eofSize: 4321 });
    assert.deepEqual(w, { byteStart: 0, byteEnd: 4321 });
  });

  it('never returns byteEnd < byteStart', () => {
    // Degenerate: eof smaller than the floored start (rotated log).
    const w = mapIndexToWindow(ticks, 100000, 140000, { eofSize: 500 });
    assert.ok(w.byteEnd >= w.byteStart);
  });

  it('throws on non-numeric window / eof (misread run_summary must fail loud)', () => {
    assert.throws(() => mapIndexToWindow(ticks, NaN, 130000, { eofSize: 1 }));
    assert.throws(() => mapIndexToWindow(ticks, 100000, 130000, { eofSize: NaN }));
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the repair transform
// ---------------------------------------------------------------------------

describe('repairRunDir', () => {
  it('rebuilds server.timings.jsonl from the slice: join_status ok, non-null server_decode_ms, title block unattached', () => {
    const runDir = writeFrozenRunDir();
    const res = repairRunDir(runDir);

    assert.equal(res.run_id, 'fixture-run-1');
    assert.equal(res.join_status, 'ok');
    assert.equal(res.join_keying, 'token');
    assert.equal(res.n_timings, 3); // title + 2 iterations
    assert.equal(res.n_matched, 2);
    assert.equal(res.sidecar_rows, 2);

    const rows = readJsonl(path.join(runDir, 'server.timings.jsonl'));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.iter), [1, 2]);
    assert.deepEqual(rows.map((r) => r.join_status), ['ok', 'ok']);
    // Each iteration got its OWN request's split — not the title's 220.45 ms.
    assert.deepEqual(rows.map((r) => r.server_decode_ms), [685.71, 1518.04]);
    assert.deepEqual(rows.map((r) => r.server_prompt_eval_ms), [1530.22, 300.10]);
    for (const r of rows) {
      assert.equal(r.run_id, 'fixture-run-1');
      assert.notEqual(r.server_decode_ms, null);
    }
  });

  it('patches run_summary exactly as buildOpenCodeArtifacts shapes it, with explicit repair provenance', () => {
    const runDir = writeFrozenRunDir();
    repairRunDir(runDir);

    const s = JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));
    assert.equal(s.server_timings_join_status, 'ok');
    assert.equal(s.server_timings_repaired_via, 'host_slice');

    const joinCaveats = s.timing_caveats.filter((c) => c.startsWith('server_timings_join_'));
    assert.equal(joinCaveats.length, 1, 'stale no_server_timings caveat must be REPLACED, not stacked');
    assert.equal(
      joinCaveats[0],
      'server_timings_join_ok: #022 log-cursor split (3 timing record(s) over 2 iteration(s)).',
    );
    assert.ok(
      s.timing_caveats.some((c) => c.startsWith('server_timings_repaired_via_host_slice:')),
      'repair provenance caveat missing',
    );
    // The non-timings caveats survive untouched.
    assert.ok(s.timing_caveats.some((c) => c.startsWith('no_litellm_bridge:')));
  });

  it('is idempotent: a second run yields byte-identical artifacts', () => {
    const runDir = writeFrozenRunDir();
    repairRunDir(runDir);
    const sidecar1 = fs.readFileSync(path.join(runDir, 'server.timings.jsonl'), 'utf8');
    const summary1 = fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8');

    const res2 = repairRunDir(runDir);
    assert.equal(res2.join_status, 'ok');
    assert.equal(fs.readFileSync(path.join(runDir, 'server.timings.jsonl'), 'utf8'), sidecar1);
    assert.equal(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'), summary1);
  });

  it('never touches iterations.jsonl, assertion_result.json, or the slice', () => {
    const runDir = writeFrozenRunDir();
    const before = {
      iterations: fs.readFileSync(path.join(runDir, 'iterations.jsonl'), 'utf8'),
      assertion: fs.readFileSync(path.join(runDir, 'assertion_result.json'), 'utf8'),
      slice: fs.readFileSync(path.join(runDir, SLICE_BASENAME), 'utf8'),
    };
    repairRunDir(runDir);
    assert.equal(fs.readFileSync(path.join(runDir, 'iterations.jsonl'), 'utf8'), before.iterations);
    assert.equal(fs.readFileSync(path.join(runDir, 'assertion_result.json'), 'utf8'), before.assertion);
    assert.equal(fs.readFileSync(path.join(runDir, SLICE_BASENAME), 'utf8'), before.slice);
  });

  it('an empty slice re-lands the honest no_server_timings (no fabricated rows)', () => {
    const runDir = writeFrozenRunDir();
    fs.writeFileSync(path.join(runDir, SLICE_BASENAME), '');
    const res = repairRunDir(runDir);
    assert.equal(res.join_status, 'no_server_timings');
    assert.equal(res.sidecar_rows, 0);
    const s = JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));
    assert.equal(s.server_timings_join_status, 'no_server_timings');
  });

  it('refuses a runDir whose run_summary has no server_timings_join_status (outcome_only / flag-off)', () => {
    const runDir = mkTmpDir();
    fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
    fs.writeFileSync(
      path.join(runDir, 'run_summary.json'),
      JSON.stringify({ run_id: 'x', telemetry: 'outcome_only' }, null, 2) + '\n',
    );
    fs.writeFileSync(path.join(runDir, SLICE_BASENAME), SLICE_TEXT);
    assert.throws(() => repairRunDir(runDir), /not a timings-enabled transcript run/);
  });

  it('fails loud when the slice file is missing (the driver must extract it first)', () => {
    const runDir = writeFrozenRunDir();
    fs.rmSync(path.join(runDir, SLICE_BASENAME));
    assert.throws(() => repairRunDir(runDir), /no server log slice/);
  });
});

// ---------------------------------------------------------------------------
// Part 3 — the CLI argv contract run-config-ab.sh drives
// ---------------------------------------------------------------------------

describe('CLI (the run-config-ab.sh contract)', () => {
  it('window --run-dir --index --eof prints "<byteStart> <byteEnd>"', () => {
    const runDir = writeFrozenRunDir();
    const indexPath = path.join(mkTmpDir(), 'server-log-index.test.txt');
    fs.writeFileSync(indexPath, INDEX_TEXT);
    const r = spawnSync(
      process.execPath,
      [SCRIPT, 'window', '--run-dir', runDir, '--index', indexPath, '--eof', '9999'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '1000 3400');
  });

  it('repair --run-dir rewrites the artifacts and prints a JSON summary', () => {
    const runDir = writeFrozenRunDir();
    const r = spawnSync(
      process.execPath,
      [SCRIPT, 'repair', '--run-dir', runDir],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(r.stdout.trim());
    assert.equal(summary.join_status, 'ok');
    assert.equal(summary.sidecar_rows, 2);
    const rows = readJsonl(path.join(runDir, 'server.timings.jsonl'));
    assert.equal(rows.length, 2);
  });

  it('repair on a refused runDir exits nonzero with the reason on stderr', () => {
    const runDir = mkTmpDir();
    fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
    fs.writeFileSync(
      path.join(runDir, 'run_summary.json'),
      JSON.stringify({ run_id: 'x', telemetry: 'outcome_only' }, null, 2) + '\n',
    );
    const r = spawnSync(
      process.execPath,
      [SCRIPT, 'repair', '--run-dir', runDir],
      { encoding: 'utf8' },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not a timings-enabled transcript run/);
  });
});
