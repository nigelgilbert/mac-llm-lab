/** @manifest
 * {
 *   "test_id": "alphametics",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": ["convergence"],
 *   "suite_layer": "D",
 *   "difficulty_band": "frontier",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Frontier reserve. Stays in Layer D unless pilot shows t32 ≥ 30% — then promote to suite_layer B with band hard.",
 *   "expected_tier_signature": "floor",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "Adapted from Exercism JS 'alphametics' (MIT); mutation depth: HEAVY; key changes: assignDigits(equation) not solve(puzzle), result is sorted [{symbol,code}] array not letter→digit map, '=' may appear on either side, non-canonical word sets (no SEND+MORE=MONEY); canonical at host/test/docs/difficulty-pack/canonicals/alphametics/. Cycle 1+2 pilot: floor 0/3 t32 + 0/2 t16 — applied mutations.md §3 mutation-depth gate, dropped '*' extension; addition-only now per canonical. Sprint 1.21 post-cycle-2: relocated to __tests__/tier-eval/frontier/ and reclassified suite_layer B→D, band hard→frontier (capability beyond current Qwen3.5-9B at t16/t32). Held as frontier reserve documenting permutation+constraints failure mode."
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
import { assignDigits } from './alphametics.js';

// Helper: turn the [{symbol,code}] array back into a {sym: code} map for checking
function toMap(result) {
  if (result === null) return null;
  const m = {};
  for (const { symbol, code } of result) m[symbol] = code;
  return m;
}

// Helper: evaluate a word with a given letter→digit map (base 10)
function valueOf(word, m) {
  let v = 0;
  for (const ch of word) v = v * 10 + m[ch];
  return v;
}

// Helper: validate that a returned solution actually satisfies the equation,
// has all-distinct codes, no leading zero on any multi-letter word, and the
// returned array is sorted by symbol.
function validate(result, leftTerms, rightWord) {
  if (result === null) return false;
  const m = toMap(result);
  // sorted by symbol
  const symbols = result.map(r => r.symbol);
  for (let i = 1; i < symbols.length; i++) {
    if (symbols[i] <= symbols[i-1]) return false;
  }
  // distinct codes 0..9
  const codes = result.map(r => r.code);
  if (new Set(codes).size !== codes.length) return false;
  for (const c of codes) if (typeof c !== 'number' || c < 0 || c > 9) return false;
  // no leading zero on multi-letter words
  for (const w of [...leftTerms, rightWord]) {
    if (w.length > 1 && m[w[0]] === 0) return false;
  }
  // arithmetic: simple sum of left terms equals right
  const acc = leftTerms.reduce((sum, w) => sum + valueOf(w, m), 0);
  return acc === valueOf(rightWord, m);
}

// Solvable, addition-only
{
  const r = assignDigits('CAT + DOG = PET');
  assert.ok(validate(r, ['CAT', 'DOG'], 'PET'), 'CAT + DOG = PET solution must satisfy the equation');
}

// Solvable, '=' on the left (anti-recall: canonical Exercism only accepts left-of-=)
{
  const r = assignDigits('PET = CAT + DOG');
  assert.ok(validate(r, ['CAT', 'DOG'], 'PET'), 'reversed = sides must still solve');
}

// Solvable: AS + A = MOM  (small, hand-verified)
// Solution: A=9, S=2, O=0, M=1. Distinct, no multi-letter word leading zero. ✓
{
  const r = assignDigits('AS + A = MOM');
  assert.ok(validate(r, ['AS', 'A'], 'MOM'), 'AS + A = MOM must solve');
}

// Multi-term: A + B + C = ABC  (3-term addition)
// A+B+C = 100A + 10B + C → 99A + 9B = 0 → impossible for A≥1. Unsolvable.
{
  const r = assignDigits('A + B + C = ABC');
  assert.equal(r, null, 'A + B + C = ABC has no base-10 solution');
}

// Unsolvable: IF + IT = IS — no carry config satisfies I in tens column.
{
  const r = assignDigits('IF + IT = IS');
  assert.equal(r, null, 'IF + IT = IS has no base-10 solution');
}

// Whitespace tolerance
{
  const r = assignDigits('  CAT   +   DOG   =   PET  ');
  assert.ok(validate(r, ['CAT', 'DOG'], 'PET'), 'extra whitespace must be tolerated');
}
`;

const PROMPT = `\
Create alphametics.js that exports \`assignDigits(equation)\`.

The function solves a cryptarithmetic puzzle: each distinct letter (uppercase A-Z)
maps to a distinct digit 0-9 such that the arithmetic equation holds in base 10.

Equation grammar:
  <left> = <right>      OR      <right> = <left>

where <right> is a single word (uppercase letters) and <left> is one or more
words connected by '+' (addition only).

Examples:
  "CAT + DOG = PET"
  "PET = CAT + DOG"
  "A + B + C = ABC"

Constraints on a valid solution:
  - Each letter maps to a unique digit 0-9
  - No multi-letter word may have a leading-zero digit
  - The arithmetic must hold

Return value:
  - If a valid solution exists: an array of \`{ symbol, code }\` objects sorted
    ascending by \`symbol\` (e.g. \`[{symbol:'A', code:2}, {symbol:'B', code:3}, ...]\`)
  - If no valid solution exists: \`null\`

Whitespace inside the equation may be uneven; tolerate runs of spaces.

Strategy hint: the equations in the verifier use at most ~7 distinct
letters, so a straightforward backtracking permutation over digits 0-9
(prune on the leading-zero rule and check the equation at each leaf) is
fast enough — you do not need a column-by-column constraint solver.
Aim for a complete-but-simple permutation search before optimizing.

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const CLAW_TIMEOUT = 285_000;

describe(`alphametics: cryptarithmetic with + and * (tier=${TIER_LABEL})`, () => {
  beforeEach(() => {
    workspace.reset();
    fs.writeFileSync(path.join(workspace.WORKSPACE, 'verify.js'), VERIFY_JS);
  });

  it('claw solves the task', { timeout: CLAW_TIMEOUT + 20_000 }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});

    const targetExists = workspace.exists('alphametics.js');
    let post = null;
    if (r.code === 0 && targetExists) {
      post = spawnSync('node', [path.join(workspace.WORKSPACE, 'verify.js')], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    }
    const passed = r.code === 0 && targetExists && post?.status === 0;

    console.log(`\n=== alphametics (${TIER_LABEL}) ===`);
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
    assert.equal(targetExists, true, 'alphametics.js must be created');
    assert.equal(post?.status, 0, `verify.js failed:\n${post?.stderr?.slice(0, 800)}`);
  });
});
