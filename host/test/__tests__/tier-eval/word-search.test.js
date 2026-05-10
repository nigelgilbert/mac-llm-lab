/** @manifest
 * {
 *   "test_id": "word-search",
 *   "test_version": "v2.1",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": ["spec_precision", "tool_discipline"],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps. Promote to ctx_discriminator class (R9-A) if t16 ctx-overflow ≥66% AND t32 pass ≥66% across two consecutive sweeps.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "v2.1 cycle-15 — strengthens v2 (which saturated at 7 iters in c14) with: (a) DUAL anchor rule (both prefix-of-begin and suffix-of-finish must equal target's prefix/suffix anchors), (b) ARRAY return type (return all placements matching both rules per target, not just the unique one), (c) canonical sort by (begin.row, begin.col), (d) empty array (not null) for absent matches. Multiple placements per target satisfy each rule individually; only some satisfy both. Forces enumerate-all + multi-filter + sort, defeating greedy first-match. Each target has 4-5 placements; 1-3 satisfy both anchors. One target (FROST) has 0 placements satisfying both → []. anchors.json schema now: { TARGET: { prefix: 'P', suffix: 'S' } }. Construction-time sanity asserts the engineered match counts."
 * }
 */

// What:  Implement locate(grid, targets, anchors) on a 40x40 word-search
//        grid. For each target, return ALL placements where (a) the cell
//        immediately BEFORE `begin` equals anchors[target].prefix AND
//        (b) the cell immediately AFTER `finish` equals anchors[target].suffix.
//        Results sorted canonically by (begin.row, begin.col); [] for
//        targets with zero matches. One of the five targets (FROST) is
//        deliberately constructed to have zero anchor-matching placements.
//
// Why:   Weak monotonic tier discriminator, debug-capacity class (c21 N=3:
//        t16 2/3, t64 3/3 — and the single t16 fail was the SSE deadlock
//        documented in usability-pack/memos/bridge-sse-deadlock.md, NOT a
//        difficulty signal; true t16 fail rate is closer to 1/3). v1
//        saturated at 7 iters; v2.1 hardens against three saturation
//        strategies at once:
//          1) Dual prefix+suffix anchors (a single-anchor solution misses
//             ~half the placements).
//          2) Array return + canonical sort (greedy first-match is wrong).
//          3) An engineered zero-match target ([]) — null/throw shortcuts fail.
//        Primary axis: multi_file_context (grid + anchors.json schema).
//        See difficulty-pack/good-tests.md row 4.

import { describe, it } from 'node:test';
import crypto from 'node:crypto';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

// Pinned: bumping invalidates prior cycle runs. If buildBoard() throws at
// module-load (placement loop exhausted, or dual-anchor sanity mismatch),
// the per-test SIGKILL wrapper surfaces it as registry terminal_status=
// harness_error — not 'error' — because import never finished.
const VERSION_SEED = 'word-search-v2.1-2026-05-03-seed-m4r8t';

const ROWS = 40;
const COLS = 40;

// 5 targets: 4 are anchored (multiple placements may satisfy both prefix+suffix
// anchors; locate must return ALL of them sorted), 1 (FROST) has zero placements
// satisfying both anchors → returns [].
const TARGETS = ['NORTH', 'GLOBE', 'TIDAL', 'CRISP', 'FROST'];
const NULL_TARGET = 'FROST';

// Dual anchor letters per target: prefix is the cell IMMEDIATELY BEFORE `begin`
// in the search direction, suffix is the cell IMMEDIATELY AFTER `finish`. Both
// must match for a placement to count.
const ANCHORS = {
  NORTH: { prefix: 'P', suffix: 'X' },
  GLOBE: { prefix: 'D', suffix: 'M' },
  TIDAL: { prefix: 'L', suffix: 'K' },
  CRISP: { prefix: 'F', suffix: 'Q' },
  FROST: { prefix: 'V', suffix: 'W' },
};

// Distractor alphabet excludes ALL prefix and suffix anchor letters so that
// accidental anchor-cell coincidences can only come from engineered placements.
const ANCHOR_LETTERS = new Set();
for (const a of Object.values(ANCHORS)) { ANCHOR_LETTERS.add(a.prefix); ANCHOR_LETTERS.add(a.suffix); }
const FULL_ALPHABET = 'ABCDEFGHIJKLMNOPRSTUVWXYZ';
const DISTRACTOR_ALPHABET = FULL_ALPHABET.split('').filter(ch => !ANCHOR_LETTERS.has(ch)).join('');

// Deterministic PRNG: returns an integer in [0, 2^31) from sha256(SEED || label)
function prngInt(label) {
  const h = crypto.createHash('sha256').update(VERSION_SEED + ':' + label).digest('hex');
  return parseInt(h.slice(0, 8), 16);
}

// Direction encoding:
//   LR: row equal, finish.col > begin.col
//   RL: row equal, finish.col < begin.col
//   TB: col equal, finish.row > begin.row
//   BT: col equal, finish.row < begin.row
const DIRS = ['LR', 'RL', 'TB', 'BT'];

// For a placement, return the cell address one step past `finish` in the
// search direction, or null if off-grid.
function nextAfterFinish(begin, finish, dir) {
  let r = finish.row, c = finish.col;
  if (dir === 'LR') c += 1;
  else if (dir === 'RL') c -= 1;
  else if (dir === 'TB') r += 1;
  else if (dir === 'BT') r -= 1;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return [r, c];
}

// For a placement, return the cell address one step BEFORE `begin` in the
// search direction (opposite of nextAfterFinish), or null if off-grid.
function prevBeforeBegin(begin, finish, dir) {
  let r = begin.row, c = begin.col;
  if (dir === 'LR') c -= 1;
  else if (dir === 'RL') c += 1;
  else if (dir === 'TB') r -= 1;
  else if (dir === 'BT') r += 1;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return [r, c];
}

// Compute the cells (in order) for a placement of `word` at (begin, dir).
function cellsFor(word, begin, dir) {
  const cells = [];
  for (let i = 0; i < word.length; i++) {
    let r = begin.row, c = begin.col;
    if (dir === 'LR') c += i;
    else if (dir === 'RL') c -= i;
    else if (dir === 'TB') r += i;
    else if (dir === 'BT') r -= i;
    cells.push([r, c]);
  }
  return cells;
}

// Generate a random placement (begin, finish, dir) for `word` such that all
// cells are in-bounds. Uses prngInt with a unique label per attempt.
function tryPlacement(word, label) {
  const dir = DIRS[prngInt(label + '_dir') % 4];
  const len = word.length;
  let begin, finish;
  if (dir === 'LR') {
    const r = prngInt(label + '_r') % ROWS;
    const c = prngInt(label + '_c') % (COLS - len + 1);
    begin = { row: r, col: c };
    finish = { row: r, col: c + len - 1 };
  } else if (dir === 'RL') {
    const r = prngInt(label + '_r') % ROWS;
    const beginCol = (prngInt(label + '_c') % (COLS - len + 1)) + len - 1;
    begin = { row: r, col: beginCol };
    finish = { row: r, col: beginCol - len + 1 };
  } else if (dir === 'TB') {
    const beginRow = prngInt(label + '_r') % (ROWS - len + 1);
    const c = prngInt(label + '_c') % COLS;
    begin = { row: beginRow, col: c };
    finish = { row: beginRow + len - 1, col: c };
  } else {
    const beginRow = (prngInt(label + '_r') % (ROWS - len + 1)) + len - 1;
    const c = prngInt(label + '_c') % COLS;
    begin = { row: beginRow, col: c };
    finish = { row: beginRow - len + 1, col: c };
  }
  return { begin, finish, dir };
}

// Find ALL placements of `word` in `board` across the 4 directions.
// Used by the construction-time sanity check and for computing the verifier's
// expected truth from the actual board.
function findAllPlacements(board, word) {
  const placements = [];
  const len = word.length;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // LR
      if (c + len <= COLS) {
        let ok = true;
        for (let i = 0; i < len; i++) if (board[r][c + i] !== word[i]) { ok = false; break; }
        if (ok) placements.push({
          begin: { row: r, col: c }, finish: { row: r, col: c + len - 1 }, dir: 'LR',
        });
      }
      // RL: word reads right-to-left starting at (r, c) going left
      if (c - len + 1 >= 0) {
        let ok = true;
        for (let i = 0; i < len; i++) if (board[r][c - i] !== word[i]) { ok = false; break; }
        if (ok) placements.push({
          begin: { row: r, col: c }, finish: { row: r, col: c - len + 1 }, dir: 'RL',
        });
      }
      // TB
      if (r + len <= ROWS) {
        let ok = true;
        for (let i = 0; i < len; i++) if (board[r + i][c] !== word[i]) { ok = false; break; }
        if (ok) placements.push({
          begin: { row: r, col: c }, finish: { row: r + len - 1, col: c }, dir: 'TB',
        });
      }
      // BT
      if (r - len + 1 >= 0) {
        let ok = true;
        for (let i = 0; i < len; i++) if (board[r - i][c] !== word[i]) { ok = false; break; }
        if (ok) placements.push({
          begin: { row: r, col: c }, finish: { row: r - len + 1, col: c }, dir: 'BT',
        });
      }
    }
  }
  return placements;
}

// Pick a deterministic letter from DISTRACTOR_ALPHABET that isn't any anchor
// letter (already enforced by alphabet exclusion, but kept defensive).
function pickDistractor(label) {
  for (let k = 0; k < 30; k++) {
    const ch = DISTRACTOR_ALPHABET[prngInt(`${label}_${k}`) % DISTRACTOR_ALPHABET.length];
    if (!ANCHOR_LETTERS.has(ch)) return ch;
  }
  throw new Error('pickDistractor: exhausted attempts');
}

// Build the board: each non-null target gets 4 placements with both prefix and
// suffix cells on-grid; PRNG selects which placements are "valid" (have both
// anchor letters set), the rest get exactly one anchor side or neither (never
// both, so they don't accidentally pass the dual-anchor filter).
function buildBoard() {
  const board = []; for (let r = 0; r < ROWS; r++) board.push(Array(COLS).fill(null));
  const used = new Set();
  const engineeredValid = {}; // target → array of {begin, finish}

  for (const target of TARGETS) {
    const isNullTarget = (target === NULL_TARGET);
    const desired = 4;
    const accepted = [];

    let attempt = 0;
    while (accepted.length < desired && attempt < 800) {
      attempt++;
      const p = tryPlacement(target, `${target}_p${accepted.length}_a${attempt}`);
      const cells = cellsFor(target, p.begin, p.dir);
      const cellKeys = cells.map(([r, c]) => `${r},${c}`);
      if (cellKeys.some(k => used.has(k))) continue;
      const next = nextAfterFinish(p.begin, p.finish, p.dir);
      const prev = prevBeforeBegin(p.begin, p.finish, p.dir);
      // Require BOTH prefix-cell and suffix-cell on-grid so that we can fully
      // control which anchor sides are populated.
      if (!next || !prev) continue;
      const nextKey = `${next[0]},${next[1]}`;
      const prevKey = `${prev[0]},${prev[1]}`;
      if (nextKey === prevKey) continue; // degenerate (shouldn't happen with len>=2)
      if (used.has(nextKey) || used.has(prevKey)) continue;
      if (cellKeys.includes(nextKey) || cellKeys.includes(prevKey)) continue;
      accepted.push({ ...p, cells, cellKeys, next, nextKey, prev, prevKey });
    }
    if (accepted.length < desired) {
      throw new Error(`buildBoard: could not place ${desired} placements for ${target} (got ${accepted.length})`);
    }

    // Decide per-placement which anchor sides are populated.
    //   - validIdxs: placements that get BOTH prefix and suffix → counted as "valid"
    //   - other placements get EXACTLY ONE side or NEITHER (never both)
    // Per-target valid count: for non-null targets, 1, 2, or 3 (PRNG-driven).
    //                         For null target: 0.
    let validCount;
    if (isNullTarget) {
      validCount = 0;
    } else {
      validCount = 1 + (prngInt(`${target}_valid_count`) % 3); // 1..3
    }
    const idxOrder = [0, 1, 2, 3].sort(
      (a, b) => prngInt(`${target}_idx_order_${a}`) - prngInt(`${target}_idx_order_${b}`));
    const validSet = new Set(idxOrder.slice(0, validCount));

    for (let i = 0; i < accepted.length; i++) {
      const p = accepted[i];
      // Place target letters
      for (let j = 0; j < target.length; j++) {
        const [r, c] = p.cells[j];
        board[r][c] = target[j];
        used.add(p.cellKeys[j]);
      }
      const ap = ANCHORS[target].prefix;
      const as = ANCHORS[target].suffix;
      if (validSet.has(i)) {
        // Place BOTH anchors
        board[p.prev[0]][p.prev[1]] = ap;
        board[p.next[0]][p.next[1]] = as;
        used.add(p.prevKey); used.add(p.nextKey);
      } else {
        // Place at most one side. PRNG chooses: 0=neither, 1=prefix-only, 2=suffix-only.
        const sideChoice = prngInt(`${target}_side_${i}`) % 3;
        if (sideChoice === 1) {
          board[p.prev[0]][p.prev[1]] = ap;
          // suffix gets a non-anchor letter (defensive: also not the prefix anchor)
          board[p.next[0]][p.next[1]] = pickDistractor(`${target}_nx_${i}`);
        } else if (sideChoice === 2) {
          board[p.next[0]][p.next[1]] = as;
          board[p.prev[0]][p.prev[1]] = pickDistractor(`${target}_pv_${i}`);
        } else {
          board[p.prev[0]][p.prev[1]] = pickDistractor(`${target}_pv0_${i}`);
          board[p.next[0]][p.next[1]] = pickDistractor(`${target}_nx0_${i}`);
        }
        used.add(p.prevKey); used.add(p.nextKey);
      }
    }

    // Record engineered-valid placements (for sanity check; the verifier truth
    // is computed from the final board to cover any accidental matches).
    engineeredValid[target] = isNullTarget ? [] : accepted
      .map((p, i) => validSet.has(i) ? { begin: p.begin, finish: p.finish } : null)
      .filter(x => x !== null);
  }

  // Fill remaining cells with distractor letters (no anchor letters appear).
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === null) {
        const ch = DISTRACTOR_ALPHABET[prngInt(`fill_${r}_${c}`) % DISTRACTOR_ALPHABET.length];
        board[r][c] = ch;
      }
    }
  }

  // Construction-time sanity: enumerate ALL placements of each target in the
  // final board, count those satisfying BOTH prefix+suffix anchors. Assert this
  // matches the engineered valid count.
  const truth = {};
  for (const target of TARGETS) {
    const all = findAllPlacements(board, target);
    const matches = [];
    const ap = ANCHORS[target].prefix;
    const as = ANCHORS[target].suffix;
    for (const p of all) {
      const nx = nextAfterFinish(p.begin, p.finish, p.dir);
      const pv = prevBeforeBegin(p.begin, p.finish, p.dir);
      if (!nx || !pv) continue;
      if (board[nx[0]][nx[1]] !== as) continue;
      if (board[pv[0]][pv[1]] !== ap) continue;
      matches.push({ begin: p.begin, finish: p.finish });
    }
    matches.sort((a, b) => a.begin.row - b.begin.row || a.begin.col - b.begin.col);
    if (target === NULL_TARGET) {
      if (matches.length !== 0) {
        throw new Error(`buildBoard sanity: NULL_TARGET ${target} has ${matches.length} dual-anchor matches (expected 0). Re-seed.`);
      }
    } else {
      if (matches.length !== engineeredValid[target].length) {
        throw new Error(`buildBoard sanity: ${target} has ${matches.length} dual-anchor matches in board (engineered ${engineeredValid[target].length}). Re-seed.`);
      }
    }
    truth[target] = matches;
  }

  return { board, truth };
}

const { board: BOARD, truth: TRUTH } = buildBoard();
const BOARD_TXT = BOARD.map(row => row.join('')).join('\n');
const ANCHORS_JSON = JSON.stringify(ANCHORS, null, 2);

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { locate } from './word-search.js';

const expected = ${JSON.stringify(TRUTH, null, 2)};
const targets = ${JSON.stringify(TARGETS)};

const r = locate(targets);

// Returned object has exactly the keys of targets (no extras)
const keys = Object.keys(r).sort();
assert.deepEqual(keys, [...targets].sort(),
  'returned keys must exactly match input targets. expected ' +
  JSON.stringify([...targets].sort()) + ', got ' + JSON.stringify(keys) +
  '; full result ' + JSON.stringify(r));

for (const t of targets) {
  const exp = expected[t];
  const got = r[t];
  assert.ok(Array.isArray(got),
    t + ': value must be an array (use [] for absent). got ' + JSON.stringify(got));
  // Sort the model's output canonically before comparing, since the spec
  // requires sort-by-(begin.row, begin.col) but a forgiving verifier accepts
  // any input order so long as the SET matches.
  const gotSorted = [...got].sort((a, b) => {
    const ar = (a && a.begin) ? a.begin.row : 0;
    const br = (b && b.begin) ? b.begin.row : 0;
    if (ar !== br) return ar - br;
    const ac = (a && a.begin) ? a.begin.col : 0;
    const bc = (b && b.begin) ? b.begin.col : 0;
    return ac - bc;
  });
  assert.deepEqual(gotSorted, exp,
    t + ': expected ' + JSON.stringify(exp) +
    ', got (sorted) ' + JSON.stringify(gotSorted) +
    '; full result ' + JSON.stringify(r));
}

console.log('verify ok');
`;

const PROMPT = `\
Create word-search.js that exports a function \`locate(targets)\`.

Inputs:
  - \`targets\`: an array of strings (uppercase letters) to search for.

Two workspace files are present and must be read:
  - \`./board.txt\`: ${ROWS} lines, each ${COLS} characters of uppercase letters — the grid.
  - \`./anchors.json\`: a JSON object mapping each target string to an object
    of the form { "prefix": "P", "suffix": "S" }, where prefix and suffix are
    single uppercase letters.

Search directions (only these four):
  1. Horizontal left-to-right (LR)
  2. Horizontal right-to-left (RL)
  3. Vertical top-to-bottom (TB)
  4. Vertical bottom-to-top (BT)

Diagonal placements are NOT supported and must be ignored.

Coordinates are 0-indexed using \`{ row, col }\` objects. For each placement
of a target, \`begin\` is the cell of the first letter and \`finish\` is the
cell of the last letter, traced along the search direction. Examples:
  - LR: begin.row === finish.row, finish.col === begin.col + len - 1
  - RL: begin.row === finish.row, finish.col === begin.col - len + 1
  - TB: begin.col === finish.col, finish.row === begin.row + len - 1
  - BT: begin.col === finish.col, finish.row === begin.row - len + 1

DUAL ANCHOR RULE (this is the core of the task):
  Each target word appears MULTIPLE TIMES in the board (in different
  directions and positions). A placement of target T is "valid" if and only
  if BOTH of the following cells exist on-grid AND have the correct letters:
    1. The cell IMMEDIATELY BEFORE \`begin\` (one step opposite to the search
       direction) equals anchors[T].prefix:
         - LR: cell at (begin.row,     begin.col - 1)
         - RL: cell at (begin.row,     begin.col + 1)
         - TB: cell at (begin.row - 1, begin.col)
         - BT: cell at (begin.row + 1, begin.col)
    2. The cell IMMEDIATELY AFTER \`finish\` (one step further along the
       search direction) equals anchors[T].suffix:
         - LR: cell at (finish.row,     finish.col + 1)
         - RL: cell at (finish.row,     finish.col - 1)
         - TB: cell at (finish.row + 1, finish.col)
         - BT: cell at (finish.row - 1, finish.col)
  If EITHER cell is off-grid OR has a different letter, the placement is NOT
  valid. Many placements satisfy only one side; ignore those.

Return value:
  An object whose keys are exactly the input targets. For each target:
    - An ARRAY of all valid placements: \`[{ begin: {row,col}, finish: {row,col} }, ...]\`
      sorted ascending by (begin.row, begin.col).
    - If no placement is valid for a target, return an empty array \`[]\`
      (NOT \`null\`, NOT \`undefined\`).

You MUST enumerate ALL placements of each target across the 4 directions
and filter by BOTH anchor sides. The first placement you find is rarely the
right one — most placements satisfy at most ONE of the two anchor cells.

Construction guarantees (so you can sanity-check your code):
  - Each target appears about 4 times in the board.
  - For 4 of the 5 targets, between 1 and 3 placements satisfy both anchors.
    Return all of them, sorted.
  - For 1 of the 5 targets, NO placement satisfies both anchors. Return [].

Then ensure \`node verify.js\` exits 0. Do not edit verify.js, board.txt, or anchors.json.`;

const CLAW_TIMEOUT = 285_000;

describe(`word-search v2.1: dual-anchor multi-match enumeration (tier=${TIER_LABEL})`, () => {
  it('claw solves the task', { timeout: CLAW_TIMEOUT + 20_000 }, async () => {
    const ctx = await runAgentSetup({
      prompt:     PROMPT,
      seedFiles:  {
        'verify.js':    VERIFY_JS,
        'board.txt':    BOARD_TXT,
        'anchors.json': ANCHORS_JSON,
      },
      postScript: 'verify.js',
      timeoutMs:  CLAW_TIMEOUT,
      testId:  'word-search',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('verify.js', VERIFY_JS);
      ctx.workspace.unchanged('board.txt', BOARD_TXT);
      ctx.workspace.unchanged('anchors.json', ANCHORS_JSON);
    });
  });
});
