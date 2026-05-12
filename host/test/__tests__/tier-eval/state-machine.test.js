// State machine: implement a small FSM with explicit transitions.
//
// Difficulty knob: stateful logic + multiple constraints. The spec lists
// 4 states, valid transitions, and an error for invalid transitions.
// Naive solutions miss the "throw on invalid transition" requirement
// or get one of the transition rules wrong.
//
// Target: medium-hard (7B 30-55%, 14B 65-85%, 30B 90-100%).

/** @manifest
 * {
 *   "test_id": "state-machine",
 *   "test_version": "v1",
 *   "primary_axis": "stateful_logic",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 explicit-transition FSM is a canonical stateful_logic exercise.",
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
import { TrafficLight } from './light.js';

const t = new TrafficLight();
assert.equal(t.state, 'red', 'starts red');
t.next();
assert.equal(t.state, 'green', 'red -> green');
t.next();
assert.equal(t.state, 'yellow', 'green -> yellow');
t.next();
assert.equal(t.state, 'red', 'yellow -> red');

// Force-set is allowed only for valid states.
const t2 = new TrafficLight();
t2.set('yellow');
assert.equal(t2.state, 'yellow', 'set to valid state');

// Invalid set throws.
const t3 = new TrafficLight();
assert.throws(() => t3.set('purple'), /invalid state/i, 'set to invalid state must throw');

// next() is cyclic.
const t4 = new TrafficLight();
for (let i = 0; i < 6; i++) t4.next();
assert.equal(t4.state, 'red', 'six nexts return to red');
`;

const PROMPT =
  'Create light.js that exports a class `TrafficLight`. Behavior: ' +
  '(1) starts in state "red"; ' +
  '(2) `next()` advances state in the cycle red → green → yellow → red; ' +
  '(3) the current state is exposed as the `state` property; ' +
  '(4) `set(name)` sets the state to one of "red", "green", or "yellow"; ' +
  '(5) `set(name)` throws an Error whose message contains the words "invalid state" ' +
  'when called with any other value. Then ensure `node verify.js` exits 0. ' +
  'Do not edit verify.js.';

const TIMEOUT = 300_000;

describe(`state-machine: traffic light (tier=${TIER_LABEL})`, () => {
  it('claw implements the FSM with valid transitions and rejection of invalid ones', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'state-machine',
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
