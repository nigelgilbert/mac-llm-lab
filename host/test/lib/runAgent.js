// Prelude + agent + post-script for tier-eval Family A/B tests.
//
// Successor to runAgentSetup. Same prelude (workspace.reset → seedFiles →
// optional preconditionMustFail → runner → optional postScript), but the
// finalization shape is different:
//   - No finish() callback. Asserts live in the test body.
//   - Cancellation is signal-based (forwarded to the runner). The harness no
//     longer manages a setTimeout/AbortController.
//   - The registry sidecar (assertion_result.json) is written by the
//     registry reporter, not here. runAgent emits diagnostics carrying the
//     data the reporter needs.
//
// Test-body shape:
//   it(name, { timeout }, async (t) => {
//     const ctx = await runAgent({ ...SETUP, t });
//     // per-test invariants only (e.g. ctx.workspace.unchanged(...)).
//   });
//
// Pass oracle (issue #001): runAgent decides pass ONCE, centrally — the
// `/workspace` post-script exiting 0 (`post.status === 0`), config-agnostic so
// it means the same thing under any runner arm. The agent exit code is NOT a
// pass gate (it would false-fail a run which fixed the workspace but returned
// a noisy code); it survives only as telemetry plus a
// `crashed_before_finishing` diagnostic. Test bodies therefore no longer assert
// `agent.code`/`post.status`; they keep just their per-test invariants. See
// host/test/docs/OPENCODE-HARNESS-AB-PLAN.md §0b.
//
// runAgent receives the TestContext directly because t.diagnostic uses private
// instance fields — destructuring (`{ diagnostic } = t`) loses the `this`
// binding and throws on call. Cleaner to take `t` and let runAgent invoke
// `t.diagnostic(…)` and read `t.signal` inline.
//
// Concurrency assumption: serial execution within the test process. Two
// things would race if violated: workspace.reset() wipes /workspace globally,
// and ITER_DIST_TEST_ID is a process-wide env var that's mutated for the
// duration of each call (restored in a finally on the way out, but two
// overlapping calls would still clobber each other mid-run).
// Today the package.json `test` script pins --test-concurrency=1 and
// node:test's default isolation (Node 22+) runs each file in its own
// subprocess; don't lower either without auditing this file. Multiple
// `it(...)` blocks per file are fine because node:test runs them sequentially
// within a describe — but `t.test(..., { concurrent: true })` would break it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { runOpenCode } from './opencode.js';
import * as workspace from './workspace.js';
import { resolveConfigId, isOpenCodeConfig } from './config.js';

const DEFAULT_POST_SCRIPT_TIMEOUT_MS  = 5_000;
const DEFAULT_PRECONDITION_TIMEOUT_MS = 5_000;
const AGENT_STDERR_TAIL = 1_500;
const POST_STDERR_TAIL  = 800;

// Buffer between the runner's internal timer expiring and node:test's outer
// {timeout} firing. Covers diagnostic flush (workspace.list + JSON.stringify),
// reporter event propagation, and GC/OS jitter — i.e. everything that happens
// after the runner returns *except* the post-script, which gets its own
// budget. Total slack used is FLUSH_MARGIN_MS + preconditionTimeoutMs +
// postScriptTimeoutMs (when present), computed per-call.
const FLUSH_MARGIN_MS = Number(process.env.RUNAGENT_FLUSH_MARGIN_MS) || 3_000;

// At-most-once per TestContext (= per `it(...)` block). A second call would
// `workspace.reset()` and spawn a second agent before the reporter could
// flush the first call's sidecar; we'd rather fail fast at the offending
// callsite than silently clobber. WeakSet so entries collect with the test.
const seenContexts = new WeakSet();

/**
 * @typedef {Object} RunnerResult
 * @property {number|null} code              Agent process exit code; null on timeout.
 * @property {string}      stdout
 * @property {string}      stderr
 * @property {number}      elapsedMs
 * @property {string}      runDir            Sidecar directory.
 * @property {'timeout'|'interrupted'|'harness_error'=} terminal_status  Absent
 *   on a normal exit. 'timeout' = the runner's internal hard ceiling fired;
 *   'interrupted' = the CALLER's signal aborted (runAgent cancellation /
 *   Ctrl-C — #001; excluded from pass-rate denominators by
 *   paired_bootstrap.isEligible); 'harness_error' = spawn-level failure
 *   (no run happened).
 */

/** @typedef {import('node:child_process').SpawnSyncReturns<string>} PostResult */
/** @typedef {(opts: { prompt: string, signal: AbortSignal, timeoutMs?: number }) => Promise<RunnerResult>} Runner */

/**
 * @typedef {Object} AgentCtx
 * @property {RunnerResult}        agent
 * @property {typeof workspace}    workspace
 * @property {PostResult|null}     post
 */

/**
 * @param {Object} opts
 * @param {string} opts.prompt
 * @param {Object<string,string>} [opts.seedFiles={}]
 * @param {string|null}           [opts.preconditionMustFail=null]
 * @param {number}                [opts.preconditionTimeoutMs]  Defaults to DEFAULT_PRECONDITION_TIMEOUT_MS.
 * @param {string|null}           [opts.postScript=null]
 * @param {number}                [opts.postScriptTimeoutMs]    Defaults to DEFAULT_POST_SCRIPT_TIMEOUT_MS.
 * @param {number}                [opts.clawTimeoutMs]  Set equal to the test's
 *   `{timeout}`. runAgent subtracts slack (precondition + post + FLUSH_MARGIN_MS)
 *   and passes the remainder to the runner. Throws if too small for the slack.
 *   (Name is historical — the 32-task panel sets it on every call, so it is
 *   kept verbatim to leave the panel byte-identical.)
 * @param {string}                opts.testId
 * @param {Runner}                [opts.runner=defaultRunner]
 * @param {import('node:test').TestContext} opts.t  node:test context; runAgent
 *   reads `t.signal` for cancellation and calls `t.diagnostic(…)` to publish
 *   data the registry reporter needs.
 * @returns {Promise<AgentCtx>}
 */
export async function runAgent({
  prompt,
  seedFiles = {},
  preconditionMustFail = null,
  preconditionTimeoutMs = DEFAULT_PRECONDITION_TIMEOUT_MS,
  postScript = null,
  postScriptTimeoutMs = DEFAULT_POST_SCRIPT_TIMEOUT_MS,
  clawTimeoutMs,
  testId,
  runner = defaultRunner,
  t,
}) {
  if (!prompt)                  throw new Error('runAgent: prompt required');
  if (!testId)                  throw new Error('runAgent: testId required');
  if (!t || typeof t.diagnostic !== 'function' || !t.signal) {
    throw new Error('runAgent: pass the TestContext (`t`); destructuring t.diagnostic loses its binding');
  }
  if (seenContexts.has(t)) {
    throw new Error('runAgent: at most one call per `it(...)` block; second call detected with the same TestContext');
  }
  seenContexts.add(t);
  const signal = t.signal;

  const slackMs = (preconditionMustFail ? preconditionTimeoutMs : 0)
                + (postScript          ? postScriptTimeoutMs    : 0)
                + FLUSH_MARGIN_MS;
  if (typeof clawTimeoutMs !== 'number' || clawTimeoutMs <= slackMs) {
    throw new Error(
      `runAgent: clawTimeoutMs (${clawTimeoutMs}ms) must exceed slack (${slackMs}ms = ` +
      `precondition ${preconditionMustFail ? preconditionTimeoutMs : 0} + ` +
      `post ${postScript ? postScriptTimeoutMs : 0} + flush ${FLUSH_MARGIN_MS}). ` +
      `Set the test's {timeout} and clawTimeoutMs to the same value; runAgent owns the slack.`,
    );
  }
  const runnerTimeoutMs = clawTimeoutMs - slackMs;

  // Sprint 1.22 originally guarded RUN_REGISTRY_EMIT=1 against a missing
  // registry-reporter via globalThis.__registryReporterLoaded — but node:test
  // runs each test file under --test-isolation=process and custom reporters
  // run in the parent's context, so a global set by the reporter is invisible
  // here. The backstop is the driver's row audit (#003): run-config-ab.sh
  // writes the expected-attempts plan (TASKS × REPEATS × ARMS) before its
  // arms phase and diffs the fresh registry rows after the gate, so a sweep
  // with the reporter accidentally unwired produces zero rows and the audit
  // names every cell missing (driver exit 2).

  // run_summary.json's test_id field is populated from this env var when the
  // runner writes its run sidecar. Reporter doesn't read it; it's for the
  // downstream registry-row joiner. Captured-and-restored in the finally
  // so a same-file caller that invokes a runner directly after a runAgent
  // call doesn't inherit a stale test_id.
  const priorTestIdEnv = process.env.ITER_DIST_TEST_ID;
  process.env.ITER_DIST_TEST_ID = testId;

  try {
    workspace.reset();
    for (const [name, body] of Object.entries(seedFiles)) {
      fs.writeFileSync(path.join(workspace.WORKSPACE, name), body);
    }

    // Sidecar-port arms (OPENCODE-SIDECAR-PORT-HANDOFF.md §4): git-initialize
    // the workspace AFTER the seed write (so the plant survives reset()) and
    // BEFORE the runner sees it. Done for ALL these arms so any +prompt*-vs-
    // +git comparison isolates the prompt effect from the git-init confound.
    // The prompt-halves arms (OPENCODE-PROMPT-HALVES-PREREG.md §2, T11) plant
    // their pinned HALF artifact instead of the full system-prompt.md; the
    // arm → planted-artifact routing lives in AGENTS_MD_SOURCE_BY_CONFIG.
    {
      const configId = resolveConfigId();
      if (configId === 'opencode-a+git' || configId in AGENTS_MD_SOURCE_BY_CONFIG) {
        seedWorkspaceGit({ configId, agentsMdPath: AGENTS_MD_SOURCE_BY_CONFIG[configId] ?? null });
      }
    }

    if (preconditionMustFail) {
      const pre = spawnSync('node', [path.join(workspace.WORKSPACE, preconditionMustFail)], {
        encoding: 'utf8',
        timeout:  preconditionTimeoutMs,
      });
      // #024: spawnSync's spawn-level failure shape is {error, status:null} —
      // which would PASS the bare `status !== 0` gate below, letting a broken
      // precondition setup (interpreter missing, timeout kill) masquerade as
      // "fails before the fix". Abort as a harness error first: the script
      // must have actually RUN and failed for the gate to mean anything.
      assert.ok(
        pre.error == null && pre.status !== null,
        `runAgent harness error: pre-condition ${preconditionMustFail} did not run ` +
        `(spawn-level failure or timeout kill: status=${pre.status}` +
        `${pre.signal ? `, signal=${pre.signal}` : ''}` +
        `${pre.error ? `, error=${pre.error.message}` : ''}) — ` +
        'a precondition that never executed must not satisfy the must-fail gate',
      );
      assert.notEqual(
        pre.status, 0,
        `pre-condition: ${preconditionMustFail} must fail before the fix`,
      );
    }

    const agent = await runner({ prompt, signal, timeoutMs: runnerTimeoutMs });
    if (typeof agent.runDir === 'string' && agent.runDir.length > 0) {
      t.diagnostic(`runDir=${agent.runDir}`);
    } else {
      // Telemetry hiccup left runDir unset (the runner's sidecar collection is
      // best-effort by design). Skip the diagnostic so the reporter doesn't
      // write a sidecar under the literal path "undefined". The driver's
      // post-gate expected-attempts audit (#003, run-config-ab.sh) names the
      // resulting missing registry row and fails the sweep.
      console.error(`[runAgent] no runDir from runner for testId=${testId}; sidecar will not be written`);
    }
    t.diagnostic(`test_id=${testId}`);
    t.diagnostic(`agent_result=${JSON.stringify({
      code:       agent.code,
      elapsedMs:  agent.elapsedMs,
      files:      workspace.list(),
      stderrTail: agent.code !== 0 ? agent.stderr.slice(-AGENT_STDERR_TAIL) : undefined,
    })}`);

    let post = null;
    let postSpawnFailure = null;
    if (postScript) {
      post = spawnSync('node', [path.join(workspace.WORKSPACE, postScript)], {
        encoding: 'utf8',
        timeout:  postScriptTimeoutMs,
        cwd:      workspace.WORKSPACE,
      });
      // #024: spawnSync's spawn-level failure shape is {error, status:null,
      // stdout:null, stderr:null} (a timeout kill is {error:ETIMEDOUT,
      // status:null} with captured streams). The oracle never rendered a
      // verdict, so this is a HARNESS error, not a model fail — and the null
      // streams must not TypeError before the diagnostic/sentinel flush.
      const postStderr = post.stderr ?? '';
      if (post.error != null || post.status === null) {
        postSpawnFailure = `status=${post.status}`
          + `${post.signal ? `, signal=${post.signal}` : ''}`
          + `${post.error ? `, error=${post.error.message}` : ''}`;
      }
      t.diagnostic(`post_result=${JSON.stringify({
        script:     postScript,
        status:     post.status,
        stderrTrim: postStderr.slice(0, 400),
        stderrTail: postStderr.slice(-POST_STDERR_TAIL),
        ...(postSpawnFailure ? { spawn_error: postSpawnFailure } : {}),
      })}`);
    }

    // Agent exit code: telemetry, NOT a pass gate (issue #001). It already
    // rides in the agent_result diagnostic above (→ sidecar `claw_exit` —
    // historical field name — + `terminal_status`). A non-zero code means the
    // agent crashed before finishing; surface it as a diagnostic, but let the
    // workspace oracle have the final say on pass — `opencode run`'s exit
    // semantics are unconfirmed and could false-fail a correct workspace.
    // (null code = timeout/abort, already carried by terminal_status; not a
    // "crash".)
    if (typeof agent.code === 'number' && agent.code !== 0) {
      t.diagnostic(`crashed_before_finishing=1 agent_code=${agent.code}`);
    }
    // A test with no post-script has no `/workspace` oracle and is not
    // A/B-eligible (issue #001 AC): flag it rather than letting it silently
    // "pass". Emitted before the sentinel so it lands in the same flush.
    if (!post) {
      t.diagnostic('no_workspace_oracle=1');
    }

    // #024: a post-script spawn-level failure means the workspace oracle never
    // ran — relabel the run sidecar so the registry row lands as a typed
    // harness_error (excluded from pass denominators by
    // paired_bootstrap.isEligible) instead of a plain passed:false model
    // failure. Same sidecar-relabel mechanism as the #002 context-overflow
    // patcher; run_row.js reads summary.terminal_status first, and
    // registry_emit.js promotes summary.harness_error onto the row. Emitted
    // before the sentinel so the reporter's flush sees the relabeled sidecar.
    if (postSpawnFailure) {
      t.diagnostic('harness_error=post_script_spawn_failed');
      relabelRunSummaryHarnessError(agent.runDir, 'post_script_spawn_failed', postSpawnFailure);
    }

    // Sentinel for the registry reporter's per-test flush. Emitted BEFORE the
    // pass assertion so the sidecar/registry row is written for fails too (the
    // reporter derives `passed` from node:test's own verdict, and post_result
    // already carries the status). Must be the LAST diagnostic this function
    // emits; the reporter writes the sidecar + deletes the pending entry on
    // receipt. See registry-reporter.js.
    t.diagnostic('runAgent_done=1');

    // Centralized pass oracle (issue #001): pass ⇔ the `/workspace` post-script
    // exited 0. Decided here once rather than re-asserted in each of the ~35
    // test bodies. Throws on failure (the assertion carries no diagnostic, so
    // runAgent_done stays the final diagnostic). When there is no post-script
    // the verdict is left to the body's own per-test invariants.
    //
    // #024: a spawn-level failure throws a DISTINCT harness error before the
    // pass assertion — the oracle never executed, so `post.status !== 0` is
    // not a model verdict (and the sidecar relabel above has already re-typed
    // the row). node:test still marks the test failed, but the registry row
    // reads harness_error/passed:null, not done/passed:false.
    if (post) {
      if (postSpawnFailure) {
        throw new Error(
          `runAgent harness error: post-script ${postScript} did not run ` +
          `(spawn-level failure or timeout kill: ${postSpawnFailure}); ` +
          'run relabeled harness_error=post_script_spawn_failed, not a model failure',
        );
      }
      assert.equal(
        post.status, 0,
        `post-script failed:\n${(post.stderr ?? '').slice(0, 800)}`,
      );
    }

    return { agent, workspace, post };
  } finally {
    // Restore the prior env state. Use `delete` (not `= undefined`) when the
    // var was previously unset, since assignment would coerce to the string
    // "undefined" — collectRunArtifacts would then bake that into run_summary.
    if (priorTestIdEnv === undefined) delete process.env.ITER_DIST_TEST_ID;
    else process.env.ITER_DIST_TEST_ID = priorTestIdEnv;
  }
}

// #024: best-effort relabel of the run sidecar's run_summary.json to a typed
// harness_error. Same mechanism as the #002 context-overflow patcher
// (scripts/patch-context-overflow.mjs): run_row.pickTerminalStatus honors
// summary.terminal_status first, so the registry row assembled from this
// sidecar lands as terminal_status:'harness_error' / passed:null (ineligible
// per paired_bootstrap.isEligible), and registry_emit.js promotes
// summary.harness_error onto the row's harness_error field. Best-effort:
// a relabel failure is logged, and the caller's typed throw still fails the
// test loudly (the row then degrades to an eligible passed:false — visible,
// not silent).
function relabelRunSummaryHarnessError(runDir, harnessError, detail) {
  if (typeof runDir !== 'string' || runDir.length === 0) {
    console.error(`[runAgent] cannot relabel run_summary (no runDir): harness_error=${harnessError} (${detail})`);
    return;
  }
  const p = path.join(runDir, 'run_summary.json');
  try {
    const summary = JSON.parse(fs.readFileSync(p, 'utf8'));
    summary.terminal_status = 'harness_error';
    summary.harness_error = harnessError;
    summary.harness_error_detail = detail;
    summary.passed = null;
    fs.writeFileSync(p, JSON.stringify(summary, null, 2) + '\n');
  } catch (e) {
    console.error(`[runAgent] failed to relabel ${p} as harness_error=${harnessError}: ${e.message}`);
  }
}

// claw's tool-discipline system prompt, planted VERBATIM as AGENTS.md for the
// `opencode-a+prompt` arm (an adapted prompt would be a different, non-comparable
// treatment — handoff §6.4). Resolved relative to this file so it works in both
// the baked test image and the path-matched eval-runner sibling (#009; the repo
// is mounted at its own absolute path there).
const LLAMA_DOCS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../llama-server/docs',
);
const SYSTEM_PROMPT_PATH = path.join(LLAMA_DOCS_DIR, 'system-prompt.md');

// Which committed artifact each prompt-planting arm plants as AGENTS.md.
// `+prompt` plants the full system-prompt.md; the prompt-halves arms
// (OPENCODE-PROMPT-HALVES-PREREG.md §2.2, T11 wiring) plant their pinned
// verbatim line-subset half — h1 = lines 1–7 ("call economy"), h2 = lines
// 1–4 + 8–10 ("output/action discipline"). All resolved the same way, so the
// halves work in every seat the full prompt does. The halves' byte/sha256
// pins are contract-tested (__tests__/lib/prompt-halves.contract.test.js).
const AGENTS_MD_SOURCE_BY_CONFIG = {
  'opencode-a+prompt':    SYSTEM_PROMPT_PATH,
  'opencode-a+prompt-h1': path.join(LLAMA_DOCS_DIR, 'system-prompt.h1.md'),
  'opencode-a+prompt-h2': path.join(LLAMA_DOCS_DIR, 'system-prompt.h2.md'),
};

// Git-initialize /workspace (+ optionally plant AGENTS.md) for the sidecar-port
// arms. OpenCode establishes its "project" via a git root: rules/instructions
// discovery NO-OPS in a bare directory (handoff §2 — verified with a strong-model
// AGENTS.md oracle; bare dir, instructions:[...] config, and a global mount all
// failed; git init+commit injected). The verified-positive mechanism is a full
// init+commit, so that is what we do — a bare `.git` dir is an untested shortcut.
// Every step is FAIL-LOUD: a silent git failure here would re-create the exact
// null-arm FINDING 2 caught (treatment label on rows whose prompt never injected),
// which is worse than no data. The pass oracle is blind to `.git`/`AGENTS.md`
// (it only runs the post-script), so the plant cannot affect pass/fail.
// `agentsMdPath` = the committed artifact to plant verbatim (null for the
// git-init-only control arm). A missing/unreadable artifact throws via
// readFileSync — same fail-loud posture as the git steps.
function seedWorkspaceGit({ configId, agentsMdPath }) {
  const cwd = workspace.WORKSPACE;
  if (agentsMdPath) {
    fs.writeFileSync(
      path.join(cwd, 'AGENTS.md'),
      fs.readFileSync(agentsMdPath, 'utf8'),
    );
  }
  const steps = [
    ['init', '-q'],
    ['add', '-A'],
    ['-c', 'user.email=harness@mac-llm-lab.invalid', '-c', 'user.name=tier-eval-harness',
      'commit', '-q', '--allow-empty', '-m', 'tier-eval workspace seed'],
  ];
  for (const args of steps) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      throw new Error(
        `seedWorkspaceGit: \`git ${args.join(' ')}\` failed in ${cwd} ` +
        `(status=${r.status}${r.error ? `, error=${r.error.message}` : ''}): ` +
        `${(r.stderr || '').slice(0, 400)} — the ${configId} ` +
        'arm REQUIRES a git-rooted workspace (OpenCode rules discovery no-ops without it); ' +
        'in the Phase B runner sibling, `git` must be baked into the eval-runner image ' +
        '(host/test/Dockerfile.runner, #009 — rebuild: cd host/test && docker compose build runner).',
      );
    }
  }
}

// Resolve the active runner from the process-level CONFIG selector (issue #011).
// Exported so the workspace round-trip script and unit tests exercise the SAME
// selection logic defaultRunner uses, rather than a parallel reimplementation.
// Returns a function with the runner call shape ({prompt,signal,timeoutMs}).
//
// opencode runs in a SIBLING container that bind-mounts a HOST dir at
// /workspace. For the harness's reset/seed/post-script (which operate on the
// container path workspace.WORKSPACE = '/workspace') and the agent's writes to
// land in the SAME place, the sibling must mount the host dir that backs THIS
// container's /workspace. That host path is supplied out-of-band by the
// run-config-ab.sh driver as HOST_WORKSPACE; without it the sibling would mount
// a different dir and the oracle would never see the agent's writes, so we fail
// loud rather than silently false-fail every cell. See
// host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md.
//
// `claw-rig` (and an unset CONFIG, which resolves to it) is HISTORICAL-ONLY
// since the claw stack was retired (#008/#010; archived at tag
// `claw-stack-final`): its rows in the preserved registries stay valid and
// readable, but there is no runner behind it anymore — selecting it throws.
export function selectRunner(env = process.env) {
  const configId = resolveConfigId(env);
  if (!isOpenCodeConfig(configId)) {
    throw new Error(
      `CONFIG=${configId} is a historical config_id with no runner: the claw ` +
      'stack was retired (issues #008/#010; archived at git tag claw-stack-final). ' +
      'Set CONFIG to a runnable opencode arm (see OPENCODE_CONFIGS in lib/config.js).',
    );
  }
  const workspaceDir = env.HOST_WORKSPACE;
  if (!workspaceDir) {
    throw new Error(
      `CONFIG=${configId} requires HOST_WORKSPACE — the host path backing the ` +
      "test container's /workspace bind mount (set by the run-config-ab.sh driver). " +
      'Without it the opencode sibling container would mount a different host dir ' +
      'and the workspace oracle would never see the agent\'s writes. See ' +
      'host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md.',
    );
  }
  return ({ prompt, signal, timeoutMs }) =>
    runOpenCode({ prompt, signal, timeoutMs, workspaceDir });
}

// Re-resolves on every invocation so the selector reads the env live (tests
// mutate CONFIG/HOST_WORKSPACE between calls); the resolution is cheap.
function defaultRunner({ prompt, signal, timeoutMs }) {
  return selectRunner()({ prompt, signal, timeoutMs });
}
