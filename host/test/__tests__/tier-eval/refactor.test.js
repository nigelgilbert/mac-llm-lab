// Refactor: can the model identify and fix a seeded bug?
//
// The test pre-seeds /workspace/buggy.js with an off-by-one error
// (i <= arr.length reads past the end, giving NaN), then asks claw to fix it.
// After claw exits, the test runner re-executes the file with node and asserts
// exit 0. The pre-condition check (node exits non-zero before the fix) ensures
// the test is not trivially satisfied by a pre-fixed file.
//
// Expected differentiator: smaller dense models (tier-16 7B) sometimes miss
// the off-by-one without thinking; the 14B/30B reliably spot it from the
// assertion message alone.

/** @manifest
 * {
 *   "test_id": "refactor",
 *   "test_version": "v1",
 *   "primary_axis": "convergence",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "easy",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if pass_rate >= 0.95 across all three tiers in confirmatory n>=40 runs.",
 *   "expected_tier_signature": "ceiling",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

// Off-by-one: `i <= arr.length` reads arr[arr.length] === undefined.
// undefined coerces to NaN in arithmetic, so total stays NaN throughout.
// The assert fires every time, producing a clear failure message.
const BUGGY_JS = `\
import assert from 'node:assert/strict';

function sum(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) { total += arr[i]; }
  return total;
}

assert.equal(sum([1, 2, 3]), 6, 'sum([1,2,3]) should be 6');
assert.equal(sum([]),        0, 'sum([]) should be 0');
`;

const PROMPT =
  'buggy.js has a bug that causes its own assertion to fail. ' +
  'Find and fix the bug so that running `node buggy.js` exits 0.';

const CLAW_TIMEOUT = 240_000;

describe(`refactor: fix seeded off-by-one (tier=${TIER_LABEL})`, () => {
  it('claw fixes buggy.js so its assertions pass', { timeout: CLAW_TIMEOUT + 20_000 }, async () => {
    const ctx = await runAgentSetup({
      prompt:               PROMPT,
      seedFiles:            { 'buggy.js': BUGGY_JS },
      preconditionMustFail: 'buggy.js',
      postScript:           'buggy.js',
      timeoutMs:            CLAW_TIMEOUT,
      testId:            'refactor',
    });
    await ctx.finish();
  });
});
