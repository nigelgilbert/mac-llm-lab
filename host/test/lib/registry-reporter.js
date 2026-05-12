// node:test stream reporter that:
//   - Writes <runDir>/assertion_result.json for every leaf test, with `passed`
//     derived from the test:pass / test:fail event type (never null).
//   - Logs the per-test header `=== <test_id> (<tier>) === PASS|FAIL` (plus the
//     agent/post detail lines that used to live in runAgentSetup, pre-1.22).
//   - Sets globalThis.__registryReporterLoaded so runAgent can detect a missing
//     --test-reporter flag in RUN_REGISTRY_EMIT=1 sweeps.
//
// Wired in package.json + entrypoint.sh + the sweep scripts via:
//   --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout
//
// runAgent emits the data the reporter needs via diagnostics keyed to the
// test's call site (file:line:column). The contract:
//   runDir=<path>          (early; locates the sidecar)
//   test_id=<id>           (early; header + downstream registry-row test_id)
//   agent_result=<JSON>    {code, elapsedMs, files, stderrTail?}
//   post_result=<JSON>     {script, status, stderrTrim, stderrTail}  (only when postScript was set)
//
// Diagnostics fire *after* the corresponding test:pass/test:fail (node:test
// buffers them), so we accumulate per (file, line, column) and write the
// sidecar at end-of-stream. With --test-concurrency=1 and one leaf per file
// (the tier-eval pattern), this collapses to "one write per process at exit",
// which is what the harness used to do.

import { writeAssertionResult } from './claw.js';
import { TIER_LABEL } from './tier.js';

globalThis.__registryReporterLoaded = true;

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
    claw_exit:        typeof a.code === 'number' || a.code === null ? a.code : null,
    post_status:      p ? p.status : null,
    post_stderr_tail: p ? (p.stderrTail ?? '').slice(0, POST_STDERR_TAIL) : null,
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
  }

  for (const pending of pendings.values()) flush(pending);
}
