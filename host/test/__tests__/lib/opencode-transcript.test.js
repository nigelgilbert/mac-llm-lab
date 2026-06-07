// Issue #021 — unit tests for the OpenCode transcript adapter
// (lib/opencode_transcript.js). Two layers:
//
//   1. PURE normalizer tests over fixtures whose shapes mirror the real #020
//      evidence DB (client/opencode/docs/SESSION-LOG-FORMAT.md §2): one assistant
//      `message` → one iteration record; §4.1 direct maps; §4.2 gaps degraded;
//      §5 tool→workspace-mutation map. No SQLite engine needed — runs anywhere.
//
//   2. A reader+DB INTEGRATION test that reads the real evidence DB via
//      `node:sqlite` and asserts the known token bytes field-by-field. Gated on
//      the (gitignored) evidence DB being present, so it runs on the lab box and
//      skips cleanly in CI / the slim container.
//
// Run under `node --test` in the node:24 test image (node:sqlite is stable there).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPENCODE_WORKSPACE_CHANGED_BY_TOOL,
  computeWorkspaceChanged,
  normalizeOpenCodeSession,
  buildOpenCodeArtifacts,
  readOpenCodeSession,
} from '../../lib/opencode_transcript.js';

// --- fixtures: shapes copied from the real #020 evidence DB (trimmed) ---------

const SES = 'ses_161992655ffepXKDFnnDPREdNF';

const assistant = (id, created, completed, finish, tokens) => ({
  id, session_id: SES, time_created: created,
  data: {
    parentID: 'msg_user', role: 'assistant', mode: 'build', agent: 'build',
    path: { cwd: '/workspace', root: '/' }, cost: 0,
    tokens, modelID: 'opencode', providerID: 'llama-local',
    time: { created, completed }, finish,
  },
});

const toolPart = (msgId, created, tool, callID, state) => ({
  id: `prt_${callID}`, message_id: msgId, session_id: SES, time_created: created,
  data: { type: 'tool', tool, callID, state },
});
const stepStart = (msgId, created) => ({
  id: `prt_ss_${msgId}_${created}`, message_id: msgId, session_id: SES, time_created: created,
  data: { type: 'step-start' },
});
const stepFinish = (msgId, created, tokens) => ({
  id: `prt_sf_${msgId}_${created}`, message_id: msgId, session_id: SES, time_created: created,
  data: { type: 'step-finish', reason: 'tool-calls', tokens, cost: 0 },
});
const textPart = (msgId, created, text) => ({
  id: `prt_tx_${msgId}_${created}`, message_id: msgId, session_id: SES, time_created: created,
  data: { type: 'text', text },
});

// The canonical 4-iteration read→edit→bash→answer run from §2.1.
function happyRun() {
  const tk = (input, output, cacheRead) => ({
    total: input + output + cacheRead, input, output, reasoning: 0,
    cache: { write: 0, read: cacheRead },
  });
  const session = {
    id: SES, project_id: 'global', slug: 'fix-calc', directory: '/workspace',
    title: 'fix calc', version: '1.16.2',
    model: JSON.stringify({ id: 'opencode', providerID: 'llama-local', variant: '' }),
    cost: 0, tokens_input: 777, tokens_output: 161, tokens_reasoning: 0,
    tokens_cache_read: 31012, tokens_cache_write: 0,
    time_created: 1780774001091, time_updated: 1780774008000,
  };
  const messages = [
    { id: 'msg_user', session_id: SES, time_created: 1780774001091,
      data: { role: 'user', time: { created: 1780774001091 }, agent: 'build',
        model: { providerID: 'llama-local', modelID: 'opencode' }, summary: { diffs: [] } } },
    assistant('msg_a1', 1780774001235, 1780774003707, 'tool-calls', tk(561, 28, 7226)),
    assistant('msg_a2', 1780774003709, 1780774005656, 'tool-calls', tk(110, 62, 7814)),
    assistant('msg_a3', 1780774005658, 1780774007146, 'tool-calls', tk(87, 46, 7920)),
    assistant('msg_a4', 1780774007148, 1780774007999, 'stop', tk(19, 25, 8052)),
  ];
  const parts = [
    textPart('msg_user', 1780774001100, 'Read calc.py, fix add…'),
    stepStart('msg_a1', 1780774001300),
    toolPart('msg_a1', 1780774003670, 'read', 'g5oDGjz02UeyLZwSOUioRb1slGvcheOX', {
      status: 'completed', input: { filePath: '/workspace/calc.py' },
      output: '<path>/workspace/calc.py</path>\n<type>file</type>\n<content>def add…</content>',
      metadata: { truncated: false }, title: 'workspace/calc.py',
      time: { start: 1780774003668, end: 1780774003691 },
    }),
    stepFinish('msg_a1', 1780774003700),
    stepStart('msg_a2', 1780774003800),
    toolPart('msg_a2', 1780774005625, 'edit', 'HyGsir6GpPxyz', {
      status: 'completed',
      input: { filePath: '/workspace/calc.py', oldString: '   return a - b', newString: '   return a + b' },
      output: 'updated /workspace/calc.py',
      metadata: { diff: '@@ -1 +1 @@', filediff: { additions: 1, deletions: 1 } },
      time: { start: 1780774005624, end: 1780774005630 },
    }),
    stepFinish('msg_a2', 1780774005650),
    stepStart('msg_a3', 1780774005700),
    toolPart('msg_a3', 1780774007128, 'bash', 'kkcJap3PBnabc', {
      status: 'completed', input: { command: 'python3 calc.py', description: 'run the script' },
      output: '5\n', metadata: { exit: 0, output: '5\n', description: 'run the script' },
      time: { start: 1780774007127, end: 1780774007143 },
    }),
    stepFinish('msg_a3', 1780774007145),
    stepStart('msg_a4', 1780774007200),
    textPart('msg_a4', 1780774007500, 'It printed 5.'),
    stepFinish('msg_a4', 1780774007990),
  ];
  return { session, messages, parts };
}

const norm = (over = {}) => normalizeOpenCodeSession({
  ...happyRun(), runId: 'run-1', runStartedMs: 1780774001000,
  runFinishedMs: 1780774008100, code: 0, timeout: false, timeoutMs: 600000, ...over,
});

// --- §5: tool → workspace-mutation map ---------------------------------------

describe('OPENCODE_WORKSPACE_CHANGED_BY_TOOL — the 12-tool map (§5)', () => {
  it('covers exactly OpenCode 1.16.2 default build-agent tool set', () => {
    assert.deepEqual(
      Object.keys(OPENCODE_WORKSPACE_CHANGED_BY_TOOL).sort(),
      ['bash', 'edit', 'glob', 'grep', 'invalid', 'question', 'read', 'skill', 'task', 'todowrite', 'webfetch', 'write'],
    );
  });
  it('maps mutators true, reads false, conditional/sub-agent null', () => {
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.write, true);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.edit, true);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.read, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.glob, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.grep, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.webfetch, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.todowrite, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.skill, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.question, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.invalid, false);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.bash, null);
    assert.equal(OPENCODE_WORKSPACE_CHANGED_BY_TOOL.task, null);
  });
  it('computeWorkspaceChanged: errored call → false; unknown → null; mapped → value', () => {
    assert.equal(computeWorkspaceChanged('write', false), true);
    assert.equal(computeWorkspaceChanged('write', true), false);   // errored → did nothing
    assert.equal(computeWorkspaceChanged('read', false), false);
    assert.equal(computeWorkspaceChanged('bash', false), null);
    assert.equal(computeWorkspaceChanged('frobnicate', false), null); // unmapped
    assert.equal(computeWorkspaceChanged(null, false), null);
  });
});

// --- §2.1 / §4.1: one assistant message → one iteration ----------------------

describe('normalizeOpenCodeSession — iteration boundary + direct maps (§4.1)', () => {
  it('emits one record per assistant message (user skipped)', () => {
    const { iterRecords } = norm();
    assert.equal(iterRecords.length, 4);
    assert.deepEqual(iterRecords.map((r) => r.iter), [1, 2, 3, 4]);
    assert.deepEqual(iterRecords.map((r) => r.assistant_message_index), [0, 1, 2, 3]);
  });

  it('maps per-iteration tokens straight from message.data.tokens', () => {
    const { iterRecords } = norm();
    assert.deepEqual(
      iterRecords.map((r) => [r.input_tokens, r.output_tokens, r.cache_read_input_tokens, r.cache_creation_input_tokens]),
      [[561, 28, 7226, 0], [110, 62, 7814, 0], [87, 46, 7920, 0], [19, 25, 8052, 0]],
    );
  });

  it('maps stop_reason from message.data.finish', () => {
    assert.deepEqual(norm().iterRecords.map((r) => r.stop_reason),
      ['tool-calls', 'tool-calls', 'tool-calls', 'stop']);
  });

  it('uses message timestamps as the per-iteration wallclock window', () => {
    const r0 = norm().iterRecords[0];
    assert.equal(r0.request_started_ms, 1780774001235);
    assert.equal(r0.request_finished_ms, 1780774003707);
  });

  it('boundary timing: iteration_elapsed + non_model_gap off message timestamps', () => {
    const recs = norm().iterRecords;
    // iter1 → iter2: next.created - this.created
    assert.equal(recs[0].iteration_elapsed_ms, 1780774003709 - 1780774001235);
    assert.equal(recs[0].non_model_gap_ms, 1780774003709 - 1780774003707);
    // final iter: runFinished - created / completed
    assert.equal(recs[3].iteration_elapsed_ms, 1780774008100 - 1780774007148);
    assert.equal(recs[3].non_model_gap_ms, 1780774008100 - 1780774007999);
    assert.equal(recs[0].non_model_gap_source, 'next_message_created_minus_current_message_completed');
  });
});

describe('normalizeOpenCodeSession — tool calls (§2.3, §4.1, §4.3)', () => {
  it('maps callID/name/object-args + per-call timestamps (better than claw)', () => {
    const tc = norm().iterRecords[0].tool_calls[0];
    assert.equal(tc.id, 'g5oDGjz02UeyLZwSOUioRb1slGvcheOX');
    assert.equal(tc.name, 'read');
    assert.deepEqual(tc.arg_summary, { filePath: '/workspace/calc.py' });
    assert.equal(tc.started_ms, 1780774003668);
    assert.equal(tc.finished_ms, 1780774003691);
    assert.equal(tc.elapsed_ms, 23);
    assert.ok(tc.arg_hash.startsWith('sha256:'));
    assert.ok(tc.result_hash.startsWith('sha256:'));
  });

  it('workspace_changed from the §5 map: read=false, edit=true, bash=null', () => {
    const recs = norm().iterRecords;
    assert.equal(recs[0].tool_calls[0].workspace_changed, false); // read
    assert.equal(recs[1].tool_calls[0].workspace_changed, true);  // edit
    assert.equal(recs[2].tool_calls[0].workspace_changed, null);  // bash
    for (const r of recs.slice(0, 3)) assert.equal(r.tool_calls[0].tool_unmapped, false);
  });

  it('final answer turn carries no tool calls', () => {
    assert.deepEqual(norm().iterRecords[3].tool_calls, []);
  });

  it('iteration_status / run_status track the boundary', () => {
    const recs = norm().iterRecords;
    assert.deepEqual(recs.map((r) => r.iteration_status), ['continue', 'continue', 'continue', 'final']);
    assert.deepEqual(recs.map((r) => r.run_status), [null, null, null, 'done']);
  });
});

// --- §4.2 gaps: degrade honestly ---------------------------------------------

describe('normalizeOpenCodeSession — §4.2 gaps degrade honestly', () => {
  it('server prompt/decode split is null from the session log alone', () => {
    const r = norm().iterRecords[0];
    assert.equal(r.server_prompt_eval_ms, null);
    assert.equal(r.server_decode_ms, null);
    assert.equal(r.server_total_ms, null);
    assert.equal(r.server_queue_ms, null);
  });
  it('no LiteLLM bridge: bridge fields null, join_status n/a_opencode', () => {
    const r = norm().iterRecords[0];
    assert.equal(r.bridge_request_seq, null);
    assert.equal(r.join_status, 'n/a_opencode');
    assert.equal(r.model_elapsed_ms, null);
  });
  it('reasoning tokens are surfaced (not silently dropped)', () => {
    assert.equal(norm().iterRecords[0].reasoning_tokens, 0);
    assert.equal(norm().runSummary.total_reasoning_tokens, 0);
  });
  it('run_summary carries the absent-split + no-bridge caveats', () => {
    const caveats = norm().runSummary.timing_caveats.join(' ');
    assert.match(caveats, /server_prompt_decode_split_absent_from_session_log/);
    assert.match(caveats, /no_litellm_bridge/);
  });
});

// --- run_summary rollups ------------------------------------------------------

describe('normalizeOpenCodeSession — run_summary', () => {
  it('prefers session-row token totals and counts tools/mutations', () => {
    const s = norm().runSummary;
    assert.equal(s.iter_count, 4);
    assert.equal(s.total_input_tokens, 777);
    assert.equal(s.total_output_tokens, 161);
    assert.equal(s.total_cache_read_input_tokens, 31012);
    assert.equal(s.total_cache_creation_input_tokens, 0);
    assert.equal(s.tool_call_count, 3);
    assert.equal(s.workspace_changed_count, 1);          // edit only
    assert.equal(s.error_tool_call_count, 0);
    assert.equal(s.unmapped_tool_call_count, 0);
    assert.equal(s.total_iter_tool_elapsed_ms, 23 + 6 + 16); // OpenCode has tool timestamps
    assert.equal(s.terminal_status, 'done');
    assert.equal(s.join_status, 'n/a_opencode');
    assert.equal(s.telemetry, 'transcript');
    assert.equal(s.session_id, SES);
    assert.equal(s.model_id, 'llama-local/opencode');
    assert.equal(s.passed, null);
    assert.equal(s.context_overflow, false);
  });
});

// --- AC: unmapped/unknown tools degrade + are flagged -------------------------

describe('normalizeOpenCodeSession — unknown tool degrades + is flagged', () => {
  it('records an unmapped tool, flags it, workspace_changed=null, never crashes', () => {
    const f = happyRun();
    // Swap the read tool's name for one not in the map.
    const p = f.parts.find((x) => x.data.type === 'tool' && x.data.tool === 'read');
    p.data.tool = 'frobnicate';
    const { iterRecords, runSummary } = normalizeOpenCodeSession({
      ...f, runId: 'run-x', runStartedMs: 1, runFinishedMs: 2, code: 0,
    });
    const tc = iterRecords[0].tool_calls[0];
    assert.equal(tc.name, 'frobnicate');
    assert.equal(tc.tool_unmapped, true);
    assert.equal(tc.workspace_changed, null);
    assert.equal(runSummary.unmapped_tool_call_count, 1);
    assert.match(runSummary.timing_caveats.join(' '), /unmapped_tools: 1/);
  });
});

// --- AC: tool errors (§4.2.5) ------------------------------------------------

describe('normalizeOpenCodeSession — tool error shapes (§4.2.5)', () => {
  it('non-"completed" status → error, classified, workspace_changed=false', () => {
    const f = happyRun();
    const p = f.parts.find((x) => x.data.type === 'tool' && x.data.tool === 'edit');
    p.data.state.status = 'error';
    p.data.state.output = 'Error: ENOENT no such file or directory';
    const { iterRecords, runSummary } = normalizeOpenCodeSession({
      ...f, runId: 'r', runStartedMs: 1, runFinishedMs: 2, code: 1,
    });
    const tc = iterRecords[1].tool_calls[0];
    assert.equal(tc.result_is_error, true);
    assert.equal(tc.result_error_class, 'not_found');
    assert.ok(tc.result_error_signature);
    assert.equal(tc.workspace_changed, false); // errored edit changed nothing observable
    assert.equal(runSummary.error_tool_call_count, 1);
  });

  it('bash non-zero metadata.exit → error even when status is "completed"', () => {
    const f = happyRun();
    const p = f.parts.find((x) => x.data.type === 'tool' && x.data.tool === 'bash');
    p.data.state.metadata.exit = 2;
    p.data.state.output = 'Traceback…\nNameError: name x is not defined';
    const { iterRecords } = normalizeOpenCodeSession({
      ...f, runId: 'r', runStartedMs: 1, runFinishedMs: 2, code: 1,
    });
    const tc = iterRecords[2].tool_calls[0];
    assert.equal(tc.result_is_error, true);
    assert.equal(tc.workspace_changed, false);
  });
});

// --- repeated-call / no-progress diagnostics ---------------------------------

describe('normalizeOpenCodeSession — repeated identical call (no progress)', () => {
  it('flags a same-name+same-arg+same-result repeat as no-progress', () => {
    const f = happyRun();
    // Make iter2 a second identical read of the same file with the same output.
    const a2 = f.messages.find((m) => m.id === 'msg_a2');
    a2.data.finish = 'tool-calls';
    const editPartIdx = f.parts.findIndex((x) => x.data.type === 'tool' && x.data.tool === 'edit');
    f.parts[editPartIdx] = toolPart('msg_a2', 1780774005625, 'read', 'dupCall', {
      status: 'completed', input: { filePath: '/workspace/calc.py' },
      output: '<path>/workspace/calc.py</path>\n<type>file</type>\n<content>def add…</content>',
      metadata: { truncated: false }, time: { start: 1780774005624, end: 1780774005630 },
    });
    const { runSummary } = normalizeOpenCodeSession({
      ...f, runId: 'r', runStartedMs: 1, runFinishedMs: 2, code: 0,
    });
    assert.equal(runSummary.repeated_tool_call_count, 1);
    assert.equal(runSummary.no_progress_repeat_count, 1);
    assert.equal(runSummary.result_changed_vs_prev_count, 0);
  });
});

// --- empty + timeout/partial degrade -----------------------------------------

describe('normalizeOpenCodeSession — empty + timeout degrade (§6)', () => {
  it('empty session: zero iterations, empty_session join_status + caveat', () => {
    const { iterRecords, runSummary } = normalizeOpenCodeSession({
      session: null, messages: [], parts: [], runId: 'r', runStartedMs: 1, runFinishedMs: 2, code: 0,
    });
    assert.equal(iterRecords.length, 0);
    assert.equal(runSummary.iter_count, 0);
    assert.equal(runSummary.join_status, 'empty_session');
    assert.match(runSummary.timing_caveats.join(' '), /empty_session/);
    assert.equal(runSummary.terminal_status, 'done'); // code 0 even if nothing ran
  });

  it('timeout/partial: censored, final iter aborted, run_status timeout', () => {
    const { iterRecords, runSummary } = norm({ timeout: true, code: null });
    assert.equal(runSummary.terminal_status, 'timeout');
    assert.equal(runSummary.censored, true);
    assert.equal(runSummary.timeout, true);
    assert.equal(iterRecords.at(-1).iteration_status, 'aborted');
    assert.equal(iterRecords.at(-1).run_status, 'timeout');
    assert.match(runSummary.timing_caveats.join(' '), /run_censored_timeout/);
  });
});

// --- buildOpenCodeArtifacts: write sidecars + #022 join ----------------------

describe('buildOpenCodeArtifacts — writes sidecars; degrades on no DB', () => {
  const mkRunDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tr-'));
  const fakeReader = () => happyRun();

  it('returns null when the DB is absent/unreadable (caller degrades)', () => {
    const runDir = mkRunDir();
    const meta = buildOpenCodeArtifacts({
      dbPath: '/no/such.db', runDir, runId: 'r', readSession: () => null,
    });
    assert.equal(meta, null);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('writes iterations.jsonl + run_summary.json from the normalized DB', () => {
    const runDir = mkRunDir();
    const meta = buildOpenCodeArtifacts({
      dbPath: '/evidence.db', runDir, runId: 'r-iter', runStartedMs: 1,
      runFinishedMs: 2, code: 0, readSession: fakeReader,
    });
    assert.equal(meta.iterCount, 4);
    const iters = fs.readFileSync(meta.iterationsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(iters.length, 4);
    assert.equal(iters[0].input_tokens, 561);
    const summary = JSON.parse(fs.readFileSync(meta.runSummaryPath, 'utf8'));
    assert.equal(summary.iter_count, 4);
    assert.equal(meta.serverTimingsPath, null); // timings disabled → no sidecar
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('#022 enabled: joins ordinal timings inline + writes server.timings.jsonl', () => {
    const runDir = mkRunDir();
    // 3 timing records to pair with iters 1..3 (iter 4 has no server request here).
    const serverTimings = [
      { source: 'llama_server_log', server_prompt_eval_ms: 100, server_decode_ms: 200, server_total_ms: 300, server_queue_ms: null, server_tokens_per_second: 40, task_id: 113 },
      { source: 'llama_server_log', server_prompt_eval_ms: 50, server_decode_ms: 400, server_total_ms: 450, server_queue_ms: null, server_tokens_per_second: 35, task_id: 114 },
      { source: 'llama_server_log', server_prompt_eval_ms: 30, server_decode_ms: 600, server_total_ms: 630, server_queue_ms: null, server_tokens_per_second: 30, task_id: 115 },
    ];
    const meta = buildOpenCodeArtifacts({
      dbPath: '/evidence.db', runDir, runId: 'r-ts', runStartedMs: 1, runFinishedMs: 2, code: 0,
      readSession: fakeReader, serverTimings, serverTimingsEnabled: true,
    });
    assert.ok(meta.serverTimingsPath && meta.serverTimingsPath.endsWith('server.timings.jsonl'));
    assert.equal(meta.serverTimingsJoinStatus, 'count_mismatch'); // 3 timings vs 4 iters
    // Server split is now inline on the iteration records too.
    const iters = fs.readFileSync(meta.iterationsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(iters[0].server_decode_ms, 200);
    assert.equal(iters[0].server_timing_task_id, 113);
    assert.equal(iters[3].server_decode_ms, null); // unpaired tail
    // Sidecar carries one record per iteration with a split.
    const side = fs.readFileSync(meta.serverTimingsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(side.length, 3);
    assert.equal(side[0].run_id, 'r-ts');
    assert.equal(side[0].iter, 1);
    assert.equal(side[0].server_decode_ms, 200);
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

// --- INTEGRATION: read the real evidence DB (gated, gitignored) --------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DB = process.env.OPENCODE_EVIDENCE_DB
  || path.resolve(HERE, '../../../../client/opencode/.opencode-runtime/ws020-evidence/opencode.db');
const haveEvidence = (() => { try { return fs.existsSync(EVIDENCE_DB); } catch { return false; } })();

describe('readOpenCodeSession + normalize — real #020 evidence DB (gated)', () => {
  it('reads the real DB and normalizes the known token bytes field-by-field',
    { skip: haveEvidence ? false : `evidence DB not present at ${EVIDENCE_DB}` },
    () => {
      const session = readOpenCodeSession(EVIDENCE_DB);
      assert.ok(session, 'reader returned null on the real DB');
      assert.equal(session.messages.length, 5); // 1 user + 4 assistant
      assert.equal(session.parts.length, 13);

      const { iterRecords, runSummary } = normalizeOpenCodeSession({
        session: session.session, messages: session.messages, parts: session.parts,
        runId: 'real', runStartedMs: 1780774001000, runFinishedMs: 1780774008100,
        code: 0, timeout: false, timeoutMs: 600000,
      });
      assert.equal(iterRecords.length, 4);
      assert.deepEqual(
        iterRecords.map((r) => [r.input_tokens, r.output_tokens, r.cache_read_input_tokens]),
        [[561, 28, 7226], [110, 62, 7814], [87, 46, 7920], [19, 25, 8052]],
      );
      assert.deepEqual(iterRecords.map((r) => r.stop_reason),
        ['tool-calls', 'tool-calls', 'tool-calls', 'stop']);
      assert.deepEqual(
        iterRecords.slice(0, 3).map((r) => r.tool_calls[0].name), ['read', 'edit', 'bash']);
      assert.equal(iterRecords[1].tool_calls[0].workspace_changed, true);  // edit
      assert.equal(iterRecords[0].tool_calls[0].workspace_changed, false); // read
      // Session-row rollups.
      assert.equal(runSummary.total_input_tokens, 777);
      assert.equal(runSummary.total_output_tokens, 161);
      assert.equal(runSummary.total_cache_read_input_tokens, 31012);
      assert.equal(runSummary.model_id, 'llama-local/opencode');
    });
});
