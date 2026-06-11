// Issue #001 (sidecar status discipline): unit tests pinning runOpenCode's
// terminal-status labeling in the on-disk run_summary.json sidecar — the
// sidecar is what registry_emit builds the row from (run_row's
// pickTerminalStatus prefers it; registry_emit hardcodes signal:null), so a
// wrong label there flows straight into paired_bootstrap.isEligible.
//
//  1. Spawn failure: node emits 'error' then 'close' (code -2, node 22/24).
//     The 'error' handler writes terminal_status 'harness_error' + spawn_error;
//     the 'close' handler must NOT rewrite the sidecar as a plain 'error' run
//     (which would re-enter the run as an eligible model failure).
//  2. Abort-source honesty: a caller-initiated abort (runAgent cancellation)
//     labels the sidecar 'interrupted'; only the internal
//     AbortSignal.timeout(timeoutMs) hard ceiling labels it 'timeout'.
//
// Docker-free via the `exec` test seam (same convention as
// opencode.contract.test.js): a missing binary reproduces the spawn-level
// 'error' → 'close'(-2) sequence; `sleep` stands in for a hung agent.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { runOpenCode } from '../../lib/opencode.js';

let RUNTIME_ROOT;
before(() => { RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-status-')); });
after(() => { fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true }); });

// A fake "agent" that sleeps long enough to be killed by the timeout/abort.
const SLEEP = { file: 'sleep', args: ['60'] };
// A spawn-level failure: ENOENT on the binary → 'error' then 'close'(-2).
const MISSING_BIN = { file: '/nonexistent/oc-issue-001-missing-binary', args: [] };

const base = () => ({
  prompt: 'p',
  runtimeRoot: RUNTIME_ROOT,
  reapContainer: false, // no real container behind the fake exec
});

const readSummary = (runDir) =>
  JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));

describe("runOpenCode sidecar: 'close' must not overwrite the 'error' sidecar", () => {
  it("retains terminal_status 'harness_error' + spawn_error after 'close'(-2) fires", async () => {
    const r = await runOpenCode({ ...base(), exec: MISSING_BIN });

    // The promise resolves from the 'error' handler.
    assert.equal(r.terminal_status, 'harness_error');
    assert.equal(r.code, null);
    assert.match(r.stderr, /spawn error/);

    // ...but 'close' (code -2) fires AFTER resolution. Give it ample time to
    // land, then assert the on-disk sidecar was NOT relabeled.
    await delay(400);

    const summary = readSummary(r.runDir);
    assert.equal(summary.terminal_status, 'harness_error',
      "close handler must not relabel a spawn failure (e.g. as 'error')");
    assert.notEqual(summary.spawn_error, null,
      "spawn_error must survive the 'close' event");
    assert.match(String(summary.spawn_error), /ENOENT/);
    assert.equal(summary.exit_code, null);
  });
});

describe('runOpenCode sidecar: caller abort vs internal hard-timeout', () => {
  it("caller-initiated abort → sidecar terminal_status 'interrupted'", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    // Internal ceiling far out: the caller signal is unambiguously the source.
    const r = await runOpenCode({
      ...base(), exec: SLEEP, signal: ac.signal, timeoutMs: 60_000,
    });

    assert.equal(r.terminal_status, 'interrupted');
    assert.equal(r.code, null);

    const summary = readSummary(r.runDir);
    assert.equal(summary.terminal_status, 'interrupted');
    assert.equal(summary.timeout, false, 'a caller abort is not a timeout');
    assert.equal(summary.exit_code, null);
    // Cut short → the observation is censored, same as a timeout.
    assert.equal(summary.censored, true);
    // isEligible discipline: interrupted rows carry no pass/fail verdict.
    assert.equal(summary.passed, null);
  });

  it("already-aborted caller signal → 'interrupted' (kill before the child runs)", async () => {
    const r = await runOpenCode({ ...base(), exec: SLEEP, signal: AbortSignal.abort() });
    assert.equal(r.terminal_status, 'interrupted');
    assert.equal(r.code, null);
    const summary = readSummary(r.runDir);
    assert.equal(summary.terminal_status, 'interrupted');
    assert.equal(summary.timeout, false);
  });

  it("internal hard-timeout with a (silent) caller signal present → still 'timeout'", async () => {
    const ac = new AbortController(); // never aborted
    const r = await runOpenCode({
      ...base(), exec: SLEEP, signal: ac.signal, timeoutMs: 300,
    });

    assert.equal(r.terminal_status, 'timeout');
    assert.equal(r.timeout, true);

    const summary = readSummary(r.runDir);
    assert.equal(summary.terminal_status, 'timeout');
    assert.equal(summary.timeout, true);
    assert.equal(summary.exit_code, null);
    assert.equal(summary.censored, true);
  });

  it("internal hard-timeout with no caller signal at all → 'timeout'", async () => {
    const r = await runOpenCode({ ...base(), exec: SLEEP, timeoutMs: 300 });
    assert.equal(r.terminal_status, 'timeout');
    const summary = readSummary(r.runDir);
    assert.equal(summary.terminal_status, 'timeout');
  });
});
