// Deep-equal: implement structural equality with adversarial values.
//
// Difficulty knob: 1 file × multiple hidden edges. Naive `JSON.stringify(a) ===
// JSON.stringify(b)` fails on NaN (becomes null), Date objects, and is order-
// sensitive on plain objects. A correct solution recursively compares.
//
// Target: easy-medium (7B 70-90%, 14B 90-100%, 30B 100%). NaN-equals-NaN
// is the trip wire: it's the one place where direct `===` deliberately
// disagrees with deep equality.

/** @manifest
 * {
 *   "test_id": "deep-equal",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "stateful_logic"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 NaN/Date/order-sensitivity edge surface is axis-critical.",
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
import { isEqual } from './eq.js';

assert.equal(isEqual(1, 1),                                   true,  'primitives equal');
assert.equal(isEqual(1, 2),                                   false, 'primitives unequal');
assert.equal(isEqual({ a: 1, b: 2 }, { b: 2, a: 1 }),         true,  'key order should not matter');
assert.equal(isEqual({ a: 1 }, { a: 1, b: 2 }),               false, 'extra key on right');
assert.equal(isEqual([1, 2, 3], [1, 2, 3]),                   true,  'arrays equal');
assert.equal(isEqual([1, 2, 3], [1, 2]),                      false, 'arrays unequal length');
assert.equal(isEqual({ a: { b: [1] } }, { a: { b: [1] } }),   true,  'nested equal');
assert.equal(isEqual({ a: { b: [1] } }, { a: { b: [2] } }),   false, 'nested unequal');
assert.equal(isEqual(NaN, NaN),                               true,  'NaN must equal NaN');
assert.equal(isEqual(0, -0),                                  true,  '+0 and -0 equal');
`;

const PROMPT =
  'Create eq.js that exports `isEqual(a, b)` returning true when a and b are ' +
  'structurally equal. It should handle primitives, plain objects, and arrays ' +
  'recursively. Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const CLAW_TIMEOUT = 240_000;
const TIMEOUT = CLAW_TIMEOUT + 20_000;

describe(`deep-equal: structural equality (tier=${TIER_LABEL})`, () => {
  it('claw implements deep equality including NaN', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'deep-equal',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
