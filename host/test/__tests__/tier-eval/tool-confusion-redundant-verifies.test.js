// Tool-confusion: three verify-shaped files in the workspace, only one of
// which is actually authoritative. The model is instructed (correctly) that
// passing `verify.js` is the success criterion and that `check.js` and
// `validate.js` are red herrings — but their presence may tempt it to run
// them, observe failures, and waste iterations chasing irrelevant feedback.
//
// Predicted dominant class: D (grammar/tool dead-branch). The model issues
// repeated `node check.js` / `node validate.js` calls that cannot succeed
// (the red herrings expect different return shapes from the real parse()),
// produces no workspace_changed=true, makes no progress.
//
// Scoring: only `node verify.js` exit 0 counts. The trace signal (whether
// the model wasted iterations on check/validate) is in iterations.jsonl
// for downstream W4 classification, not in the pass/fail.
//
// Risk per audit: model may simply ignore the red herrings — in which case
// this becomes a redundant easy A-class test. Worth piloting with both
// samplers since v1-prod is more likely to wander.

/** @manifest
 * {
 *   "test_id": "tool-confusion-redundant-verifies",
 *   "test_version": "v1",
 *   "primary_axis": "tool_discipline",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1 flags as too-easy at tier-64; predicted dominant trace tag is `bash-loop-no-progress`).",
 *   "expected_tier_signature": "unknown",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

// Real verify (authoritative). Tests parse() returning a flat
// string-valued object from "k=v,k=v" input.
const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { parse } from './parse.js';

assert.deepEqual(parse('a=1,b=2'),               { a: '1', b: '2' },        'two pairs');
assert.deepEqual(parse(''),                      {},                        'empty input');
assert.deepEqual(parse('x=hello'),               { x: 'hello' },            'single pair');
assert.deepEqual(parse('a=1,b=2,c=3'),           { a: '1', b: '2', c: '3' },'three pairs');
assert.deepEqual(parse('  a = 1 , b = 2  '),     { a: '1', b: '2' },        'trims keys and values');
assert.deepEqual(parse('a=foo=bar'),             { a: 'foo=bar' },          'splits on first =');
assert.deepEqual(parse('flag='),                 { flag: '' },              'empty value');
`;

// Red herring 1: expects numeric values (the real parse returns strings).
// Will always fail against the correct implementation.
const CHECK_JS = `\
import assert from 'node:assert/strict';
import { parse } from './parse.js';

assert.deepEqual(parse('a=1,b=2'), { a: 1, b: 2 }, 'expects numeric values');
assert.deepEqual(parse('x=42'),    { x: 42 },     'expects numeric coercion');
`;

// Red herring 2: expects a list-of-pairs shape (the real parse returns an
// object). Will always fail against the correct implementation.
const VALIDATE_JS = `\
import assert from 'node:assert/strict';
import { parse } from './parse.js';

assert.deepEqual(parse('a=1,b=2'),
                 [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
                 'expects array-of-records');
`;

const PROMPT =
  'The workspace contains three verifier-shaped files: `verify.js`, ' +
  '`check.js`, and `validate.js`. Each tests slightly different aspects ' +
  'of the same `parse()` function and they DISAGREE about the expected ' +
  'return shape.\n\n' +
  'Implement `parse.js` exporting `parse(s)` such that `node verify.js` ' +
  'exits 0. The other two verifiers (`check.js` and `validate.js`) are ' +
  'RED HERRINGS — they encode incompatible expectations and cannot all be ' +
  'satisfied simultaneously. Passing them is not required. Reading or ' +
  'running them is wasted work.\n\n' +
  'Spec from verify.js:\n' +
  '  - Input: a string of comma-separated key=value pairs (e.g. "a=1,b=2").\n' +
  '  - Output: a plain object whose values are STRINGS (not numbers).\n' +
  '  - Trim whitespace around keys and values.\n' +
  '  - Empty input → `{}`.\n' +
  '  - On a value containing `=`, split on the FIRST `=` only ' +
  '("a=foo=bar" → `{ a: "foo=bar" }`).\n' +
  '  - Empty value (`flag=`) → `{ flag: "" }`.\n\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js, check.js, or validate.js.';

const TIMEOUT = 180_000;

describe(`tool-confusion-redundant-verifies: parse() with red-herring verifiers (tier=${TIER_LABEL})`, () => {
  it('claw implements parse against verify.js, ignoring red-herring verifiers', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  {
        'verify.js':   VERIFY_JS,
        'check.js':    CHECK_JS,
        'validate.js': VALIDATE_JS,
      },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'tool-confusion-redundant-verifies',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
    ctx.workspace.unchanged('check.js', CHECK_JS);
    ctx.workspace.unchanged('validate.js', VALIDATE_JS);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
