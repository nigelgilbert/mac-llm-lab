import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAgent } from '../../lib/runAgent.js';

function makeT() {
  return { signal: new AbortController().signal, diagnostic: () => {} };
}

function makeRunner(calls) {
  return async (opts) => {
    calls.push(opts);
    return { code: 0, stdout: '', stderr: '', elapsedMs: 0, runDir: '/tmp/none' };
  };
}

const BASE = {
  prompt: 'p',
  testId: 'unit-runAgent',
  seedFiles: {},
  preconditionMustFail: null,
  postScript: null,
};

describe('runAgent input validation', () => {
  it('throws when prompt missing', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, prompt: '', t: makeT(), clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /prompt required/,
    );
  });

  it('throws when testId missing', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, testId: '', t: makeT(), clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /testId required/,
    );
  });

  it('throws when t lacks diagnostic or signal', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, t: {}, clawTimeoutMs: 60_000, runner: makeRunner([]) }),
      /TestContext/,
    );
  });
});

describe('runAgent slack derivation', () => {
  // Defaults: precondition 5000, post 5000, flush 3000.
  // Slack table by (preconditionMustFail, postScript) presence:
  //   (T, T) = 13_000   (T, F) = 8_000   (F, T) = 8_000   (F, F) = 3_000
  const CASES = [
    { pre: 'pre.js', post: 'post.js', expectedSlack: 13_000 },
    { pre: 'pre.js', post: null,      expectedSlack: 8_000 },
    { pre: null,     post: 'post.js', expectedSlack: 8_000 },
    { pre: null,     post: null,      expectedSlack: 3_000 },
  ];

  for (const { pre, post, expectedSlack } of CASES) {
    it(`throws when clawTimeoutMs <= slack (pre=${!!pre}, post=${!!post})`, async () => {
      await assert.rejects(
        () => runAgent({
          ...BASE,
          preconditionMustFail: pre,
          postScript: post,
          clawTimeoutMs: expectedSlack,
          t: makeT(),
          runner: makeRunner([]),
        }),
        new RegExp(
          `slack \\(${expectedSlack}ms = precondition ${pre ? 5000 : 0} ` +
          `\\+ post ${post ? 5000 : 0} \\+ flush 3000\\)`,
        ),
      );
    });
  }

  it('does not throw when clawTimeoutMs = slack + 1', async () => {
    const calls = [];
    await assert.doesNotReject(() => runAgent({
      ...BASE,
      clawTimeoutMs: 3_001,
      t: makeT(),
      runner: makeRunner(calls),
    }));
    assert.equal(calls[0].timeoutMs, 1);
  });

  it('preconditionTimeoutMs override flows into slack', async () => {
    await assert.rejects(
      () => runAgent({
        ...BASE,
        preconditionMustFail: 'pre.js',
        preconditionTimeoutMs: 20_000,
        clawTimeoutMs: 23_000, // = 20000 + 3000 flush
        t: makeT(),
        runner: makeRunner([]),
      }),
      /precondition 20000.*flush 3000/,
    );
  });

  it('postScriptTimeoutMs override flows into slack', async () => {
    await assert.rejects(
      () => runAgent({
        ...BASE,
        postScript: 'post.js',
        postScriptTimeoutMs: 15_000,
        clawTimeoutMs: 18_000, // = 15000 + 3000 flush
        t: makeT(),
        runner: makeRunner([]),
      }),
      /post 15000.*flush 3000/,
    );
  });

  it('throws when clawTimeoutMs is missing/non-numeric', async () => {
    await assert.rejects(
      () => runAgent({ ...BASE, t: makeT(), runner: makeRunner([]) }),
      /clawTimeoutMs/,
    );
  });
});

describe('runAgent RUNAGENT_FLUSH_MARGIN_MS override', () => {
  it('honors env override at module load', async () => {
    // Module reads FLUSH_MARGIN_MS at top level; bust ESM cache with a query
    // suffix so a fresh module instance reads the overridden env var.
    const prev = process.env.RUNAGENT_FLUSH_MARGIN_MS;
    process.env.RUNAGENT_FLUSH_MARGIN_MS = '7000';
    try {
      const mod = await import('../../lib/runAgent.js?flush=7000');
      await assert.rejects(
        () => mod.runAgent({
          ...BASE,
          clawTimeoutMs: 7_000,
          t: makeT(),
          runner: makeRunner([]),
        }),
        /flush 7000/,
      );
    } finally {
      if (prev === undefined) delete process.env.RUNAGENT_FLUSH_MARGIN_MS;
      else process.env.RUNAGENT_FLUSH_MARGIN_MS = prev;
    }
  });
});

describe('runAgent runner invocation', () => {
  it('passes prompt, signal, and shrunk timeoutMs to runner', async () => {
    const calls = [];
    const t = makeT();
    await runAgent({
      ...BASE,
      prompt: 'hello',
      clawTimeoutMs: 60_000, // slack = 3000 → runner gets 57_000
      t,
      runner: makeRunner(calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'hello');
    assert.equal(calls[0].signal, t.signal);
    assert.equal(calls[0].timeoutMs, 57_000);
  });
});

describe('runAgent diagnostic emission', () => {
  function makeTCapture() {
    const diagnostics = [];
    const t = {
      signal: new AbortController().signal,
      diagnostic: (m) => diagnostics.push(m),
    };
    return { t, diagnostics };
  }

  it('emits runAgent_done=1 as the final diagnostic (reporter flush sentinel)', async () => {
    const { t, diagnostics } = makeTCapture();
    await runAgent({
      ...BASE,
      clawTimeoutMs: 60_000,
      t,
      runner: makeRunner([]),
    });
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
  });

  it('skips runDir diagnostic and logs to stderr when runner returns no runDir', async () => {
    // Models the claw.js telemetry-hiccup path where collectRunArtifacts
    // throws and `extras` stays { runId } with no runDir. Without the guard,
    // runAgent would emit `runDir=undefined` and the reporter would attempt
    // to write to a path called "undefined".
    const { t, diagnostics } = makeTCapture();
    const origErr = console.error;
    let stderrCaptured = '';
    console.error = (m) => { stderrCaptured += m + '\n'; };
    try {
      await runAgent({
        ...BASE,
        clawTimeoutMs: 60_000,
        t,
        runner: async () => ({ code: 0, stdout: '', stderr: '', elapsedMs: 0 }),
      });
    } finally {
      console.error = origErr;
    }
    assert.equal(diagnostics.some((d) => d.startsWith('runDir=')), false);
    assert.match(stderrCaptured, /no runDir from runner/);
    // The rest of the diagnostic stream still flows; sentinel must still land
    // so the reporter flushes a (sidecar-less) pending and prints the header.
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
  });
});

describe('runAgent ITER_DIST_TEST_ID env restoration', () => {
  // claw.js reads process.env.ITER_DIST_TEST_ID inside collectRunArtifacts
  // (synchronously, on the child-close event) and bakes it into
  // run_summary.test_id. A same-file caller that invokes runClaw directly
  // after a runAgent call would otherwise inherit a stale testId; these
  // tests pin the capture-and-restore contract.
  function withPriorEnv(prior, fn) {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'ITER_DIST_TEST_ID');
    const orig = process.env.ITER_DIST_TEST_ID;
    if (prior === undefined) delete process.env.ITER_DIST_TEST_ID;
    else process.env.ITER_DIST_TEST_ID = prior;
    return Promise.resolve(fn()).finally(() => {
      if (!had) delete process.env.ITER_DIST_TEST_ID;
      else process.env.ITER_DIST_TEST_ID = orig;
    });
  }

  it('sets the env during the runner call and restores `undefined` afterwards', async () => {
    await withPriorEnv(undefined, async () => {
      let seenDuringRun;
      const runner = async () => {
        seenDuringRun = process.env.ITER_DIST_TEST_ID;
        return { code: 0, stdout: '', stderr: '', elapsedMs: 0, runDir: '/tmp/none' };
      };
      await runAgent({ ...BASE, testId: 'unit-restore', t: makeT(), clawTimeoutMs: 60_000, runner });
      assert.equal(seenDuringRun, 'unit-restore');
      assert.equal(
        Object.prototype.hasOwnProperty.call(process.env, 'ITER_DIST_TEST_ID'),
        false,
        'env must be deleted (not set to the string "undefined") when previously unset',
      );
    });
  });

  it('restores a prior non-empty value after the call', async () => {
    await withPriorEnv('prior-id', async () => {
      await runAgent({ ...BASE, testId: 'unit-restore', t: makeT(), clawTimeoutMs: 60_000, runner: makeRunner([]) });
      assert.equal(process.env.ITER_DIST_TEST_ID, 'prior-id');
    });
  });

  it('restores the env even when the runner rejects', async () => {
    await withPriorEnv('prior-id', async () => {
      const runner = async () => { throw new Error('runner boom'); };
      await assert.rejects(
        () => runAgent({ ...BASE, testId: 'unit-restore', t: makeT(), clawTimeoutMs: 60_000, runner }),
        /runner boom/,
      );
      assert.equal(process.env.ITER_DIST_TEST_ID, 'prior-id');
    });
  });
});

describe('runAgent pass oracle — workspace-only (issue #001)', () => {
  function makeTCapture() {
    const diagnostics = [];
    return {
      t: { signal: new AbortController().signal, diagnostic: (m) => diagnostics.push(m) },
      diagnostics,
    };
  }
  // Stub runner returning a caller-chosen exit code; never touches the
  // workspace, so the seeded post.js is what the oracle actually runs.
  const runnerExiting = (code) => async () =>
    ({ code, stdout: '', stderr: 'agent-noise', elapsedMs: 1, runDir: '/tmp/none' });

  it('passes when post.status===0 even if the agent exited non-zero', async () => {
    const { t, diagnostics } = makeTCapture();
    const ctx = await runAgent({
      ...BASE,
      seedFiles: { 'post.js': 'process.exit(0)\n' },
      postScript: 'post.js',
      clawTimeoutMs: 60_000,
      t,
      runner: runnerExiting(7), // agent "crashed"
    });
    assert.equal(ctx.post.status, 0);
    // Crash is recorded as telemetry, and the sentinel still lands last.
    assert.ok(diagnostics.some((d) => d.startsWith('crashed_before_finishing=1 agent_code=7')));
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
  });

  it('fails when post.status!==0 even though the agent exited 0', async () => {
    const { t, diagnostics } = makeTCapture();
    await assert.rejects(
      () => runAgent({
        ...BASE,
        seedFiles: { 'post.js': 'process.exit(1)\n' },
        postScript: 'post.js',
        clawTimeoutMs: 60_000,
        t,
        runner: runnerExiting(0),
      }),
      /post-script failed/,
    );
    // Sentinel emitted BEFORE the throw, so the registry row is still written;
    // post_result carries the failing status for the reporter.
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
    const post = diagnostics.find((d) => d.startsWith('post_result='));
    assert.match(post, /"status":1/);
    // A clean agent exit emits no crash diagnostic.
    assert.equal(diagnostics.some((d) => d.startsWith('crashed_before_finishing')), false);
  });

  it('emits no_workspace_oracle=1 and does not throw when there is no post-script', async () => {
    const { t, diagnostics } = makeTCapture();
    await assert.doesNotReject(() => runAgent({
      ...BASE,
      postScript: null,
      clawTimeoutMs: 60_000,
      t,
      runner: runnerExiting(0),
    }));
    assert.ok(diagnostics.includes('no_workspace_oracle=1'));
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
  });
});

// --- #024: spawnSync spawn-level failure shapes ------------------------------
// spawnSync returns {error, status:null, stdout:null, stderr:null} when the
// spawn itself fails (and {error:ETIMEDOUT, status:null} on a timeout kill).
// Pre-#024 the post path TypeError'd on `post.stderr.slice` before the
// diagnostics/sentinel, and the precondition gate's `status !== 0` check was
// PASSED by status:null — a broken setup masquerading as satisfied.

const tmpdirs = [];
function makeTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'runagent-024-'));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// A runner-stub runDir with a real run_summary.json so the #024 relabel has a
// sidecar to re-type (mirrors what lib/opencode.js writes for a clean run).
function makeStubRunDir() {
  const d = makeTmp();
  fs.writeFileSync(path.join(d, 'run_summary.json'), JSON.stringify({
    schema_version: 1,
    run_id: 'run-024-stub',
    test_id: 'unit-runAgent',
    terminal_status: 'done',
    exit_code: 0,
    timeout: false,
    passed: null,
  }, null, 2) + '\n');
  return d;
}

function readSummary(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'run_summary.json'), 'utf8'));
}

// Empty PATH → spawnSync('node', ...) fails at the spawn level (ENOENT):
// the canonical {error, status:null, stdout:null, stderr:null} shape without
// needing a nonexistent interpreter baked into runAgent.
function withEmptyPath(fn) {
  const prior = process.env.PATH;
  process.env.PATH = '';
  return Promise.resolve(fn()).finally(() => { process.env.PATH = prior; });
}

function makeTCapture024() {
  const diagnostics = [];
  return {
    t: { signal: new AbortController().signal, diagnostic: (m) => diagnostics.push(m) },
    diagnostics,
  };
}

describe('runAgent post-script spawn-level failure (#024)', () => {
  it('ENOENT spawn failure → typed harness-error throw, no TypeError, diagnostics + sentinel still flush, sidecar relabeled', async () => {
    const runDir = makeStubRunDir();
    const { t, diagnostics } = makeTCapture024();
    await assert.rejects(
      () => withEmptyPath(() => runAgent({
        ...BASE,
        seedFiles: { 'post.js': 'process.exit(0)\n' },
        postScript: 'post.js',
        clawTimeoutMs: 60_000,
        t,
        runner: async () => ({ code: 0, stdout: '', stderr: '', elapsedMs: 1, runDir }),
      })),
      /runAgent harness error: post-script post\.js did not run/,
    );
    // post_result diagnostic landed (no TypeError before it) with the
    // spawn-failure shape made explicit.
    const postDiag = diagnostics.find((d) => d.startsWith('post_result='));
    assert.ok(postDiag, 'post_result diagnostic must still be emitted');
    const post = JSON.parse(postDiag.slice('post_result='.length));
    assert.equal(post.status, null);
    assert.equal(post.stderrTrim, '');
    assert.match(post.spawn_error, /ENOENT|status=null/);
    // Typed marker + sentinel, sentinel last.
    assert.ok(diagnostics.includes('harness_error=post_script_spawn_failed'));
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
    // Sidecar relabeled → registry row will read harness_error/passed:null
    // (run_row.pickTerminalStatus honors summary.terminal_status), NOT a
    // passed:false model failure.
    const summary = readSummary(runDir);
    assert.equal(summary.terminal_status, 'harness_error');
    assert.equal(summary.harness_error, 'post_script_spawn_failed');
    assert.equal(summary.passed, null);
    assert.match(summary.harness_error_detail, /status=null/);
  });

  it('timeout kill (status:null after SIGTERM) → harness error, not a model fail', async () => {
    const runDir = makeStubRunDir();
    const { t, diagnostics } = makeTCapture024();
    await assert.rejects(
      () => runAgent({
        ...BASE,
        seedFiles: { 'post.js': 'for(;;){}\n' }, // never exits → spawnSync timeout kill
        postScript: 'post.js',
        postScriptTimeoutMs: 1_000,
        clawTimeoutMs: 60_000,
        t,
        runner: async () => ({ code: 0, stdout: '', stderr: '', elapsedMs: 1, runDir }),
      }),
      /runAgent harness error: post-script post\.js did not run/,
    );
    const post = JSON.parse(diagnostics.find((d) => d.startsWith('post_result=')).slice('post_result='.length));
    assert.equal(post.status, null);
    assert.equal(diagnostics.at(-1), 'runAgent_done=1');
    assert.equal(readSummary(runDir).terminal_status, 'harness_error');
    assert.equal(readSummary(runDir).harness_error, 'post_script_spawn_failed');
  });

  it('a post-script that RAN and failed stays a model failure (no relabel, no spawn_error)', async () => {
    const runDir = makeStubRunDir();
    const { t, diagnostics } = makeTCapture024();
    await assert.rejects(
      () => runAgent({
        ...BASE,
        seedFiles: { 'post.js': 'process.exit(1)\n' },
        postScript: 'post.js',
        clawTimeoutMs: 60_000,
        t,
        runner: async () => ({ code: 0, stdout: '', stderr: '', elapsedMs: 1, runDir }),
      }),
      /post-script failed/,
    );
    const post = JSON.parse(diagnostics.find((d) => d.startsWith('post_result=')).slice('post_result='.length));
    assert.equal(post.status, 1);
    assert.equal(post.spawn_error, undefined);
    assert.equal(diagnostics.includes('harness_error=post_script_spawn_failed'), false);
    assert.equal(readSummary(runDir).terminal_status, 'done'); // untouched
  });
});

describe('runAgent precondition gate spawn-level failure (#024)', () => {
  it('ENOENT spawn failure aborts as a harness error BEFORE the runner (gate not satisfied)', async () => {
    const calls = [];
    await assert.rejects(
      () => withEmptyPath(() => runAgent({
        ...BASE,
        seedFiles: { 'pre.js': 'process.exit(1)\n' },
        preconditionMustFail: 'pre.js',
        clawTimeoutMs: 60_000,
        t: makeT(),
        runner: makeRunner(calls),
      })),
      /runAgent harness error: pre-condition pre\.js did not run/,
    );
    assert.equal(calls.length, 0, 'runner must not run when the precondition never executed');
  });

  it('timeout kill aborts as a harness error (status:null must not satisfy `must fail`)', async () => {
    const calls = [];
    await assert.rejects(
      () => runAgent({
        ...BASE,
        seedFiles: { 'pre.js': 'for(;;){}\n' },
        preconditionMustFail: 'pre.js',
        preconditionTimeoutMs: 1_000,
        clawTimeoutMs: 60_000,
        t: makeT(),
        runner: makeRunner(calls),
      }),
      /runAgent harness error: pre-condition pre\.js did not run/,
    );
    assert.equal(calls.length, 0);
  });

  it('a precondition that RAN and failed still satisfies the gate (runner proceeds)', async () => {
    const calls = [];
    await assert.doesNotReject(() => runAgent({
      ...BASE,
      seedFiles: { 'pre.js': 'process.exit(1)\n' },
      preconditionMustFail: 'pre.js',
      clawTimeoutMs: 60_000,
      t: makeT(),
      runner: makeRunner(calls),
    }));
    assert.equal(calls.length, 1);
  });

  it('a precondition that RAN and passed still fails the gate (must-fail semantics intact)', async () => {
    const calls = [];
    await assert.rejects(
      () => runAgent({
        ...BASE,
        seedFiles: { 'pre.js': 'process.exit(0)\n' },
        preconditionMustFail: 'pre.js',
        clawTimeoutMs: 60_000,
        t: makeT(),
        runner: makeRunner(calls),
      }),
      /must fail before the fix/,
    );
    assert.equal(calls.length, 0);
  });
});

describe('runAgent at-most-once per TestContext', () => {
  it('throws on a second call with the same `t`', async () => {
    const t = makeT();
    await runAgent({
      ...BASE,
      clawTimeoutMs: 60_000,
      t,
      runner: makeRunner([]),
    });
    await assert.rejects(
      () => runAgent({
        ...BASE,
        clawTimeoutMs: 60_000,
        t,
        runner: makeRunner([]),
      }),
      /at most one call per/,
    );
  });
});
