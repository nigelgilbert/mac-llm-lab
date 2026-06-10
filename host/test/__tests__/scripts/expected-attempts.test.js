// Unit tests for scripts/expected-attempts.mjs's isEmitEligible heuristic.
//
// The heuristic is a regex (`\b(runAgent|writeAssertionResult)\b`) applied to
// the raw test source. Failure mode if it goes wrong: a Family C test gets
// falsely marked eligible (over-emission, surfaces as missing cells in the
// post-sweep diff) or a real call goes unmatched (under-emission, silent).
// These tests pin the cases the regex must handle so a future tweak can't
// silently regress them.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isEmitEligible } from '../../scripts/expected-attempts.mjs';

const tmpdirs = [];
function writeFixture(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-attempts-'));
  tmpdirs.push(d);
  const p = path.join(d, name);
  fs.writeFileSync(p, body);
  return p;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('isEmitEligible', () => {
  it('matches a runAgent call (the lib/runAgent.js helper path)', () => {
    const p = writeFixture('a.test.js', `
      import { runAgent } from '../../lib/runAgent.js';
      describe('x', () => {
        it('y', { timeout: 60_000 }, async (t) => {
          const ctx = await runAgent({ prompt: 'p', testId: 'x', t, clawTimeoutMs: 60_000 });
        });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });

  it('matches a writeAssertionResult call (direct-runner opt-out path)', () => {
    const p = writeFixture('b.test.js', `
      import { runOpenCode } from '../../lib/opencode.js';
      import { writeAssertionResult } from '../../lib/registry_emit.js';
      it('z', async ({ signal }) => {
        const r = await runOpenCode({ prompt: 'p', signal, timeoutMs: 60_000 });
        writeAssertionResult(r.runDir, { passed: true });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });

  it('does not match a file with no mention of either entry point (Family C shape)', () => {
    const p = writeFixture('c.test.js', `
      import { streamMessage } from '../../lib/stream.js';
      it('latency', async () => {
        await streamMessage({ prompt: 'p' });
      });
    `);
    assert.equal(isEmitEligible(p), false);
  });

  it('does not falsely match similar identifiers (runAgentSetup, writeAssertionResultV2)', () => {
    // The regex uses \b boundaries — these longer identifiers must not match
    // the bare names. Pin it: if someone drops the \b, this trips.
    const p = writeFixture('d.test.js', `
      import { runAgentSetup } from '../../lib/legacy.js';
      import { writeAssertionResultV2 } from '../../lib/v2.js';
      it('legacy', async () => {
        await runAgentSetup({});
        writeAssertionResultV2({});
      });
    `);
    assert.equal(isEmitEligible(p), false);
  });

  // Known limitation: the regex matches mentions in comments/strings. Today
  // no test file does this, but if the eligibility check is ever tightened
  // (e.g. to skip comment lines), flip this assertion to `false`.
  it('matches a bare-name mention in a comment (current behavior — known limitation)', () => {
    const p = writeFixture('e.test.js', `
      // previously used runAgent, now migrated to streamMessage
      import { streamMessage } from '../../lib/stream.js';
      it('latency', async () => {
        await streamMessage({ prompt: 'p' });
      });
    `);
    assert.equal(isEmitEligible(p), true);
  });
});
