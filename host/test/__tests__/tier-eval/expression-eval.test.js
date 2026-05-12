// Recursive-descent expression evaluator with operator precedence.
//
// Difficulty knob: 25+ assertions covering precedence, left-associativity,
// unary minus, parens, function calls, error cases. Any single off-by-one
// in the grammar fails multiple assertions. The "obvious" implementation
// (eval string with substitutions) doesn't satisfy the error-case asserts
// because it would either accept invalid input or produce JS errors instead
// of throwing with a specific message.
//
// Tested:
//   - operator precedence: * / before + - before |
//   - left-associativity: 2 - 3 - 4 === -5 (not 3)
//   - right-associativity for ^: 2 ^ 3 ^ 2 === 512 (not 64)
//   - unary minus binds tighter than ^: -2^2 === -4 (not 4)
//   - parens override
//   - function calls: max(a, b), min(a, b), abs(x)
//   - variables: provided as second-arg map
//   - errors: unbalanced parens, unknown function, unknown variable,
//     trailing operator, bad token
//
// Target: very hard (frontier ceiling).

/** @manifest
 * {
 *   "test_id": "expression-eval",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Never drop \u2014 canonical hard discriminator with dense edge surface; strategy doc \u00a72.1 keeps it as core.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [
 *     "context_pressure_high"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { evaluate } from './expr.js';

// Numeric basics.
assert.equal(evaluate('1 + 2'),                 3,    '1+2');
assert.equal(evaluate('2 * 3 + 4'),            10,    'precedence: 2*3+4');
assert.equal(evaluate('2 + 3 * 4'),            14,    'precedence: 2+3*4');
assert.equal(evaluate('(2 + 3) * 4'),          20,    'parens override');
assert.equal(evaluate('10 / 2 / 5'),            1,    'left-assoc div');
assert.equal(evaluate('20 - 5 - 3'),           12,    'left-assoc sub');
assert.equal(evaluate('2 - 3 - 4'),            -5,    'left-assoc sub negative');

// Unary minus.
assert.equal(evaluate('-5'),                   -5,    'unary minus');
assert.equal(evaluate('-(2 + 3)'),             -5,    'unary minus paren');
assert.equal(evaluate('--5'),                   5,    'double unary minus');
assert.equal(evaluate('3 + -2'),                1,    'binary then unary');
assert.equal(evaluate('-2 * 3'),               -6,    'unary then binary');

// Exponent (^) is RIGHT-associative.
assert.equal(evaluate('2 ^ 3'),                 8,    '2^3');
assert.equal(evaluate('2 ^ 3 ^ 2'),           512,    '2^(3^2)=512, right-assoc');
assert.equal(evaluate('2 ^ 2 ^ 3'),           256,    '2^(2^3)=256');

// Unary minus binds TIGHTER than ^ (i.e., -2^2 parses as (-2)^2 = 4).
// Note: there are two conventions — we adopt "unary tighter than ^".
assert.equal(evaluate('-2 ^ 2'),                4,    '(-2)^2 = 4 (unary tighter)');
assert.equal(evaluate('-(2 ^ 2)'),             -4,    'paren forces -(2^2)');

// Whitespace insensitivity.
assert.equal(evaluate('  1+2  '),               3,    'leading/trailing space');
assert.equal(evaluate('1+2*3'),                 7,    'no spaces');

// Function calls.
assert.equal(evaluate('max(1, 2)'),             2,    'max');
assert.equal(evaluate('min(5, 3)'),             3,    'min');
assert.equal(evaluate('abs(-7)'),               7,    'abs');
assert.equal(evaluate('max(1+2, 3*1)'),         3,    'max with expressions');
assert.equal(evaluate('max(1, min(2, 3))'),     2,    'nested function');

// Variables.
assert.equal(evaluate('x + 1', { x: 10 }),       11,  'variable');
assert.equal(evaluate('a * b + c', { a: 2, b: 3, c: 4 }), 10, 'multi var');

// Floats.
assert.equal(evaluate('1.5 + 2.5'),             4,    'floats');

// Error cases — must throw.
assert.throws(() => evaluate('(1 + 2'),         /paren/i,         'unbalanced (');
assert.throws(() => evaluate('1 + 2)'),         /paren/i,         'unbalanced )');
assert.throws(() => evaluate('1 +'),            /unexpected|trail/i, 'trailing op');
assert.throws(() => evaluate('foo(1)'),         /unknown.*function|function.*foo/i, 'unknown func');
assert.throws(() => evaluate('x + 1', {}),      /unknown.*variable|variable.*x/i, 'unknown var');
assert.throws(() => evaluate('1 @ 2'),          /token|character|invalid/i, 'bad token');
assert.throws(() => evaluate(''),               /empty|unexpected|input/i,    'empty input');
`;

const PROMPT =
  'Create expr.js that exports `evaluate(source, vars = {})`. Implement a ' +
  'small expression language and evaluator with these features:\n' +
  '  - Numeric literals (integer or float).\n' +
  '  - Binary operators with conventional precedence: +, -, *, /, ^.\n' +
  '  - +, -, *, / are LEFT-associative. ^ is RIGHT-associative.\n' +
  '  - Unary minus is supported and binds TIGHTER than ^ ' +
  '(so -2^2 evaluates as (-2)^2 = 4).\n' +
  '  - Parentheses for grouping.\n' +
  '  - Function calls: max(a, b), min(a, b), abs(x). Argument lists ' +
  'are comma-separated.\n' +
  '  - Variable references: looked up in the `vars` map (e.g., evaluate("x+1", {x:10})).\n' +
  '  - Whitespace is ignored between tokens.\n' +
  '  - On invalid input, THROW an Error with a descriptive message:\n' +
  '      • unbalanced parens → message contains "paren"\n' +
  '      • unknown function  → message contains "unknown function" or the func name\n' +
  '      • unknown variable  → message contains "unknown variable" or the var name\n' +
  '      • trailing operator → message contains "unexpected" or "trailing"\n' +
  '      • bad token         → message contains "token", "character", or "invalid"\n' +
  '      • empty input       → message contains "empty", "unexpected", or "input"\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const CLAW_TIMEOUT = 360_000;
const TIMEOUT = CLAW_TIMEOUT + 20_000;

describe(`expression-eval: recursive-descent parser (tier=${TIER_LABEL})`, () => {
  it('claw implements evaluate handling precedence, assoc, errors', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'expression-eval',
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
