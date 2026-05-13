// API evolution: change a function signature, update both call sites.
//
// Difficulty knob: 2 files × signature semantics change. Different from
// multi-file-rename: this is not a rename, it's an argument-order change
// in an existing API, where the model has to update each call site
// correctly (not all call sites take the same args).
//
// Sibling test to multi-file-rename — same shape (cross-file refactor),
// but smaller surface (2 files, not 3) and the work is mechanical once
// understood. Probes the same agent-loop hazard but with a lower difficulty
// floor so we can tell the difference between "model can't do cross-file
// edits at all" and "this specific multi-file test is harness-flaky."
//
// Target: medium-hard (7B 25-50%, 14B 60-80%, 30B 85-100%).

/** @manifest
 * {
 *   "test_id": "api-evolution",
 *   "test_version": "v1",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep — multi-file signature change is core to multi_file_context axis.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [
 *     "repo_size_dependent"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const PRICING_JS = `\
export function discount(price, percent) {
  return price * (1 - percent / 100);
}
`;

const APP_JS = `\
import assert from 'node:assert/strict';
import { discount } from './pricing.js';

// New signature: discount(percent, price). Caller must be updated.
assert.equal(discount(10, 100), 90,  'discount 10% off 100');
assert.equal(discount(25, 200), 150, 'discount 25% off 200');
assert.equal(discount(0,  50),  50,  'discount 0% off 50');
`;

const PROMPT =
  'Refactor pricing.js so that `discount` takes its arguments in the order ' +
  '(percent, price) instead of (price, percent). Then update app.js so its ' +
  'call sites pass arguments in the new order, and ensure that running ' +
  '`node app.js` exits 0. Do not change the assertions in app.js.';

const TIMEOUT = 240_000;

describe(`api evolution: signature reorder across two files (tier=${TIER_LABEL})`, () => {
  it('claw reorders the signature and updates the call site', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            { 'pricing.js': PRICING_JS, 'app.js': APP_JS },
      preconditionMustFail: 'app.js',
      postScript:           'app.js',
      clawTimeoutMs:    TIMEOUT,
      testId:            'api-evolution',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
