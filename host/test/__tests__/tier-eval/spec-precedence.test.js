// Spec compliance with precedence trap: requirements appear to conflict,
// resolved by a precedence rule stated once.
//
// Difficulty knob: careful reading + holding multiple requirements at once.
// Path-formatting rules:
//   (1) collapse runs of '/' to a single '/'
//   (2) strip a trailing '/' (unless the result would be empty, then return '/')
//   (3) lowercase everything
//   (4) URL-encode spaces as '%20'
//   (5) PRECEDENCE: rules apply in the listed order; a rule operates on the
//       output of the previous rule. So '%20' produced by rule (4) must NOT
//       be lowercased afterwards (rule 3 happens first; %20 emerges last and
//       stays uppercase). And rule (1) collapses BEFORE rule (2) strips, so
//       '///' becomes '/' (collapse to '/', then rule 2 returns '/' unchanged
//       since stripping would empty it).
//
// A model that applies the rules in a different order, or runs lowercase
// after encoding, fails the assertions.
//
// Target: hard.

/** @manifest
 * {
 *   "test_id": "spec-precedence",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 precedence-trap structure exercises holding-multiple-rules-at-once distinct from edge density.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { normalizePath } from './path.js';

assert.equal(normalizePath('/Foo/Bar/'),       '/foo/bar',     'lowercase + strip trailing');
assert.equal(normalizePath('/foo//bar///baz'), '/foo/bar/baz', 'collapse runs of /');
assert.equal(normalizePath('///'),             '/',            'all-slashes preserves single /');
assert.equal(normalizePath('/'),               '/',            'single slash unchanged');
assert.equal(normalizePath('/Hello World/'),   '/hello%20world', 'space encoded after lowercase');
assert.equal(normalizePath('/A B C'),          '/a%20b%20c',   'multiple spaces encoded');
assert.equal(normalizePath('/Foo Bar/Baz/'),   '/foo%20bar/baz', 'mixed: lowercase, encode, strip');
`;

const PROMPT =
  'Create path.js that exports `normalizePath(input)`. Apply these rules ' +
  'in the order listed. Each rule operates on the output of the previous rule.\n' +
  '  (1) collapse any run of "/" characters into a single "/"\n' +
  '  (2) strip a trailing "/" — UNLESS the resulting string would be empty, ' +
  'in which case return "/"\n' +
  '  (3) lowercase every ASCII letter\n' +
  '  (4) replace every space character with the literal three characters "%20"\n' +
  'Note that "%20" is produced AFTER lowercasing (rule 3 runs before rule 4), ' +
  'so the "%20" should remain uppercase in the output. ' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 300_000;

describe(`spec-precedence: ordered transformation rules (tier=${TIER_LABEL})`, () => {
  it('claw applies the rules in the specified order', { timeout: TIMEOUT }, async () => {
    const ctx = await runAgentSetup({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      timeoutMs:  TIMEOUT,
      testId:  'spec-precedence',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('verify.js', VERIFY_JS);
    });
  });
});
