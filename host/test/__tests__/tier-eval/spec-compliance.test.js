// Spec-compliance: implement to a multi-requirement spec.
//
// Difficulty knob (rule #6): four explicit requirements in the prompt, all
// asserted on. The naive 1-liner satisfies 1–2 of them; a careful read
// satisfies all four. This separates "model dashed off the obvious solution"
// from "model worked the spec."
//
// Hidden adversarial inputs in the assertions (rule #7): zero, large numbers
// that exercise thousands separators, currency symbols longer than one char.
// None of those are mentioned in the prompt — the spec implies them, but
// only if the model reads carefully.

/** @manifest
 * {
 *   "test_id": "spec-compliance",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 multi-requirement spec is canonical spec_precision exercise.",
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
import { formatPrice } from './price.js';

assert.equal(formatPrice(100,     'USD'), '$1.00',       'basic USD');
assert.equal(formatPrice(99,      'EUR'), '€0.99',       'sub-1 EUR');
assert.equal(formatPrice(0,       'USD'), '$0.00',       'zero must keep two decimals');
assert.equal(formatPrice(123456,  'USD'), '$1,234.56',   'thousands separator on USD');
assert.equal(formatPrice(1000000, 'EUR'), '€10,000.00',  'thousands separator on EUR');
assert.equal(formatPrice(50,      'JPY'), '¥0.50',       'JPY symbol');
`;

const PROMPT =
  'Create price.js that exports a single function `formatPrice(cents, currency)`. ' +
  'Requirements: ' +
  '(1) divide cents by 100 to get the major-unit value; ' +
  '(2) always render exactly two decimal places, even for whole or zero values; ' +
  '(3) insert comma thousands separators in the integer portion (e.g., 1234567 cents → "12,345.67"); ' +
  '(4) prefix with the currency symbol — USD → "$", EUR → "€", JPY → "¥". ' +
  'Then ensure that running `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 300_000;

describe(`spec compliance: multi-requirement formatPrice (tier=${TIER_LABEL})`, () => {
  it('claw implements formatPrice satisfying all four requirements', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'spec-compliance',
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
