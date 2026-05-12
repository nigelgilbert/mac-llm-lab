// Multi-bug with decoy: 5 buggy helpers + 1 correct helper that *looks* wrong.
//
// Difficulty knob: distinguishes "fixes what's broken" from "edits what looks
// suspicious". The decoy `isPalindrome` uses an unusual but correct
// implementation (compare to reverse via Array.from + reduce). A model that
// over-edits will replace it with the obvious version — fine if behavior
// matches, but the assertion-set includes inputs (empty string, single char,
// unicode) that some "obvious" rewrites get wrong. The win condition is to
// fix the 5 real bugs and either leave the decoy alone OR rewrite it to a
// version that still passes all assertions.
//
// Real bugs (must be fixed):
//   - clamp:    returns min when n>max (instead of max)
//   - unique:   uses Array.includes with O(n²) but loses original order
//               (returns reversed)
//   - chunk:    off-by-one — last chunk is dropped when length isn't divisible
//   - flatten:  one level too deep (flattens recursively instead of one level)
//   - zip:      stops at longer array (Array.from with longer length, undefined
//               filled in)
//
// Decoy: isPalindrome uses Array.from + reduce, correct but unusual.
//
// Target: hard.

/** @manifest
 * {
 *   "test_id": "multi-bug-decoy",
 *   "test_version": "v1",
 *   "primary_axis": "convergence",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 distinguishes 'fixes what's broken' from 'edits what looks suspicious'.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const HELPERS_JS = `\
import assert from 'node:assert/strict';

export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return min;
  return n;
}

export function unique(arr) {
  const seen = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!seen.includes(arr[i])) seen.push(arr[i]);
  }
  return seen;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i + size <= arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export function flatten(arr) {
  const out = [];
  for (const x of arr) {
    if (Array.isArray(x)) out.push(...flatten(x));
    else                   out.push(x);
  }
  return out;
}

export function zip(a, b) {
  const len = Math.max(a.length, b.length);
  return Array.from({ length: len }, (_, i) => [a[i], b[i]]);
}

// Decoy: unusual but correct.
export function isPalindrome(s) {
  return Array.from(s).reduce(
    (acc, ch, i, arr) => acc && ch === arr[arr.length - 1 - i],
    true,
  );
}

assert.equal(clamp(5, 0, 10),  5,  'clamp in range');
assert.equal(clamp(-1, 0, 10), 0,  'clamp below');
assert.equal(clamp(20, 0, 10), 10, 'clamp above');

assert.deepEqual(unique([1, 2, 1, 3, 2]), [1, 2, 3], 'unique preserves first-seen order');

assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]], 'chunk includes remainder');
assert.deepEqual(chunk([1,2,3,4],   2), [[1,2],[3,4]],     'chunk exact');

assert.deepEqual(flatten([1,[2,[3,4]],5]), [1,2,[3,4],5], 'flatten one level');

assert.deepEqual(zip([1,2,3], ['a','b']), [[1,'a'],[2,'b']], 'zip stops at shorter');

assert.equal(isPalindrome(''),       true,  'empty palindrome');
assert.equal(isPalindrome('a'),      true,  'single palindrome');
assert.equal(isPalindrome('racecar'), true, 'racecar palindrome');
assert.equal(isPalindrome('hello'),  false, 'hello not palindrome');
`;

const PROMPT =
  'helpers.js exports six small array/string helpers and runs assertions ' +
  'on them. Several assertions currently fail. Fix every helper whose ' +
  'assertions fail so that running `node helpers.js` exits 0. Do not ' +
  'change the assertions. Note: not every helper is buggy — only edit ' +
  'helpers whose assertions actually fail.';

const TIMEOUT = 300_000;

describe(`multi-bug-decoy: 5 bugs + 1 correct helper (tier=${TIER_LABEL})`, () => {
  it('claw fixes the bugs without breaking the decoy', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            { 'helpers.js': HELPERS_JS },
      preconditionMustFail: 'helpers.js',
      postScript:           'helpers.js',
      testId:            'multi-bug-decoy',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
