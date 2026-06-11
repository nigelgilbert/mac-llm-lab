// Adversarial inputs: implement a function whose assertions exceed the prompt.
//
// Difficulty knob (rule #6): edge cases NOT mentioned in the prompt. The prompt
// describes a slugify in plain English. The naive `text.toLowerCase().replace(/ /g, '-')`
// passes the basic case and fails everything else. A model that anticipates real
// inputs — multiple spaces, punctuation, leading/trailing whitespace, repeated
// separators, empty input — passes. A model that pattern-matches "lowercase +
// hyphenated" and stops there fails 3+ assertions.
//
// This test specifically probes "do you write defensive regex" — a habit that
// scales with model size. Per rule #7, all assertions test behavior on inputs
// not enumerated in the prompt.

/** @manifest
 * {
 *   "test_id": "adversarial-input",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 axis-critical for spec_precision (hidden-edge surface).",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { slugify } from './slugify.js';

assert.equal(slugify('Hello World'),         'hello-world',   'basic two-word');
assert.equal(slugify('  Hello   World  '),   'hello-world',   'leading/trailing/repeated spaces');
assert.equal(slugify('Hello, World!'),       'hello-world',   'punctuation stripped');
assert.equal(slugify('Hello---World'),       'hello-world',   'collapse repeated separators');
assert.equal(slugify('hello_world'),         'hello-world',   'underscores become hyphens');
assert.equal(slugify(''),                    '',              'empty input');
assert.equal(slugify('   '),                 '',              'whitespace-only input');
assert.equal(slugify('CamelCase Words 42'),  'camelcase-words-42', 'mixed case and digits');
`;

const PROMPT =
  'Create slugify.js that exports a single function `slugify(text)` which ' +
  'converts a string to a URL-friendly slug: lowercase, words separated by ' +
  'single hyphens. Then ensure that `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 240_000;

describe(`adversarial inputs: slugify (tier=${TIER_LABEL})`, () => {
  it('claw implements slugify robustly enough for adversarial inputs', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'adversarial-input',
      t,
    });
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
  });
});
