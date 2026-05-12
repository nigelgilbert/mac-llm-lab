/** @manifest
 * {
 *   "test_id": "forth",
 *   "test_version": "v1",
 *   "primary_axis": "stateful_logic",
 *   "secondary_axes": ["spec_precision"],
 *   "suite_layer": "D",
 *   "difficulty_band": "frontier",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Frontier reserve. Stays in Layer D unless pilot shows t32 ≥ 30% — then promote to suite_layer B with band hard.",
 *   "expected_tier_signature": "floor",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "Adapted from Exercism JS 'forth' (MIT); mutation depth: STANDARD; key changes: class StackMachine with run(program)+state getter (not Forth+evaluate+stack), def/end syntax (not :/;), MOD operator added, OVER operator dropped, state returns number[] (not space-joined string). Word-redefinition parse-time semantic preserved (the canonical correctness trap). Cycle 1+2 floored 0/0 — snapshot showed model thrashing on case-insensitivity dispatch (canonicalize-on-lookup hint did not break the floor). Sprint 1.21 post-cycle-2: relocated to __tests__/tier-eval/frontier/ and reclassified suite_layer B→D, band hard→frontier. Held as frontier reserve documenting case-folding-dispatch + stack-machine failure mode."
 * }
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runClaw, writeAssertionResult } from '../../../lib/claw.js';
import * as workspace from '../../../lib/workspace.js';
import { clawModel, TIER_LABEL } from '../../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { StackMachine } from './forth.js';

function run(program) {
  const m = new StackMachine();
  m.run(program);
  return m.state;
}

// Numbers push onto the stack
assert.deepEqual(run('1 2 3'), [1, 2, 3], 'numbers push');
assert.deepEqual(run(''), [], 'empty program');

// Arithmetic
assert.deepEqual(run('1 2 +'), [3], 'addition');
assert.deepEqual(run('5 3 -'), [2], 'subtraction');
assert.deepEqual(run('4 6 *'), [24], 'multiplication');
assert.deepEqual(run('15 4 /'), [3], 'integer division (floor)');
assert.deepEqual(run('-7 2 /'), [-4], 'negative integer division: Math.floor(-7/2) = -4');

// MOD operator (new — replaces OVER from canonical)
assert.deepEqual(run('7 3 MOD'), [1], 'modulo');
assert.deepEqual(run('10 4 MOD'), [2], 'modulo non-zero');
assert.deepEqual(run('8 4 MOD'), [0], 'modulo even divisor');

// Stack manipulation: DUP, DROP, SWAP (note: OVER is NOT supported here)
assert.deepEqual(run('5 DUP'), [5, 5], 'DUP duplicates top');
assert.deepEqual(run('5 6 DROP'), [5], 'DROP removes top');
assert.deepEqual(run('1 2 SWAP'), [2, 1], 'SWAP exchanges top two');

// Case-insensitivity for built-in words
assert.deepEqual(run('5 dup'), [5, 5], 'lowercase DUP');
assert.deepEqual(run('1 2 swap'), [2, 1], 'lowercase SWAP');

// User-defined words via def ... end
assert.deepEqual(run('def square dup * end 5 square'), [25], 'def square as dup *');
assert.deepEqual(run('def double 2 * end 7 double'), [14], 'def double');
assert.deepEqual(run('DEF SQUARE DUP * END 4 square'), [16], 'def is case-insensitive');

// Multiple definitions
assert.deepEqual(
  run('def square dup * end def cube dup square * end 3 cube'),
  [27],
  'cube uses square'
);

// Word redefinition: + means - after redefinition (later assertion uses it)
assert.deepEqual(run('def + - end 5 3 +'), [2], 'redefining + as - applies after def');

// Parse-time binding semantic: a definition uses the meaning of words
// AT THE TIME OF DEFINITION, not at execution time.
// foo means "+", then + is redefined to "-", but foo still means "+".
assert.deepEqual(
  run('def foo + end def + - end 5 3 foo'),
  [8],
  'foo bound to + at parse time, survives later redefinition of +'
);

// Non-empty stack persists across run() calls? No — each new StackMachine starts fresh.
// But within one run, state accumulates.
{
  const m = new StackMachine();
  m.run('1 2');
  m.run('+');
  assert.deepEqual(m.state, [3], 'multiple run() calls share state on same instance');
}

// Errors: unknown word
assert.throws(() => run('foo'), /unknown|undefined|invalid/i, 'unknown word throws');

// Errors: stack underflow
assert.throws(() => run('+'), /stack|empty|underflow/i, '+ on empty stack throws');
assert.throws(() => run('1 +'), /stack|empty|underflow|one/i, '+ with one operand throws');
`;

const PROMPT = `\
Create forth.js that exports a class \`StackMachine\` implementing a small
stack-based interpreter inspired by Forth.

The class exposes:
  - \`run(program)\` — parse and execute the program string
  - \`state\` getter — returns the current stack as an array of numbers
                      (bottom of stack first, top of stack last)

Syntax:
  - Programs are whitespace-separated tokens.
  - Numeric literals (including negatives like \`-7\`) push onto the stack.
  - Built-in words operate on the stack:
      +     (a b -- a+b)
      -     (a b -- a-b)
      *     (a b -- a*b)
      /     (a b -- floor(a/b))   integer division, floor toward -∞
      MOD   (a b -- a mod b)      remainder; sign matches Math.floor((a/b))-pair
      DUP   (a -- a a)
      DROP  (a --)
      SWAP  (a b -- b a)
  - User-defined words use:    \`def <name> <body...> end\`
  - All words are case-insensitive — both built-in (DUP, dup, Dup, MOD,
    mod, def, DEF, end, END) and user-defined (\`def Square ...\` may be
    invoked as \`square\` or \`SQUARE\`). The simplest implementation is to
    canonicalize each token to lowercase (or uppercase) when looking it
    up in your dictionaries.

Word-redefinition semantic (the key correctness rule):
  A user definition captures the meaning of every word in its body
  AT DEFINITION TIME. Later redefinitions of those words do NOT change
  the behaviour of an already-defined word.
  Example:
    def foo + end       → foo is bound to addition
    def + - end          → + is now subtraction
    5 3 foo              → still 8 (not 2)

State persistence:
  Multiple calls to run() on the same instance accumulate on the same stack.

Errors:
  - Unknown word throws an Error.
  - Insufficient operands (stack underflow) throws an Error.

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const CLAW_TIMEOUT = 285_000;

describe(`forth: stack interpreter with def/end and parse-time binding (tier=${TIER_LABEL})`, () => {
  beforeEach(() => {
    workspace.reset();
    fs.writeFileSync(path.join(workspace.WORKSPACE, 'verify.js'), VERIFY_JS);
  });

  it('claw solves the task', { timeout: CLAW_TIMEOUT + 20_000 }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});

    const targetExists = workspace.exists('forth.js');
    let post = null;
    if (r.code === 0 && targetExists) {
      post = spawnSync('node', [path.join(workspace.WORKSPACE, 'verify.js')], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    }
    const passed = r.code === 0 && targetExists && post?.status === 0;

    console.log(`\n=== forth (${TIER_LABEL}) ===`);
    console.log(`  claw: exit=${r.code} elapsed=${r.elapsedMs}ms files=${JSON.stringify(workspace.list())}`);
    if (r.code !== 0) console.log(`  claw stderr (tail):\n${r.stderr.slice(-1500)}`);
    if (post) console.log(`  verify: exit=${post.status} stderr=${post.stderr.slice(0, 400).trim()}`);

    writeAssertionResult(r.runDir, {
      passed,
      claw_exit: r.code,
      target_file_exists: targetExists,
      post_status: post?.status ?? null,
      post_stderr_tail: post?.stderr?.slice(0, 800) ?? null,
    });

    if (r.terminal_status === 'timeout') assert.fail(`claw timed out after ${r.elapsedMs}ms`);

    assert.equal(r.code, 0, 'claw must exit cleanly');
    assert.equal(targetExists, true, 'forth.js must be created');
    assert.equal(post?.status, 0, `verify.js failed:\n${post?.stderr?.slice(0, 800)}`);
  });
});
