// Comment-spec: implement from a docstring-only seed.
//
// Difficulty knob: instruction-following with the spec living in code-comments
// rather than the prompt. The seed file has function signatures with JSDoc
// comments describing exactly what each function should do; bodies throw.
// The prompt is short — it just says "implement what the comments specify."
//
// This separates models that read the seed carefully from models that ignore
// the seed and pattern-match off the prompt. A model that doesn't read the
// JSDoc returns plausible-looking nonsense; a model that reads it gets every
// detail right.
//
// Target: medium (7B 50-75%, 14B 80-95%, 30B 95-100%).

/** @manifest
 * {
 *   "test_id": "comment-spec",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "multi_file_context"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 instruction-following with spec living in code is a distinct sub-mode of spec_precision.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const COLLECTIONS_JS = `\
/**
 * Return the array partitioned into two arrays: items where predicate(item)
 * is truthy go in the first; the rest go in the second. Order within each
 * sub-array follows the input order. Empty input returns [[], []].
 *
 * Example: partition([1, 2, 3, 4], n => n % 2 === 0) → [[2, 4], [1, 3]]
 */
export function partition(arr, predicate) {
}

/**
 * Return an object whose keys are the values returned by keyFn(item),
 * and whose values are arrays of items that mapped to that key, in input
 * order. Empty input returns {}.
 *
 * Example: groupBy([1.1, 2.2, 1.3], Math.floor) → { 1: [1.1, 1.3], 2: [2.2] }
 */
export function groupBy(arr, keyFn) {
}
`;

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { partition, groupBy } from './collections.js';

assert.deepEqual(partition([1, 2, 3, 4], n => n % 2 === 0), [[2, 4], [1, 3]],     'partition basic');
assert.deepEqual(partition([], () => true),                  [[], []],             'partition empty');
assert.deepEqual(partition([1, 2, 3], () => true),           [[1, 2, 3], []],      'partition all match');
assert.deepEqual(partition([1, 2, 3], () => false),          [[], [1, 2, 3]],      'partition none match');
assert.deepEqual(groupBy([1.1, 2.2, 1.3], Math.floor),       { 1: [1.1, 1.3], 2: [2.2] }, 'groupBy basic');
assert.deepEqual(groupBy([], () => 'x'),                     {},                   'groupBy empty');
assert.deepEqual(groupBy(['a', 'b', 'c'], s => s),           { a: ['a'], b: ['b'], c: ['c'] }, 'groupBy identity');
`;

const PROMPT =
  'collections.js declares two functions with JSDoc comments specifying their ' +
  'behavior; the bodies throw "not implemented". Implement both functions to ' +
  'match the JSDoc specifications, then ensure `node verify.js` exits 0. ' +
  'Do not edit verify.js. Do not change the function signatures or remove the JSDoc.';

const TIMEOUT = 300_000;

describe(`comment-spec: implement from JSDoc (tier=${TIER_LABEL})`, () => {
  it('claw implements both functions per JSDoc', { timeout: TIMEOUT }, async () => {
    const ctx = await runAgentSetup({
      prompt:               PROMPT,
      seedFiles:            { 'collections.js': COLLECTIONS_JS, 'verify.js': VERIFY_JS },
      preconditionMustFail: 'verify.js',
      postScript:           'verify.js',
      timeoutMs:            TIMEOUT,
      testId:            'comment-spec',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('verify.js', VERIFY_JS);
    });
  });
});
