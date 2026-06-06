// Drive the OpenCode container (Config B) one-shot and capture an outcome-only
// RunnerResult — the B-side analog of lib/claw.js's runClaw. It is a drop-in
// `runner` for runAgent (lib/runAgent.js): same `{ prompt, signal, timeoutMs }`
// call shape, same `{ code, stdout, stderr, elapsedMs, runDir, terminal_status }`
// return shape, same combined-signal + **timeout-resolves-not-rejects** pattern.
// Wiring it as the default runner via a CONFIG selector is #011; here it is
// built and tested invoked explicitly.
//
// How it runs the agent (the #009-proven headless path,
// client/opencode/docs/HEADLESS-ONESHOT.md):
//   docker compose -f client/opencode/docker-compose.yml \
//     run --rm -T --name oc-run-<id> opencode opencode run "<prompt>"
// with WORKSPACE pointed at the per-run workspace dir (the compose already
// black-holes models.dev and mounts the provider config). Unlike claw — whose
// binary is baked into the test image and runs in-process — OpenCode runs in
// its own sibling container, so this runner shells out to `docker compose`.
//
// Outcome-only (#001 / plan §0b): this runner does NOT decide pass/fail. The
// `/workspace` post-script (run by runAgent) is the sole oracle. The OpenCode
// exit code is captured as telemetry only — it is far too coarse to gate on
// (#009: every pre-flight error is `1`) and is *absent entirely* on the two
// silent-hang modes (models.dev bootstrap stall; llama-server endpoint-down
// mid-stream). We map a timeout-kill to terminal_status 'timeout'; runAgent
// reserves `crashed_before_finishing` for a non-zero exit with an unmet oracle.
//
// The hard timeout is load-bearing, not nice-to-have. Both #009 hang modes emit
// NO exit code — `docker compose run` would wait forever — so a single dead
// endpoint or catalog stall would otherwise wedge the whole sweep. On timeout
// (or caller abort) we hard-kill by FORCE-REMOVING the run container with
// `docker rm -f`: killing the attached `docker compose run` CLI alone does not
// reap the container (the hang lives in the container, parked on the model
// socket). Once the container is gone the CLI exits on its own (verified #010),
// the child closes, and we RESOLVE with terminal_status 'timeout' — never
// reject — so runAgent's diagnostics still flush and the reporter writes a row.
//
// No transcript adapter yet (#021): the per-run sidecar carries run_summary.json
// + an empty iterations.jsonl, which is all the registry reporter / run_row.js
// need to write a row (iters_count = 0). Iteration/token telemetry is deferred.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;

// host/test/lib/opencode.js → repo root is three levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

const DEFAULT_COMPOSE_FILE = process.env.OPENCODE_COMPOSE_FILE
  || path.join(REPO_ROOT, 'client', 'opencode', 'docker-compose.yml');
// Per-run workspace the opencode container bind-mounts at /workspace (the
// compose's `${WORKSPACE}:/workspace`). Defaults to the compose's own default
// workspace dir; #011 wires this to the shared workspace runAgent resets/seeds.
const DEFAULT_WORKSPACE_DIR = process.env.OPENCODE_WORKSPACE
  || path.join(REPO_ROOT, 'client', 'opencode', 'workspace');
// Sidecar root, sibling to the workspace (NOT under it) so workspace.reset()
// and the post-script never touch it — unlike claw's in-/workspace .claw-runtime
// which needs PRESERVE_BETWEEN_RUNS.
const DEFAULT_RUNTIME_ROOT = process.env.OPENCODE_RUNTIME_ROOT
  || path.join(REPO_ROOT, 'client', 'opencode', '.opencode-runtime');
const DEFAULT_DOCKER_BIN = process.env.OPENCODE_DOCKER_BIN || 'docker';

// Bound the reap so a wedged docker daemon can't itself hang the kill path.
const DOCKER_RM_TIMEOUT_MS = 15_000;

/**
 * Build the `docker compose ... run` argv. Exported for unit testing — it is a
 * pure function of its inputs.
 *
 * @param {Object} o
 * @param {string|string[]} o.composeFile  One or more compose files (each → `-f`).
 *   Multiple files support base+override (e.g. a dead-port override in tests).
 * @param {string} o.containerName  `--name` so the reap can target this exact run.
 * @param {string} o.prompt
 * @param {string} [o.dockerBin]
 * @returns {{ file: string, args: string[] }}
 */
export function dockerComposeArgv({ composeFile, containerName, prompt, dockerBin = DEFAULT_DOCKER_BIN }) {
  const files = Array.isArray(composeFile) ? composeFile : [composeFile];
  const fileFlags = files.flatMap((f) => ['-f', f]);
  return {
    file: dockerBin,
    args: [
      'compose', ...fileFlags,
      // --rm: clean up the container on graceful exit. -T: no TTY (headless).
      // --name: deterministic name so the timeout reap can `docker rm -f` it.
      'run', '--rm', '-T', '--name', containerName,
      'opencode',          // the compose service
      'opencode', 'run', prompt,   // the in-container command
    ],
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.prompt
 * @param {AbortSignal} [opts.signal]   Caller cancellation (runAgent passes t.signal).
 * @param {number} [opts.timeoutMs]     Internal hard ceiling; enforced with a container kill.
 * @param {string} [opts.workspaceDir]  Host dir bind-mounted to /workspace (per-run).
 * @param {string|string[]} [opts.composeFile]
 * @param {string} [opts.runtimeRoot]   Parent of the per-run sidecar dir.
 * @param {string} [opts.dockerBin]
 * @param {{file:string,args:string[]}} [opts.exec]  TEST SEAM. Replaces the
 *   docker-compose argv with a fake program (e.g. `sleep`, `sh -c 'exit N'`).
 *   The contract — combined-signal, timeout-resolves, RunnerResult shape, runDir
 *   — is binary-agnostic, so the unit tests drive it in a docker-less node
 *   container without standing up a real container. Unset in production.
 * @param {boolean} [opts.reapContainer=true]  TEST SEAM. When false, abort skips
 *   `docker rm -f` and relies on child SIGKILL alone (a fake `exec` has no
 *   container to reap). Always true on the real docker path.
 * @returns {Promise<import('./runAgent.js').RunnerResult>}
 */
export function runOpenCode({
  prompt,
  signal,
  timeoutMs,
  workspaceDir = DEFAULT_WORKSPACE_DIR,
  composeFile = DEFAULT_COMPOSE_FILE,
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  dockerBin = DEFAULT_DOCKER_BIN,
  exec = null,
  reapContainer = true,
} = {}) {
  if (!prompt) throw new Error('runOpenCode: prompt required');

  return new Promise((resolve) => {
    const runId = randomUUID();
    const containerName = `oc-run-${runId}`;
    const runStartedMs = Date.now();

    // Combine the caller's signal with our own hard ceiling. Mirrors runClaw:
    // the internal timer must be able to fire independently, because the #009
    // silent hangs emit no exit code — without our own ceiling a hung run never
    // settles. AbortSignal.any so either source trips the same abort path.
    const inputs = [];
    if (signal) inputs.push(signal);
    if (typeof timeoutMs === 'number' && timeoutMs > 0) inputs.push(AbortSignal.timeout(timeoutMs));
    const combinedSignal = inputs.length === 0 ? undefined
                         : inputs.length === 1 ? inputs[0]
                         : AbortSignal.any(inputs);

    const { file, args } = exec
      ?? dockerComposeArgv({ composeFile, containerName, prompt, dockerBin });

    // NB: we deliberately do NOT pass `signal` to spawn. Killing the attached
    // `docker compose run` CLI does not reap the run container; we reap it
    // explicitly via `docker rm -f` in onAbort below, after which the CLI exits.
    const child = spawn(file, args, {
      cwd: path.dirname(Array.isArray(composeFile) ? composeFile[0] : composeFile),
      env: { ...process.env, WORKSPACE: workspaceDir, OPENCODE_RUN_ID: runId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });

    let abortHandled = false;
    const onAbort = () => {
      if (abortHandled) return;
      abortHandled = true;
      // Hard kill. `docker rm -f` force-removes (SIGKILL) the run container —
      // the only thing that terminates a silent hang. Bounded + best-effort so
      // a wedged daemon can't hang the reap; fall through to child.kill either
      // way (covers the fake-exec path and a container that never came up).
      if (reapContainer) {
        try { spawnSync(dockerBin, ['rm', '-f', containerName], { timeout: DOCKER_RM_TIMEOUT_MS }); }
        catch { /* fall through to child.kill */ }
      }
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    if (combinedSignal) {
      if (combinedSignal.aborted) onAbort();
      else combinedSignal.addEventListener('abort', onAbort, { once: true });
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (combinedSignal) combinedSignal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.on('error', (err) => {
      // spawn-level failure (e.g. docker binary missing). Not a hang and not a
      // clean exit — surface as a harness error result (code null) rather than
      // rejecting, so runAgent's diagnostics still flush a row.
      const runFinishedMs = Date.now();
      const runDir = writeSidecar({
        runtimeRoot, runId, runStartedMs, runFinishedMs,
        code: null, timeout: false, timeoutMs,
        spawnError: String(err?.message ?? err),
      });
      finish({
        code: null,
        signal: null,
        stdout,
        stderr: stderr + `\n[runOpenCode] spawn error: ${err?.message ?? err}`,
        elapsedMs: runFinishedMs - runStartedMs,
        runDir,
        runId,
        terminal_status: 'harness_error',
      });
    });

    child.on('close', (code, killSig) => {
      const runFinishedMs = Date.now();
      const elapsedMs = runFinishedMs - runStartedMs;
      const aborted = !!combinedSignal?.aborted;

      const runDir = writeSidecar({
        runtimeRoot, runId, runStartedMs, runFinishedMs,
        code: aborted ? null : code, timeout: aborted, timeoutMs,
      });

      // Timeout/abort RESOLVES (never rejects) — the load-bearing #009 contract.
      // code:null + terminal_status:'timeout' so any `assert.equal(code, 0)` in
      // a test body still fails the cell cleanly while the reporter's flush runs.
      if (aborted) {
        finish({
          code: null, signal: null, stdout, stderr, elapsedMs,
          runDir, runId, terminal_status: 'timeout', timeout: true,
        });
        return;
      }
      finish({ code, signal: killSig, stdout, stderr, elapsedMs, runDir, runId });
    });
  });
}

/**
 * Write the per-run sidecar (run_summary.json + empty iterations.jsonl) and
 * return its directory. Outcome-only: enough for lib/run_row.js + the registry
 * reporter to assemble a row (run_id, test_id, timestamps, terminal_status,
 * exit_code, iters_count=0). Best-effort, mirroring claw.js — never throws; on a
 * write hiccup the path is still returned and runAgent's runDir guard / the
 * expected-attempts diff catch the missing sidecar.
 */
function writeSidecar({ runtimeRoot, runId, runStartedMs, runFinishedMs, code, timeout, timeoutMs, spawnError = null }) {
  const runDir = path.join(runtimeRoot, runId);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    // No transcript adapter yet (#021): zero iterations. run_row.js tolerates an
    // empty iterations.jsonl (iters_count = 0).
    fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');

    const terminal_status = timeout ? 'timeout'
      : spawnError ? 'harness_error'
      : (code === 0 ? 'done' : 'error');

    const summary = {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      // Set by runAgent for the duration of the runner call (process-wide env);
      // null on a standalone invocation. Mirrors claw.js's buildRunSummary.
      test_id: process.env.ITER_DIST_TEST_ID ?? null,
      git_sha: process.env.GIT_SHA ?? null,
      hardware_instance: process.env.HARDWARE_INSTANCE ?? 'M5',
      concurrency: 1,
      timeout_ms: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : null,
      run_started_ms: runStartedMs,
      run_finished_ms: runFinishedMs,
      run_elapsed_ms: runFinishedMs - runStartedMs,
      iter_count: 0,
      terminal_status,
      // Pass is decided centrally by the workspace oracle (#001), never here.
      passed: null,
      timeout: !!timeout,
      // Telemetry only — coarse and absent on hangs (#009).
      exit_code: code,
      spawn_error: spawnError,
      censored: !!timeout,
      // Marker that iteration/token telemetry is intentionally absent (#021).
      telemetry: 'outcome_only',
    };
    fs.writeFileSync(path.join(runDir, 'run_summary.json'), JSON.stringify(summary, null, 2) + '\n');
  } catch (e) {
    console.error(`[runOpenCode] sidecar write failed for ${runId}: ${e.message}`);
  }
  return runDir;
}
