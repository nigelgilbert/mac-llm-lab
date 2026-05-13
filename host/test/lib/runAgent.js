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
//     assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
//     // per-test invariants
//     if (ctx.post) assert.equal(ctx.post.status, 0, `…stderr…`);
//   });
//
// runAgent receives the TestContext directly because t.diagnostic uses private
// instance fields — destructuring (`{ diagnostic } = t`) loses the `this`
// binding and throws on call. Cleaner to take `t` and let runAgent invoke
// `t.diagnostic(…)` and read `t.signal` inline.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { runClaw } from './claw.js';
import * as workspace from './workspace.js';
import { clawModel } from './tier.js';

const DEFAULT_POST_SCRIPT_TIMEOUT_MS  = 5_000;
const DEFAULT_PRECONDITION_TIMEOUT_MS = 5_000;
const AGENT_STDERR_TAIL = 1_500;
const POST_STDERR_TAIL  = 800;

// Buffer between claw's internal timer expiring and node:test's outer
// {timeout} firing. Covers diagnostic flush (workspace.list + JSON.stringify),
// reporter event propagation, and GC/OS jitter — i.e. everything that happens
// after the runner returns *except* the post-script, which gets its own
// budget. Total slack used is FLUSH_MARGIN_MS + preconditionTimeoutMs +
// postScriptTimeoutMs (when present), computed per-call.
const FLUSH_MARGIN_MS = Number(process.env.RUNAGENT_FLUSH_MARGIN_MS) || 3_000;

/**
 * @typedef {Object} RunnerResult
 * @property {number|null} code              Agent process exit code; null on timeout.
 * @property {string}      stdout
 * @property {string}      stderr
 * @property {number}      elapsedMs
 * @property {string}      runDir            Sidecar directory.
 * @property {'timeout'=}  terminal_status   Set to 'timeout' when the signal aborted.
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
 * @param {number}                [opts.preconditionTimeoutMs=5000]
 * @param {string|null}           [opts.postScript=null]
 * @param {number}                [opts.postScriptTimeoutMs=5000]
 * @param {number}                [opts.clawTimeoutMs]  Set equal to the test's
 *   `{timeout}`. runAgent subtracts slack (precondition + post + FLUSH_MARGIN_MS)
 *   and passes the remainder to the runner. Throws if too small for the slack.
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
  // here. The backstop now is expected-attempts.mjs's diff: a sweep with the
  // reporter accidentally unwired produces zero sidecars and the diff flags
  // every cell as missing.

  // run_summary.json's test_id field is populated from this env var in
  // claw.js's buildRunSummary. Reporter doesn't read it; it's for the
  // downstream registry-row joiner.
  process.env.ITER_DIST_TEST_ID = testId;

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

  const agent = await runner({ prompt, signal, timeoutMs: runnerTimeoutMs });
  t.diagnostic(`runDir=${agent.runDir}`);
  t.diagnostic(`test_id=${testId}`);
  t.diagnostic(`agent_result=${JSON.stringify({
    code:       agent.code,
    elapsedMs:  agent.elapsedMs,
    files:      workspace.list(),
    stderrTail: agent.code !== 0 ? agent.stderr.slice(-AGENT_STDERR_TAIL) : undefined,
  })}`);

  let post = null;
  if (postScript) {
    post = spawnSync('node', [path.join(workspace.WORKSPACE, postScript)], {
      encoding: 'utf8',
      timeout:  postScriptTimeoutMs,
      cwd:      workspace.WORKSPACE,
    });
    t.diagnostic(`post_result=${JSON.stringify({
      script:     postScript,
      status:     post.status,
      stderrTrim: post.stderr.slice(0, 400),
      stderrTail: post.stderr.slice(0, POST_STDERR_TAIL),
    })}`);
  }

  return { agent, workspace, post };
}

function defaultRunner({ prompt, signal, timeoutMs }) {
  return runClaw({ prompt, model: clawModel, signal, timeoutMs });
}
