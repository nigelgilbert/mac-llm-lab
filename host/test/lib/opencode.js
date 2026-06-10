// Drive the OpenCode container one-shot and capture an outcome-only
// RunnerResult — THE runner since the claw stack's retirement (#008/#010). It is
// the `runner` for runAgent (lib/runAgent.js): the `{ prompt, signal, timeoutMs }`
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
// Transcript adapter (#021): on a real run, the agent container's OpenCode
// session is captured by BIND-MOUNTING its SQLite data dir
// (/root/.local/share/opencode) to a per-run host dir, so the DB survives
// `docker compose run --rm` (which would otherwise destroy it — #020 §1.1). After
// the run closes we normalize that DB into schema-v1 iteration records + an
// enriched run_summary (lib/opencode_transcript.js). A wedged/killed run leaves a
// partial/absent DB (#020 §6): normalization returns null and we DEGRADE to the
// outcome-only sidecar below — same shape as the claw timeout path, never a hang.
//
// #022 server-timings wiring (deferred from #010 by design — the ordinal join had
// no iteration records to attach to until this ticket): when
// OPENCODE_SERVER_TIMINGS=1, we bracket the `opencode run` spawn with the
// llama-server log cursor (open/closeServerLogCursor), then join the captured
// prompt/decode split onto the iteration records and write server.timings.jsonl.
// A no-op when the flag is off.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenCodeArtifacts } from './opencode_transcript.js';
import {
  serverTimingsEnabled,
  defaultServerLogPath,
  openServerLogCursor,
  closeServerLogCursor,
  captureServerTimings,
} from './opencode_server_timings.js';

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

// Where OpenCode persists its SQLite session inside the container. XDG_DATA_HOME
// is unset there and it runs as root, so $HOME/.local/share/opencode resolves
// here (#020 §1.1). We bind-mount a per-run host dir onto this path so the DB
// (opencode.db + -wal/-shm) lands on the host and survives `run --rm`.
const CONTAINER_OPENCODE_DATA_DIR = '/root/.local/share/opencode';
const HOST_DATA_SUBDIR = 'opencode-data';

// Opt-out escape hatch (mirrors claw's ITER_DIST_DISABLED): skip DB capture +
// normalization and fall back to the outcome-only sidecar. The bind mount is
// also skipped, so a field issue with it can't wedge a sweep.
const TRANSCRIPT_DISABLED = process.env.OPENCODE_TRANSCRIPT_DISABLED === '1';

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
 * @param {{hostPath: string, containerPath: string}} [o.dataMount]  #021: an extra
 *   `-v host:container` bind mount so OpenCode's SQLite data dir lands on the host
 *   and survives `--rm`. Omitted → no mount (the pre-#021 argv, kept for the unit
 *   tests' exec-free contract).
 * @returns {{ file: string, args: string[] }}
 */
export function dockerComposeArgv({ composeFile, containerName, prompt, dockerBin = DEFAULT_DOCKER_BIN, dataMount = null }) {
  const files = Array.isArray(composeFile) ? composeFile : [composeFile];
  const fileFlags = files.flatMap((f) => ['-f', f]);
  // `-v` is a `run` option, so it must precede the SERVICE name.
  const mountFlags = dataMount
    ? ['-v', `${dataMount.hostPath}:${dataMount.containerPath}`]
    : [];
  return {
    file: dockerBin,
    args: [
      'compose', ...fileFlags,
      // --rm: clean up the container on graceful exit. -T: no TTY (headless).
      // --name: deterministic name so the timeout reap can `docker rm -f` it.
      'run', '--rm', '-T', '--name', containerName, ...mountFlags,
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

    // #021: on the real docker path, bind-mount a per-run host dir onto the
    // container's OpenCode data dir so its SQLite DB survives `--rm`. The `exec`
    // test seam has no real container/DB, so it skips capture and the run falls
    // through to the outcome-only sidecar (the pre-#021 behavior the contract
    // tests pin). `mkdir` up-front so docker bind-mounts an existing source.
    const runDir = path.join(runtimeRoot, runId);
    const captureTranscript = !exec && !TRANSCRIPT_DISABLED;
    const dataDir = captureTranscript ? path.join(runDir, HOST_DATA_SUBDIR) : null;
    if (dataDir) {
      try { fs.mkdirSync(dataDir, { recursive: true }); }
      catch (e) { console.error(`[runOpenCode] could not create data dir ${dataDir}: ${e.message}`); }
    }

    // #022 server-timings (opt-in): bracket the spawn with the llama-server log
    // cursor. open() now, close() at run-finish; the slice between offsets is
    // exactly this run's requests (one server, one client → ordinal pairing).
    const timingsEnabled = serverTimingsEnabled();
    const timingsCursor = (timingsEnabled && captureTranscript)
      ? openServerLogCursor(defaultServerLogPath(process.env.TIER ?? '64'))
      : null;

    // Combine the caller's signal with our own hard ceiling: the internal
    // timer must be able to fire independently, because the #009
    // silent hangs emit no exit code — without our own ceiling a hung run never
    // settles. AbortSignal.any so either source trips the same abort path.
    const inputs = [];
    if (signal) inputs.push(signal);
    if (typeof timeoutMs === 'number' && timeoutMs > 0) inputs.push(AbortSignal.timeout(timeoutMs));
    const combinedSignal = inputs.length === 0 ? undefined
                         : inputs.length === 1 ? inputs[0]
                         : AbortSignal.any(inputs);

    const { file, args } = exec
      ?? dockerComposeArgv({
        composeFile, containerName, prompt, dockerBin,
        dataMount: dataDir
          ? { hostPath: dataDir, containerPath: CONTAINER_OPENCODE_DATA_DIR }
          : null,
      });

    // NB: we deliberately do NOT pass `signal` to spawn. Killing the attached
    // `docker compose run` CLI does not reap the run container; we reap it
    // explicitly via `docker rm -f` in onAbort below, after which the CLI exits.
    // The `exec` seam has no compose file behind it, so it must not derive a
    // cwd from one — the default compose dir does not exist in the baked test
    // image (no repo mount) and a missing cwd ENOENTs the spawn.
    const child = spawn(file, args, {
      cwd: exec ? process.cwd()
                : path.dirname(Array.isArray(composeFile) ? composeFile[0] : composeFile),
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
      // rejecting, so runAgent's diagnostics still flush a row. No run happened →
      // no DB to normalize; outcome-only sidecar.
      const runFinishedMs = Date.now();
      writeSidecar({
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
        iterCount: 0,
      });
    });

    child.on('close', (code, killSig) => {
      const runFinishedMs = Date.now();
      const elapsedMs = runFinishedMs - runStartedMs;
      const aborted = !!combinedSignal?.aborted;

      // #022: close the log cursor and capture this run's slice of the server's
      // prompt/decode timing blocks (empty array when the flag is off).
      const closedCursor = timingsCursor ? closeServerLogCursor(timingsCursor) : null;
      const serverTimings = closedCursor ? captureServerTimings(closedCursor) : [];

      // #021: normalize the bind-mounted DB into schema-v1 iteration records +
      // run_summary (and, when timings were captured, join + write
      // server.timings.jsonl). Best-effort: a wedged/killed run leaves a
      // partial/absent DB (#020 §6), so on null/throw we DEGRADE to the
      // outcome-only sidecar below — the claw timeout-path analog, never a hang.
      let meta = null;
      if (dataDir) {
        try {
          meta = buildOpenCodeArtifacts({
            dbPath: path.join(dataDir, 'opencode.db'),
            runDir, runId, runStartedMs, runFinishedMs,
            code: aborted ? null : code, timeout: aborted, timeoutMs,
            serverTimings, serverTimingsEnabled: timingsEnabled,
          });
        } catch (e) {
          console.error(`[runOpenCode] transcript normalize failed for ${runId}: ${e.stack || e.message}`);
          meta = null;
        }
      }

      // No usable transcript (exec seam, opt-out, or absent/partial DB) → write
      // the outcome-only sidecar so run_row.js still gets a row (iters_count=0).
      if (!meta) {
        writeSidecar({
          runtimeRoot, runId, runStartedMs, runFinishedMs,
          code: aborted ? null : code, timeout: aborted, timeoutMs,
        });
      }

      const extra = meta
        ? {
            iterationsPath: meta.iterationsPath,
            runSummaryPath: meta.runSummaryPath,
            serverTimingsPath: meta.serverTimingsPath,
            iterCount: meta.iterCount,
            joinStatus: meta.joinStatus,
          }
        : { iterCount: 0 };

      // Timeout/abort RESOLVES (never rejects) — the load-bearing #009 contract.
      // code:null + terminal_status:'timeout' so any `assert.equal(code, 0)` in
      // a test body still fails the cell cleanly while the reporter's flush runs.
      if (aborted) {
        finish({
          code: null, signal: null, stdout, stderr, elapsedMs,
          runDir, runId, terminal_status: 'timeout', timeout: true, ...extra,
        });
        return;
      }
      finish({ code, signal: killSig, stdout, stderr, elapsedMs, runDir, runId, ...extra });
    });
  });
}

/**
 * Write the per-run sidecar (run_summary.json + empty iterations.jsonl) and
 * return its directory. Outcome-only: enough for lib/run_row.js + the registry
 * reporter to assemble a row (run_id, test_id, timestamps, terminal_status,
 * exit_code, iters_count=0). Best-effort — never throws; on a
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
      // null on a standalone invocation (schema-v1 run_summary convention).
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
