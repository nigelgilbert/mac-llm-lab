// Twelve helpers across twelve files with cross-file dependencies.
//
// Renamed-in-spirit from eight-functions per loop-1 pilot finding (10/10 pass
// at n=5 — too easy at tier-64). Loop-2 redesign per plan §P3.1's escape hatch:
// increase function count to 12 AND add intra-context dependencies (4 of the
// 12 functions are implemented in terms of others, with explicit cross-file
// imports required).
//
// Difficulty knob: it's no longer "twelve trivial functions in twelve files";
// it's "eight leaf functions plus four functions that import from leaves and
// must wire those imports correctly." A model that forgets to add
// `import { clamp } from './clamp.js'` to safeIndex.js produces a runtime
// ReferenceError when verify.js is executed — and the verify-loop has to
// figure out which of the 12 files needs editing.
//
// Predicted dominant class: A or C — pilot will tell. C-class would manifest
// as the model losing track of which file it's in mid-iteration; A-class
// as repeated edit-verify cycles on the dependent files.

/** @manifest
 * {
 *   "test_id": "eight-functions",
 *   "test_version": "v1",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1; redesigned in loop-2 to add cross-file deps).",
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

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { pad }         from './pad.js';
import { clamp }       from './clamp.js';
import { unique }      from './unique.js';
import { chunk }       from './chunk.js';
import { flatten }     from './flatten.js';
import { omit }        from './omit.js';
import { pick }        from './pick.js';
import { compact }     from './compact.js';
import { safeIndex }   from './safeIndex.js';
import { formatHex }   from './formatHex.js';
import { sortedKeys }  from './sortedKeys.js';
import { deepFlatten } from './deepFlatten.js';

// --- 8 leaf functions ---
assert.equal(pad('5', 3),                 '005',     'pad to 3 with 0');
assert.equal(pad('123', 5, '*'),          '**123',   'pad with *');
assert.equal(clamp(5, 0, 10),              5,        'clamp in range');
assert.equal(clamp(-1, 0, 10),             0,        'clamp below min');
assert.equal(clamp(11, 0, 10),            10,        'clamp above max');
assert.deepEqual(unique([1, 2, 2, 3, 1]), [1, 2, 3], 'unique preserves order');
assert.deepEqual(unique([]),              [],        'unique empty');
assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], 'chunk leaves remainder');
assert.deepEqual(chunk([],              2), [],                     'chunk empty');
assert.deepEqual(flatten([1, [2, 3], 4]),     [1, 2, 3, 4],     'flatten one level');
assert.deepEqual(flatten([1, [2, [3, 4]]]),   [1, 2, [3, 4]],   'flatten only one level deep');
assert.deepEqual(omit({ a: 1, b: 2, c: 3 }, ['b']),      { a: 1, c: 3 }, 'omit one');
assert.deepEqual(omit({ a: 1, b: 2, c: 3 }, ['a', 'c']), { b: 2 },       'omit multiple');
assert.deepEqual(pick({ a: 1, b: 2, c: 3 }, ['a', 'c']), { a: 1, c: 3 }, 'pick subset');
assert.deepEqual(pick({ a: 1, b: 2 },       ['c']),      {},             'pick absent');
assert.deepEqual(compact([1, 0, 2, '', 3, null, 4, undefined, false]),
                 [1, 2, 3, 4],                                            'compact removes falsy');
assert.deepEqual(compact([0, 0, 0]),    [],          'compact all falsy');

// --- 4 dependent functions (each imports from a leaf) ---
// safeIndex imports clamp: returns arr[clamp(i, 0, arr.length - 1)].
assert.equal(safeIndex(['a', 'b', 'c'], 1),    'b',  'safeIndex in range');
assert.equal(safeIndex(['a', 'b', 'c'], -5),   'a',  'safeIndex below clamps to 0');
assert.equal(safeIndex(['a', 'b', 'c'], 99),   'c',  'safeIndex above clamps to last');

// formatHex imports pad: returns hex string left-padded to 4 chars with '0'.
assert.equal(formatHex(5),     '0005',  'formatHex small');
assert.equal(formatHex(255),   '00ff',  'formatHex 255 (lowercase hex)');
assert.equal(formatHex(4096),  '1000',  'formatHex 4096');

// sortedKeys imports unique: returns Object.keys sorted, dedup via unique.
assert.deepEqual(sortedKeys({ b: 1, a: 2, c: 3 }), ['a', 'b', 'c'], 'sortedKeys sorts');
assert.deepEqual(sortedKeys({}),                   [],              'sortedKeys empty');

// deepFlatten imports flatten: applies flatten until fully flat.
assert.deepEqual(deepFlatten([1, [2, [3, [4]]]]), [1, 2, 3, 4], 'deepFlatten fully flattens');
assert.deepEqual(deepFlatten([[[1, 2]], [3]]),    [1, 2, 3],    'deepFlatten nested');
`;

const PROMPT =
  'Implement these twelve helpers, each in its own file. Use NAMED exports ' +
  '(e.g. `export function pad(...)`). Eight are leaf utilities; four import ' +
  'from leaves and must wire those imports correctly.\n\n' +
  'Leaves:\n' +
  '  - pad.js     — `pad(s, len, char = "0")`: left-pad string `s` to length `len`.\n' +
  '  - clamp.js   — `clamp(n, min, max)`: clamp number to inclusive [min, max].\n' +
  '  - unique.js  — `unique(arr)`: dedupe preserving first-seen order.\n' +
  '  - chunk.js   — `chunk(arr, size)`: split into arrays of length `size`.\n' +
  '  - flatten.js — `flatten(arr)`: flatten exactly one level.\n' +
  '  - omit.js    — `omit(obj, keys)`: object without listed keys.\n' +
  '  - pick.js    — `pick(obj, keys)`: object with only listed keys.\n' +
  '  - compact.js — `compact(arr)`: array with falsy values removed.\n\n' +
  'Dependent helpers (each MUST import from the named leaf):\n' +
  '  - safeIndex.js   — `safeIndex(arr, i)`: imports `clamp` from clamp.js, ' +
  'returns `arr[clamp(i, 0, arr.length - 1)]`.\n' +
  '  - formatHex.js   — `formatHex(n)`: imports `pad` from pad.js, returns ' +
  '`pad(n.toString(16), 4)` (lowercase hex, padded to 4 chars with "0").\n' +
  '  - sortedKeys.js  — `sortedKeys(obj)`: imports `unique` from unique.js, ' +
  'returns the object\'s keys sorted alphabetically and deduped via unique.\n' +
  '  - deepFlatten.js — `deepFlatten(arr)`: imports `flatten` from flatten.js, ' +
  'applies flatten repeatedly until the array contains no nested arrays.\n\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 240_000;

const TARGETS = [
  'pad.js', 'clamp.js', 'unique.js', 'chunk.js',
  'flatten.js', 'omit.js', 'pick.js', 'compact.js',
  'safeIndex.js', 'formatHex.js', 'sortedKeys.js', 'deepFlatten.js',
];

describe(`eight-functions: 12 helpers with cross-file deps (tier=${TIER_LABEL})`, () => {
  it('claw implements all twelve helpers with correct cross-file imports', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'eight-functions',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
    const targetsPresent = TARGETS.map(f => ctx.workspace.exists(f));
    const allTargetsExist = targetsPresent.every(Boolean);
    assert.equal(allTargetsExist, true,
      `missing target files: ${TARGETS.filter((f, i) => !targetsPresent[i]).join(', ')}`);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
