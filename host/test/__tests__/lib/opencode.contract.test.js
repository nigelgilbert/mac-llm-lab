// Contract unit tests for lib/opencode.js — the RunnerResult shape, the
// combined-signal, the timeout-RESOLVES-not-rejects guarantee, and a populated
// runDir. Docker-free by design: the `exec` test seam substitutes a fake
// program (`sleep`, `sh -c 'exit N'`) for the real `docker compose` argv, so
// these run in a plain node container with no docker socket. The live-docker
// behavior (real /workspace mutation + the dead-port hang→reap) is covered by
// scripts/opencode-smoke.mjs, which needs a daemon and :11436.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOpenCode, dockerComposeArgv } from '../../lib/opencode.js';

let RUNTIME_ROOT;
before(() => { RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contract-')); });
after(() => { fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true }); });

// A fake "agent" that sleeps long enough to be killed by the timeout/abort.
const SLEEP = { file: 'sleep', args: ['60'] };
// A fake "agent" that exits immediately with a chosen code.
const exitWith = (n) => ({ file: 'sh', args: ['-c', `exit ${n}`] });

const base = () => ({
  prompt: 'p',
  runtimeRoot: RUNTIME_ROOT,
  reapContainer: false, // no real container behind the fake exec
});

describe('runOpenCode: input validation', () => {
  it('throws when prompt is missing', () => {
    assert.throws(() => runOpenCode({ ...base(), prompt: '' }), /prompt required/);
  });
});

describe('runOpenCode: RunnerResult shape + populated runDir', () => {
  it('resolves the documented shape on a clean exit and writes a sidecar', async () => {
    const r = await runOpenCode({ ...base(), exec: exitWith(0) });

    // Shape matches the Runner typedef / claw's RunnerResult.
    assert.equal(r.code, 0);
    assert.equal(typeof r.stdout, 'string');
    assert.equal(typeof r.stderr, 'string');
    assert.equal(typeof r.elapsedMs, 'number');
    assert.ok(r.elapsedMs >= 0);
    assert.equal(typeof r.runDir, 'string');
    assert.ok(r.runDir.length > 0);
    // Clean exit carries no terminal_status (claw convention: set only on abort).
    assert.equal(r.terminal_status, undefined);

    // runDir is real and row-writable: run_summary.json + iterations.jsonl exist.
    assert.ok(fs.existsSync(r.runDir), 'runDir must exist on disk');
    const summary = JSON.parse(fs.readFileSync(path.join(r.runDir, 'run_summary.json'), 'utf8'));
    assert.equal(summary.run_id, r.runId);
    assert.equal(summary.terminal_status, 'done');
    assert.equal(summary.exit_code, 0);
    assert.equal(summary.timeout, false);
    assert.equal(summary.iter_count, 0);
    assert.equal(summary.passed, null); // pass decided by the workspace oracle, not here
    assert.equal(typeof summary.run_started_ms, 'number');
    assert.equal(typeof summary.run_finished_ms, 'number');
    assert.ok(fs.existsSync(path.join(r.runDir, 'iterations.jsonl')));
  });

  it('captures a non-zero exit code as telemetry (terminal_status=error), not a throw', async () => {
    const r = await runOpenCode({ ...base(), exec: exitWith(1) });
    assert.equal(r.code, 1);
    assert.equal(r.terminal_status, undefined); // non-zero exit is not a timeout
    const summary = JSON.parse(fs.readFileSync(path.join(r.runDir, 'run_summary.json'), 'utf8'));
    assert.equal(summary.exit_code, 1);
    assert.equal(summary.terminal_status, 'error');
    assert.equal(summary.passed, null);
  });
});

describe('runOpenCode: timeout RESOLVES (never rejects)', () => {
  it('resolves with terminal_status:timeout + code:null when the internal timer fires', async () => {
    const start = Date.now();
    // assert.doesNotReject proves the load-bearing property: a hung run must
    // RESOLVE, not reject, or runAgent's diagnostics never flush.
    let r;
    await assert.doesNotReject(async () => {
      r = await runOpenCode({ ...base(), exec: SLEEP, timeoutMs: 300 });
    });
    assert.equal(r.code, null);
    assert.equal(r.terminal_status, 'timeout');
    assert.equal(r.timeout, true);
    assert.ok(Date.now() - start >= 250, 'should have waited ~timeoutMs before killing');
    assert.ok(Date.now() - start < 10_000, 'should not hang past the timeout');

    // Sidecar reflects the timeout for the reporter / run_row.
    const summary = JSON.parse(fs.readFileSync(path.join(r.runDir, 'run_summary.json'), 'utf8'));
    assert.equal(summary.terminal_status, 'timeout');
    assert.equal(summary.timeout, true);
    assert.equal(summary.exit_code, null);
    assert.equal(summary.censored, true);
  });
});

describe('runOpenCode: combined-signal honors the caller signal', () => {
  // Issue #001: a caller-initiated abort is labeled 'interrupted', not
  // 'timeout' — only the internal AbortSignal.timeout ceiling says 'timeout'.
  // The full sidecar-side assertions live in opencode-sidecar-status.test.js.
  it('resolves interrupted when the caller aborts (no internal timeoutMs set)', async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = runOpenCode({ ...base(), exec: SLEEP, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    let r;
    await assert.doesNotReject(async () => { r = await p; });
    assert.equal(r.code, null);
    assert.equal(r.terminal_status, 'interrupted');
    assert.ok(Date.now() - start < 10_000);
  });

  it('honors BOTH sources: an already-aborted caller signal kills immediately', async () => {
    const r = await runOpenCode({
      ...base(), exec: SLEEP, signal: AbortSignal.abort(),
    });
    assert.equal(r.terminal_status, 'interrupted');
    assert.equal(r.code, null);
  });

  it('whichever of caller-signal / timeoutMs fires first wins, still resolves', async () => {
    // Caller signal fires at 150ms; internal ceiling is far out — caller wins,
    // so the run is labeled a caller interruption rather than a timeout.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const r = await runOpenCode({ ...base(), exec: SLEEP, signal: ac.signal, timeoutMs: 60_000 });
    assert.equal(r.terminal_status, 'interrupted');
  });
});

describe('dockerComposeArgv: argv construction', () => {
  it('builds the #009-proven one-shot argv with --name for reap targeting', () => {
    const { file, args } = dockerComposeArgv({
      composeFile: '/repo/client/opencode/docker-compose.yml',
      containerName: 'oc-run-abc',
      prompt: 'do a thing',
      dockerBin: 'docker',
    });
    assert.equal(file, 'docker');
    assert.deepEqual(args, [
      'compose', '-f', '/repo/client/opencode/docker-compose.yml',
      'run', '--rm', '-T', '--name', 'oc-run-abc',
      'opencode', 'opencode', 'run', 'do a thing',
    ]);
  });

  it('emits one -f per file for base+override compose stacks', () => {
    const { args } = dockerComposeArgv({
      composeFile: ['/base.yml', '/override.yml'],
      containerName: 'oc-run-xyz',
      prompt: 'p',
    });
    assert.deepEqual(
      args.slice(0, 5),
      ['compose', '-f', '/base.yml', '-f', '/override.yml'],
    );
    assert.ok(args.includes('--name'));
    assert.equal(args.at(-1), 'p');
  });

  it('injects the #021 DB bind mount as a `run` option (before the service)', () => {
    const { args } = dockerComposeArgv({
      composeFile: '/repo/docker-compose.yml',
      containerName: 'oc-run-abc',
      prompt: 'do a thing',
      dataMount: { hostPath: '/host/run/opencode-data', containerPath: '/root/.local/share/opencode' },
    });
    const vIdx = args.indexOf('-v');
    const svcIdx = args.indexOf('opencode');
    assert.ok(vIdx > 0, '-v present');
    assert.equal(args[vIdx + 1], '/host/run/opencode-data:/root/.local/share/opencode');
    // The mount must precede the SERVICE name, else docker treats it as a cmd arg.
    assert.ok(vIdx < svcIdx, '-v must come before the service name');
    // Still the one-shot run shape afterward.
    assert.deepEqual(args.slice(svcIdx), ['opencode', 'opencode', 'run', 'do a thing']);
  });

  it('omits the bind mount when no dataMount is given (pre-#021 argv)', () => {
    const { args } = dockerComposeArgv({
      composeFile: '/repo/docker-compose.yml',
      containerName: 'oc-run-abc',
      prompt: 'p',
    });
    assert.equal(args.includes('-v'), false);
  });
});
