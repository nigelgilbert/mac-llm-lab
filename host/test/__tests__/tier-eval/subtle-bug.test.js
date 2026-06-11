// Subtle-bug debug: classic JS default-sort gotcha.
//
// median.js sorts an array with `.sort()` (no comparator), which is *lexicographic*
// — `[1, 100, 2, 50, 3]` becomes `["1", "100", "2", "3", "50"]`, so median returns
// 100 instead of 3. The assertion fires every time. The fix is one character:
// `.sort()` → `.sort((a,b) => a-b)`.
//
// Differs from refactor.test.js (single-line off-by-one): this requires the model
// to know that JS's default sort is lexicographic, not just spot a `<=` vs `<`.
// A pattern-matching model will swap the comparison or the bounds and remain
// broken; the actual fix demands understanding of the standard library.

/** @manifest
 * {
 *   "test_id": "subtle-bug",
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

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const MEDIAN_JS = `\
import assert from 'node:assert/strict';

function median(arr) {
  const sorted = [...arr].sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

assert.equal(median([1, 100, 2, 50, 3]),  3,  'median of [1,100,2,50,3] should be 3');
assert.equal(median([10, 1, 2]),          2,  'median of [10,1,2] should be 2');
assert.equal(median([2, 1, 4, 3]),        2.5, 'median of [2,1,4,3] should be 2.5');
`;

const PROMPT =
  'median.js has a bug that causes its assertions to fail. Find and fix the ' +
  'bug so that running `node median.js` exits 0. Do not change the assertions ' +
  'or the function signature — only fix the implementation of `median`.';

const TIMEOUT = 300_000;

describe(`subtle bug: default-sort lexicographic (tier=${TIER_LABEL})`, () => {
  it('claw fixes median.js so its assertions pass', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            { 'median.js': MEDIAN_JS },
      preconditionMustFail: 'median.js',
      postScript:           'median.js',
      clawTimeoutMs:    TIMEOUT,
      testId:            'subtle-bug',
      t,
    });
  });
});
