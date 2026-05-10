// Prelude + postlude for tier-eval Family A/B tests.
//
// Family A/B tier-eval tests share a fixed prelude (workspace reset →
// seed-write → optional pre-condition → runner → log header) and a fixed
// postlude (writeAssertionResult → timeout-guard → declarative asserts).
// The middle — *when* the post-script runs and *what* extra checks the test
// makes — genuinely varies. This helper owns prelude + postlude only;
// per-test JS lives between them.
//
// Past postlude changes (registry payload schema, timeout-guard semantics)
// touched every tier-eval test. Centralising the postlude here is the
// property to preserve so the next such change is a one-file edit.
//
// Family A (fix-and-rerun) and Family B (create-and-verify) both fit. Family
// C (`prose-quality`, `latency`, `tool-discipline` — streamMessage-only, no
// registry row) is intentionally out of scope.
//
// Usage:
//   const ctx = await runAgentSetup({ prompt, seedFiles, postScript: 'verify.js', ... });
//   await ctx.finish(() => {
//     ctx.workspace.unchanged('verify.js', VERIFY_JS);
//   });
//
// postScript is optional. When set, the helper runs `node <postScript>` after
// the agent and populates ctx.post. When omitted, ctx.post stays null.
//
// finish() auto-asserts agent.code === 0 and (when postScript was set)
// post.status === 0. The callback is for per-test invariants only and
// runs *between* those two checks — after the agent-exit assert, before
// the post.status assert — so workspace-shape errors surface ahead of
// the post-script's stderr tail.
//
// RunnerResult contract — any injected `runner` must resolve with:
//   {
//     code:              number | null,    // null on timeout
//     stdout:            string,
//     stderr:            string,
//     elapsedMs:         number,
//     terminal_status?:  'timeout' | undefined,
//     runDir:            string,           // for writeAssertionResult sidecar
//     // …additional telemetry fields are passed through unchanged.
//   }
// Default runner = runClaw + clawModel. Pass a custom `runner` to evaluate a
// different agent (Aider/Codex/etc.) under the same harness — field names on
// the helper API use `agent*` for harness-agnosticism. The on-disk registry
// payload still uses `claw_exit` to avoid a registry-side breaking change.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { runClaw, writeAssertionResult } from './claw.js';
import * as workspace from './workspace.js';
import { clawModel, TIER_LABEL } from './tier.js';

const DEFAULT_AGENT_TIMEOUT_MS        = 240_000;
const DEFAULT_POST_SCRIPT_TIMEOUT_MS  = 5_000;
const DEFAULT_PRECONDITION_TIMEOUT_MS = 5_000;
const AGENT_STDERR_TAIL = 1_500;
const POST_STDERR_TAIL = 800;

/**
 * @typedef {Object} RunnerResult
 * @property {number|null} code              Agent process exit code; null on timeout.
 * @property {string}      stdout
 * @property {string}      stderr
 * @property {number}      elapsedMs
 * @property {string}      runDir            Directory used for the writeAssertionResult sidecar.
 * @property {'timeout'=}  terminal_status   Set to 'timeout' when the runner aborted on timeoutMs.
 */

/**
 * @typedef {import('node:child_process').SpawnSyncReturns<string>} PostResult
 */

/**
 * @typedef {(opts: { prompt: string, timeoutMs: number }) => Promise<RunnerResult>} Runner
 */

/**
 * @typedef {Object} AssertionPayload
 * @property {boolean}     passed
 * @property {number|null} claw_exit
 * @property {number|null} post_status
 * @property {string|null} post_stderr_tail
 */

/**
 * @typedef {Object} AgentCtx
 * @property {RunnerResult}            agent       Result record from the agent runner.
 * @property {typeof workspace}        workspace   Workspace module (read/exists/list/reset/WORKSPACE/unchanged).
 * @property {PostResult|null}         post        Post-script result; null when postScript was not set.
 * @property {(asserts?: () => void) => Promise<void>} finish
 *           Finalize the run and write the registry payload. Order of checks:
 *           agent exited cleanly → asserts() callback → (if postScript) post exited cleanly.
 *           The callback runs against the post-agent workspace; it must not depend on post-script side effects.
 */

/**
 * Prelude + postlude for tier-eval Family A/B tests. Resets the workspace,
 * seeds files, optionally runs a pre-condition script that must fail, runs
 * the agent, optionally runs a post-script, and returns a ctx whose
 * `finish()` writes the registry assertion payload.
 *
 * @param {Object}   opts
 * @param {string}   opts.prompt                  Required. Prompt to pass to the agent runner.
 * @param {Object<string, string>} [opts.seedFiles={}]   Map of filename to file contents to write into the workspace before the agent runs.
 * @param {string|null} [opts.preconditionMustFail=null] Filename of a script that must exit non-zero *before* the agent runs (asserts the test is well-posed). Family A pattern.
 * @param {string|null} [opts.postScript=null]    Filename of a script to run *after* the agent. Result populates ctx.post. Optional — when omitted ctx.post stays null.
 * @param {number}   [opts.preconditionTimeoutMs=5000] Per-test override for the precondition-script timeout. Preconditions are sanity checks and should be fast; raise only if a test legitimately needs more.
 * @param {number}   [opts.postScriptTimeoutMs=5000] Per-test override for the post-script timeout. Default fits cheap verify scripts; raise it for genuinely-expensive verifies.
 * @param {number}   [opts.timeoutMs=240000]      Agent run timeout. Forwarded to the runner; surfaced as terminal_status='timeout' on the RunnerResult.
 * @param {string}   opts.testLabel               Required. Used in the run log header.
 * @param {Runner}   [opts.runner=defaultRunner]  Inject a non-claw agent runner (Aider/Codex/etc.) under the same harness.
 * @returns {Promise<AgentCtx>}
 */
export async function runAgentSetup({
  prompt,
  seedFiles = {},
  preconditionMustFail = null,
  preconditionTimeoutMs = DEFAULT_PRECONDITION_TIMEOUT_MS,
  postScript = null,
  postScriptTimeoutMs = DEFAULT_POST_SCRIPT_TIMEOUT_MS,
  timeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
  testLabel,
  runner = defaultRunner,
}) {
  if (!prompt) throw new Error('runAgentSetup: prompt required');
  if (!testLabel) throw new Error('runAgentSetup: testLabel required');

  workspace.reset();
  for (const [name, body] of Object.entries(seedFiles)) {
    fs.writeFileSync(path.join(workspace.WORKSPACE, name), body);
  }

  if (preconditionMustFail) {
    const pre = spawnSync('node', [path.join(workspace.WORKSPACE, preconditionMustFail)], {
      encoding: 'utf8',
      timeout:  preconditionTimeoutMs,
    });
    assert.notEqual(
      pre.status, 0,
      `pre-condition: ${preconditionMustFail} must fail before the fix`,
    );
  }

  const agent = await runner({ prompt, timeoutMs });

  console.log(`\n=== ${testLabel} (${TIER_LABEL}) ===`);
  console.log(`  agent: exit=${agent.code} elapsed=${agent.elapsedMs}ms files=${JSON.stringify(workspace.list())}`);
  if (agent.code !== 0) console.log(`  agent stderr (tail):\n${agent.stderr.slice(-AGENT_STDERR_TAIL)}`);

  let post = null;
  if (postScript) {
    post = spawnSync('node', [path.join(workspace.WORKSPACE, postScript)], {
      encoding: 'utf8',
      timeout:  postScriptTimeoutMs,
      cwd:      workspace.WORKSPACE,
    });
    console.log(`  node post: ${postScript} exit=${post.status} stderr=${post.stderr.slice(0, 400).trim()}`);
  }

  // `passed` is derived from "did anything throw inside the try block." All
  // checks — auto-asserts and per-test invariants — live in one block, so
  // there is no out-of-band place to put a check that escapes the registry
  // payload.
  async function finish(asserts = () => {}) {
    let thrown = null;
    try {
      if (agent.terminal_status === 'timeout') {
        assert.fail(`agent timed out after ${agent.elapsedMs}ms (terminal_status=timeout)`);
      }
      // Auto-assert the always-checks. Symmetric with preconditionMustFail
      // (which asserts a script fails before the agent runs); these assert
      // the agent exited cleanly and, when a postScript was set, that it
      // also exited zero. The callback is for per-test invariants only.
      //
      // Order: agent.code (system-level — workspace state is undefined past
      // a crash, so don't run user asserts on a corpse) → user asserts
      // (test-specific intent, typically more readable than the post-script's
      // stderr tail) → post.status (catch-all when nothing more specific fired).
      assert.equal(agent.code, 0, 'agent must exit cleanly');
      asserts();
      if (postScript) {
        assert.equal(
          post.status, 0,
          `post-script (${postScript}) failed:\n${post.stderr.slice(0, POST_STDERR_TAIL)}`,
        );
      }
    } catch (e) {
      thrown = e;
    }

    const payload = {
      passed:            thrown === null,
      claw_exit:         agent.code,
      post_status:       post ? post.status : null,
      post_stderr_tail:  post ? post.stderr.slice(0, POST_STDERR_TAIL) : null,
    };
    writeAssertionResult(agent.runDir, payload);

    if (thrown) throw thrown;
  }

  return {
    agent,
    workspace,
    finish,
    get post() { return post; },
  };
}

function defaultRunner({ prompt, timeoutMs }) {
  return runClaw({ prompt, model: clawModel, timeoutMs });
}
