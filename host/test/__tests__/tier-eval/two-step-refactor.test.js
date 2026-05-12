// Two-step refactor: extract a helper AND fix a bug inside it.
//
// Difficulty knob: multi-step single-file. Single-step refactor is easy
// (everyone passes). Two sequential edits in one file — extract a helper
// from a duplicated pattern, then fix the bug that lives in the duplicated
// logic — distinguishes models that plan from models that pattern-match.
//
// The seed has duplicated `for (let i = 0; i <= arr.length; i++)` blocks in
// two functions. Asking to extract them surfaces the off-by-one (which both
// callers had); a model that just extracts without thinking copies the bug
// into the helper. A model that thinks about correctness fixes it.
//
// Target: medium-hard (7B 25-50%, 14B 60-80%, 30B 85-100%).

/** @manifest
 * {
 *   "test_id": "two-step-refactor",
 *   "test_version": "v1",
 *   "primary_axis": "convergence",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 multi-step single-file is a distinct convergence sub-mode (plan vs. pattern-match).",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const STATS_JS = `\
import assert from 'node:assert/strict';

export function sum(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) {
    total += arr[i];
  }
  return total;
}

export function product(arr) {
  let total = 1;
  for (let i = 0; i <= arr.length; i++) {
    total *= arr[i];
  }
  return total;
}

assert.equal(sum([1, 2, 3]),     6, 'sum mismatch');
assert.equal(product([2, 3, 4]), 24, 'product mismatch');
assert.equal(sum([]),            0, 'empty sum');
assert.equal(product([]),        1, 'empty product');
`;

const PROMPT =
  'stats.js has two functions, sum and product, that share an iteration ' +
  'pattern. Extract a single helper function `reduce(arr, op, init)` that ' +
  'both sum and product use, and rewrite sum and product in terms of it. ' +
  'After your edits, running `node stats.js` must exit 0. Keep both exports ' +
  'and all assertions in place.';

const TIMEOUT = 300_000;

describe(`two-step refactor: extract helper and fix latent bug (tier=${TIER_LABEL})`, () => {
  it('claw extracts the helper without copying the off-by-one', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            { 'stats.js': STATS_JS },
      preconditionMustFail: 'stats.js',
      postScript:           'stats.js',
      testId:            'two-step-refactor',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
