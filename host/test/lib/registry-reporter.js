// node:test stream reporter that:
//   - Logs the per-test header `=== <test_id> (<tier>) === PASS|FAIL` for every
//     leaf test (plus the agent/post detail lines that used to live in
//     runAgentSetup, pre-1.22).
//   - Writes <runDir>/assertion_result.json for tests that emit a `runDir`
//     diagnostic (i.e. went through runAgent and reached its entry-time
//     diagnostics). Tests without a runDir — Family C, model-ab, or runAgent
//     failures before the diagnostic flush — get the header but no sidecar.
//     `passed` is derived from the test:pass / test:fail event type (never
//     null).
//
// Wired in package.json + the sweep driver's per-cell loop via:
//   --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout
//
// runAgent emits the data the reporter needs via diagnostics keyed to the
// test's call site (file:line:column). The contract:
//   runDir=<path>          (early; locates the sidecar)
//   test_id=<id>           (early; header + downstream registry-row test_id)
//   agent_result=<JSON>    {code, elapsedMs, files, stderrTail?}
//   post_result=<JSON>     {script, status, stderrTrim, stderrTail}  (only when postScript was set)
//   runAgent_done=1        (last; triggers per-test flush + pending delete)
//
// Diagnostics fire *after* the corresponding test:pass/test:fail (node:test
// buffers them), so we accumulate per (file, line, column). The flush model:
//   - Primary: on `runAgent_done`, flush the pending entry and delete it.
//     Tightens the SIGTERM-vs-flush window to ~one test's wallclock and
//     keeps the reporter correct for files with multiple `it(...)` blocks.
//   - End-of-stream loop: load-bearing, not paranoid. Flushes two real cases:
//       (1) Family C / non-runAgent tests — no sentinel by design, runDir
//           absent, so flush() prints the header and skips sidecar write.
//       (2) runAgent threw between the agent_result diagnostic and the
//           sentinel (e.g. postScript spawnSync raised) — runDir + test_id +
//           agent_result already landed, so the sidecar is written here with
//           passed=false (from test:fail) and post_status=null. Without this
//           loop those cells would have no sidecar.
//     The asymmetry is intentional: runAgent does NOT wrap its body in
//     try/finally to fire the sentinel on throw, so SIGTERM landing between
//     a mid-runAgent throw and end-of-stream loses these sidecars. Mid-
//     runAgent throws are rare (spawn ENOENT-class) and the driver's row
//     audit (#003: run-config-ab.sh writes the expected-attempts plan before
//     its arms phase and diffs the fresh registry rows post-gate) names the
//     resulting missing cells and fails the sweep, so the tradeoff is
//     acceptable. Don't "fix" by adding try/finally without revisiting this.

import { writeAssertionResult } from './registry_emit.js';
import { TIER_LABEL } from './tier.js';

const POST_STDERR_TAIL = 800;

function locKey(data) {
  return `${data.file}:${data.line}:${data.column}`;
}

function parseDiagnostic(message) {
  const eq = message.indexOf('=');
  if (eq < 0) return null;
  return { key: message.slice(0, eq), value: message.slice(eq + 1) };
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function printHeader(pending) {
  const verdict = pending.passed ? 'PASS' : 'FAIL';
  const id = pending.test_id ?? pending.name ?? '<unknown>';
  console.log(`\n=== ${id} (${TIER_LABEL}) === ${verdict}`);
  if (pending.agent_result) {
    const a = pending.agent_result;
    console.log(`  agent: exit=${a.code} elapsed=${a.elapsedMs}ms files=${JSON.stringify(a.files ?? [])}`);
    // Exit code is telemetry, not a pass gate (issue #001): a non-zero,
    // non-null code means the agent crashed before finishing. The workspace
    // post-script still decides PASS/FAIL above; surface the crash so a
    // workspace-passed-but-agent-crashed run is visible rather than silent.
    if (typeof a.code === 'number' && a.code !== 0) {
      console.log(`  ⚠ agent crashed before finishing (exit=${a.code}); workspace oracle still decided the verdict`);
    }
    if (a.code !== 0 && a.stderrTail) {
      console.log(`  agent stderr (tail):\n${a.stderrTail}`);
    }
  }
  if (pending.post_result) {
    const p = pending.post_result;
    console.log(`  node post: ${p.script} exit=${p.status} stderr=${(p.stderrTrim ?? '').trim()}`);
  }
}

function flush(pending) {
  printHeader(pending);
  if (!pending.runDir) {
    // runAgent never emitted runDir — either the test doesn't use runAgent
    // (Family C / model-ab / etc.) or runAgent threw before its entry-time
    // diagnostics. Either way, nothing to write here.
    return;
  }
  const a = pending.agent_result ?? {};
  const p = pending.post_result;
  writeAssertionResult(pending.runDir, {
    passed:           pending.passed,
    claw_exit:        a.code ?? null,
    post_status:      p ? p.status : null,
    post_stderr_tail: p ? (p.stderrTail ?? '').slice(-POST_STDERR_TAIL) : null,
  });
}

export default async function* registryReporter(source) {
  const pendings = new Map(); // file:line:col → pending entry

  for await (const ev of source) {
    if (ev.type === 'test:pass' || ev.type === 'test:fail') {
      if (ev.data.details?.type !== 'test') continue; // skip describe/suite events
      pendings.set(locKey(ev.data), {
        passed:   ev.type === 'test:pass',
        name:     ev.data.name,
        file:     ev.data.file,
        runDir:   null,
        test_id:  null,
        agent_result: null,
        post_result:  null,
      });
      continue;
    }
    if (ev.type !== 'test:diagnostic') continue;
    if (ev.data.file == null) continue; // summary-line diagnostics (no location)
    const pending = pendings.get(locKey(ev.data));
    if (!pending) continue;

    const parsed = parseDiagnostic(ev.data.message);
    if (!parsed) continue;

    if (parsed.key === 'runDir')        pending.runDir = parsed.value;
    else if (parsed.key === 'test_id')  pending.test_id = parsed.value;
    else if (parsed.key === 'agent_result') pending.agent_result = tryJson(parsed.value);
    else if (parsed.key === 'post_result')  pending.post_result  = tryJson(parsed.value);
    else if (parsed.key === 'runAgent_done') {
      flush(pending);
      pendings.delete(locKey(ev.data));
    }
  }

  // Load-bearing flush for entries that never received `runAgent_done`:
  // Family C (no sentinel by design) and runAgent throws between
  // agent_result and the sentinel (sidecar still gets written from the
  // diagnostics that landed pre-throw). See header comment for the SIGTERM
  // tradeoff this accepts.
  for (const pending of pendings.values()) flush(pending);
}
