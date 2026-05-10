// Long-horizon agentic: 4 unrelated bugs across 6 files; one suite to make pass.
//
// Difficulty knob: read → plan → edit → verify → re-read → fix loop, sustained.
// The only signal is `node test.js` exit code. Bugs are independent and live
// in different files, so a single-pass fix won't work — the model must
// iterate through several edit/verify cycles. A model that fixes one bug,
// re-runs, sees a different failure, and gives up leaves 3/4 broken.
//
// The four bugs:
//   - math.js: `sum` uses `-` instead of `+`
//   - strings.js: `repeat(s, n)` repeats n+1 times (off-by-one)
//   - arrays.js: `last` returns arr[0] instead of arr[arr.length-1]
//   - objects.js: `pick` mutates the source object (deletes keys)
//
// Target: hard (saturated tier-64 ceiling probe).

/** @manifest
 * {
 *   "test_id": "long-horizon-bugs",
 *   "test_version": "v1",
 *   "primary_axis": "convergence",
 *   "secondary_axes": [
 *     "tool_discipline"
 *   ],
 *   "suite_layer": "C",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep in Layer C \u2014 trace interpretation matters more than the binary pass rate here.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [
 *     "context_pressure_high"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const MATH_JS = `\
export function sum(a, b) {
  return a - b;
}
export function product(a, b) {
  return a * b;
}
`;

const STRINGS_JS = `\
export function repeat(s, n) {
  let out = '';
  for (let i = 0; i <= n; i++) out += s;
  return out;
}
export function upper(s) {
  return s.toUpperCase();
}
`;

const ARRAYS_JS = `\
export function first(arr) {
  return arr[0];
}
export function last(arr) {
  return arr[0];
}
`;

const OBJECTS_JS = `\
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    out[k] = obj[k];
    delete obj[k];
  }
  return out;
}
`;

const TEST_JS = `\
import assert from 'node:assert/strict';
import { sum, product } from './math.js';
import { repeat, upper } from './strings.js';
import { first, last }   from './arrays.js';
import { pick }          from './objects.js';

assert.equal(sum(2, 3),     5,  'sum');
assert.equal(product(4, 5), 20, 'product');

assert.equal(repeat('ab', 3), 'ababab', 'repeat');
assert.equal(upper('hi'),     'HI',     'upper');

assert.equal(first([1,2,3]), 1, 'first');
assert.equal(last([1,2,3]),  3, 'last');

const src = { a: 1, b: 2, c: 3 };
assert.deepEqual(pick(src, ['a','b']), { a: 1, b: 2 }, 'pick result');
assert.deepEqual(src, { a: 1, b: 2, c: 3 }, 'pick must not mutate source');
`;

const README_MD = `\
# helpers

A small collection of helper modules. Run \`node test.js\` to verify.
`;

const PROMPT =
  'A test runner at test.js imports helpers from math.js, strings.js, ' +
  'arrays.js, and objects.js, and asserts their behavior. Several ' +
  'assertions currently fail. Find and fix every bug across the helper ' +
  'modules so that running `node test.js` exits 0. Do not edit test.js. ' +
  'Do not change README.md.';

const TIMEOUT = 300_000;

describe(`long-horizon: 4 bugs across 6 files (tier=${TIER_LABEL})`, () => {
  it('claw fixes every bug across the helper modules', { timeout: TIMEOUT }, async () => {
    const ctx = await runAgentSetup({
      prompt:               PROMPT,
      seedFiles:            { 'math.js': MATH_JS, 'strings.js': STRINGS_JS, 'arrays.js': ARRAYS_JS, 'objects.js': OBJECTS_JS, 'test.js': TEST_JS, 'README.md': README_MD },
      preconditionMustFail: 'test.js',
      postScript:           'test.js',
      timeoutMs:            TIMEOUT,
      testId:            'long-horizon-bugs',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('README.md', README_MD);
    });
  });
});
