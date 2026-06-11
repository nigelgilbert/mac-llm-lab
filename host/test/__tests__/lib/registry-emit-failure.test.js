// #006 (secondary): a swallowed per-cell registry emit failure must fail the
// cell's rc, not ride stderr-only. writeAssertionResult's emit catch
// (lib/registry_emit.js) sets process.exitCode = 1 — the reporter runs in the
// `node --test` parent process and node:test only ever RAISES the exit code,
// so the cell's process exits nonzero and the driver's ARMS_RC / exit path
// (#003) turns the sweep red. These tests pin:
//   - the catch path (emit throws) sets process.exitCode = 1 and does NOT throw;
//   - the flag-off path (RUN_REGISTRY_EMIT unset) leaves exitCode alone.
// process.exitCode and the env are captured/restored so the suite's own
// verdict is not polluted by the deliberate failure.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeAssertionResult } from '../../lib/registry_emit.js';

const tmpdirs = [];
function makeRunDir({ summary }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-emit-fail-'));
  tmpdirs.push(d);
  if (summary !== undefined) fs.writeFileSync(path.join(d, 'run_summary.json'), summary);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

function withEmitEnv(fn) {
  const priorEmit = process.env.RUN_REGISTRY_EMIT;
  const priorExitCode = process.exitCode;
  try {
    return fn();
  } finally {
    if (priorEmit === undefined) delete process.env.RUN_REGISTRY_EMIT;
    else process.env.RUN_REGISTRY_EMIT = priorEmit;
    process.exitCode = priorExitCode;
  }
}

describe('writeAssertionResult emit-failure rc (#006)', () => {
  it('a throwing emit sets process.exitCode = 1 without throwing', () => {
    withEmitEnv(() => {
      process.env.RUN_REGISTRY_EMIT = '1';
      process.exitCode = 0;
      // Malformed run_summary.json → JSON.parse throws inside
      // maybeEmitRegistryRow → the emit catch runs.
      const runDir = makeRunDir({ summary: '{not json' });
      assert.doesNotThrow(() => writeAssertionResult(runDir, { passed: true }));
      assert.equal(process.exitCode, 1);
      // The sidecar itself still landed (the assertion write precedes the emit).
      assert.ok(fs.existsSync(path.join(runDir, 'assertion_result.json')));
    });
  });

  it('with RUN_REGISTRY_EMIT unset the emit path never runs and exitCode is untouched', () => {
    withEmitEnv(() => {
      delete process.env.RUN_REGISTRY_EMIT;
      process.exitCode = 0;
      const runDir = makeRunDir({ summary: '{not json' });
      writeAssertionResult(runDir, { passed: true });
      assert.equal(process.exitCode, 0);
    });
  });
});
