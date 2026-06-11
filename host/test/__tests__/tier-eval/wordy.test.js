/** @manifest
 * {
 *   "test_id": "wordy",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "Adapted from Exercism JS 'wordy' (MIT); mutation depth: STANDARD; key changes: evaluate(query) not answer(question), 'Compute ... .' prefix/suffix not 'What is ... ?', operators renamed (added to / decreased by / scaled by / divided by), typed error classes UnsupportedOp / MalformedInput; canonical at host/test/docs/difficulty-pack/canonicals/wordy/"
 * }
 */

// What:  Implement evaluate(query) — a tiny English-prose calculator. Inputs
//        look like "Compute 3 added to 2 scaled by 3." and must evaluate
//        strictly left-to-right (NO operator precedence). Operators are
//        renamed: added to, decreased by, scaled by, divided by. Bad input
//        throws typed errors (UnsupportedOp / MalformedInput).
//
// Why:   Clean monotonic tier discriminator (c21 N=3: t16 1/3, t64 3/3 —
//        floors hard at t16, perfect at t64). Two saturation defenses are
//        load-bearing here:
//        1) Renamed operators force the model to read the spec rather than
//           recall the canonical Exercism solution from training.
//        2) Left-to-right evaluation defeats models that auto-import
//           standard precedence; the test cases ((3+2)*3=15, not 3+(2*3)=9)
//           punish that exact mistake.
//        Primary axis: spec_precision. See difficulty-pack/good-tests.md row 2.

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { evaluate, UnsupportedOp, MalformedInput } from './wordy.js';

// Single number (iteration 0 analog)
assert.equal(evaluate("Compute 5."), 5, 'single number');
assert.equal(evaluate("Compute -3."), -3, 'negative single number');
assert.equal(evaluate("Compute 0."), 0, 'zero');

// Each operator
assert.equal(evaluate("Compute 5 added to 13."), 18, 'added to');
assert.equal(evaluate("Compute 7 decreased by 5."), 2, 'decreased by');
assert.equal(evaluate("Compute 6 scaled by 4."), 24, 'scaled by');
assert.equal(evaluate("Compute 25 divided by 5."), 5, 'divided by');

// Negative operands
assert.equal(evaluate("Compute -2 added to 5."), 3, 'negative left operand');
assert.equal(evaluate("Compute 10 decreased by -3."), 13, 'decreased by negative');

// Left-to-right evaluation — no operator precedence
assert.equal(evaluate("Compute 3 added to 2 scaled by 3."), 15, 'left-to-right: (3+2)*3 not 3+(2*3)');
assert.equal(evaluate("Compute 10 decreased by 3 added to 2."), 9, 'three-op left-to-right');
assert.equal(evaluate("Compute 2 scaled by 5 decreased by 4 divided by 2."), 3, 'four-op chain');

// Whitespace tolerance
assert.equal(evaluate("Compute 5 added to  13."), 18, 'extra internal whitespace collapses');

// Error: unsupported operator
assert.throws(() => evaluate("Compute 52 cubed."), UnsupportedOp, 'unknown operator throws UnsupportedOp');
assert.throws(() => evaluate("Compute 3 added to 4 squared."), UnsupportedOp, 'mid-chain unknown operator');

// Error: malformed input
assert.throws(() => evaluate("Compute 1 added to added to 2."), MalformedInput, 'consecutive operators');
assert.throws(() => evaluate("Fly to the moon."), MalformedInput, 'wrong prefix');
assert.throws(() => evaluate("Compute 5 added to."), MalformedInput, 'trailing operator no operand');
assert.throws(() => evaluate("Compute."), MalformedInput, 'empty expression');

// Error: missing trailing period (the spec requires '.' to terminate the query)
assert.throws(() => evaluate("Compute 5 added to 13"), MalformedInput, 'missing trailing period');

// Error: trailing junk after the period
assert.throws(() => evaluate("Compute 5. added to 13."), MalformedInput, 'junk after first period');

// Subtle ambiguity: a term that is the literal word "added" without "to"
// must throw — partial match must not consume the operator phrase.
assert.throws(() => evaluate("Compute 5 added 13."), MalformedInput, 'partial operator phrase');
`;

const PROMPT = `\
Create wordy.js that exports \`evaluate(query)\` and two named Error subclasses:
\`UnsupportedOp\` and \`MalformedInput\`.

The function parses and evaluates arithmetic queries in the form:
  "Compute <expr>."

The query MUST start with the literal token "Compute " (capital C) and
MUST end with a single period '.'. Anything else (missing period, trailing
text after the period, wrong prefix) is MalformedInput.

where <expr> is either:
  - a single integer (possibly negative): return that integer directly
  - two or more terms connected left-to-right by binary operators

Supported operators (exact multi-word phrases in the query):
  "added to"     → addition
  "decreased by" → subtraction
  "scaled by"    → multiplication
  "divided by"   → division

Evaluation is strictly left-to-right, ignoring conventional operator precedence.
Example: "Compute 3 added to 2 scaled by 3." evaluates to 15 (not 9).

Whitespace: collapse runs of spaces inside the query before parsing.

Errors:
  - Throw UnsupportedOp if the query contains a word that looks like an
    operator but is not in the supported set (e.g. "cubed", "squared").
  - Throw MalformedInput for any other invalid input: wrong prefix, missing
    operands, consecutive operators, trailing operator, empty expression, etc.

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const TIMEOUT = 285_000;

describe(`wordy: arithmetic query parser (tier=${TIER_LABEL})`, () => {
  it('claw solves the task', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'wordy',
      t,
    });
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
  });
});
