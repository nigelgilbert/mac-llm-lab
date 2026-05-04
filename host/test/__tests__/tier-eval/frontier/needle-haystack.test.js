/** @manifest
 * {
 *   "test_id": "needle-haystack",
 *   "test_version": "v4",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": ["tool_discipline"],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps. Promote to ctx_discriminator class (R9-A) if t16 ctx-overflow ≥66% AND t32 pass ≥66% across two consecutive sweeps.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": ["context_pressure_high"],
 *   "introduced_in": "1.21",
 *   "notes": "H5 hand-authored. v4 ambiguous-candidate disambiguation. 30-file synthetic workspace; contents deterministic per VERSION_SEED via sha256 PRNG. Twelve files (4 each) export `REGION_KEY_BOOTSTRAP` (2-char hex), `REGION_INDEX_MAP` (object), or `REGION_LOOKUP_TABLE` (array). The remaining 18 files emit close-name distractors. Only ONE triple (B*, M*, T*) is self-consistent: B*'s value is a key in M*, AND M*[B*] is in [0, T*.length), AND T*[M*[B*]] is a 6-char hex string. The other 63 candidate combinations either short-circuit (B not in M) or land out-of-range. Answer = T*[M*[B*]]. Defeats the v2/v3 grep-and-inline-copy strategy because each grep returns 4 hits with no name-level signal for which is canonical; model must enumerate combinations until self-consistency is found. Distinct from wordy because each file is small (~1.5kb) and the haystack fits in 32k ctx — pressure is on multi-trial composition, not context. v1/v2/v3 all saturated at t16 in 8-25s with 1-3 greps + inline writes."
 * }
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runClaw, writeAssertionResult } from '../../lib/claw.js';
import * as workspace from '../../lib/workspace.js';
import { clawModel, TIER_LABEL } from '../../lib/tier.js';

// Bumping VERSION_SEED rotates REGION_KEY_INDEX, every entry of REGION_LOOKUP_TABLE,
// and every file's deterministic pseudo-random content — breaking any cross-version
// memorization path. Keep the manifest test_version in lockstep with the seed string.
const VERSION_SEED = 'needle-v4-2026-05-03-seed-dh6k2p';

// 30 files distributed across five subdirs. Order is deterministic; the
// three needle files are fixed so the test is reproducible without peeking
// at PRNG output.
const FILES = [
  'lib/utils/format.js',     'lib/utils/validate.js',  'lib/utils/parse.js',
  'lib/utils/normalize.js',  'lib/utils/transform.js', 'lib/utils/encode.js',
  'lib/utils/decode.js',     'lib/utils/hash.js',
  'lib/core/engine.js',      'lib/core/scheduler.js',  'lib/core/registry.js',
  'lib/core/dispatch.js',    'lib/core/lifecycle.js',  'lib/core/runtime.js',
  'lib/handlers/request.js', 'lib/handlers/response.js','lib/handlers/error.js',
  'lib/handlers/retry.js',   'lib/handlers/timeout.js','lib/handlers/auth.js',
  'lib/handlers/session.js',
  'data/seeds.js',           'data/samples.js',         'data/fixtures.js',
  'data/presets.js',         'data/defaults.js',
  'config/env.js',           'config/flags.js',         'config/routes.js',
  'config/limits.js',
];

// v4: FOUR files each export REGION_KEY_BOOTSTRAP / REGION_INDEX_MAP /
// REGION_LOOKUP_TABLE — a single grep returns 4 hits per identifier with no
// name-level signal for which is canonical. Index 0 in each list is the
// canonical pick; the other three are functional decoys (real exports of the
// same shape, but designed so non-canonical chains short-circuit).
// All 12 needle files spread across all five subdirs so a single directory
// listing doesn't reveal the chain.
const BOOTSTRAP_FILES = [
  'lib/utils/format.js',     // canonical: REGION_KEY_BOOTSTRAP value is a key in MAP_FILES[0]
  'lib/core/registry.js',
  'data/seeds.js',
  'config/routes.js',
];
const MAP_FILES = [
  'lib/handlers/session.js', // canonical: contains BOOTSTRAP_FILES[0]'s value as a key → CANONICAL_INDEX
  'lib/utils/parse.js',
  'data/presets.js',
  'config/flags.js',
];
const TABLE_FILES = [
  'lib/core/scheduler.js',   // canonical: length 30, so CANONICAL_INDEX (>=20) is in-bounds only here
  'lib/handlers/auth.js',
  'data/fixtures.js',
  'config/limits.js',
];

// Deterministic per-file PRNG. Returns a 64-char hex string from which we
// slice content fragments; same VERSION_SEED + filepath always returns the
// same hex.
function prngHex(filename) {
  return crypto.createHash('sha256').update(VERSION_SEED + ':' + filename).digest('hex');
}

// Helper for deterministic per-suffix randomness from VERSION_SEED.
function seedHex(suffix) {
  return crypto.createHash('sha256').update(VERSION_SEED + ':' + suffix).digest('hex');
}
function seedInt(suffix, mod) {
  return parseInt(seedHex(suffix).slice(0, 8), 16) % mod;
}

// === Canonical-chain disambiguation parameters ===
// The chain has ONE valid composition. To force this:
//   - All 4 BOOTSTRAP values are distinct 2-char hex.
//   - The canonical MAP (index 0) contains the canonical BOOTSTRAP value as
//     a key, mapping it to CANONICAL_INDEX. None of the other 3 MAPs contain
//     ANY BOOTSTRAP value as a key (their key sets are disjoint from
//     BOOTSTRAP_VALUES). So only (B[0], M[0]) yields a defined int.
//   - The canonical TABLE (index 0) has length 30; the other 3 TABLEs have
//     lengths < CANONICAL_INDEX, so the canonical idx is out-of-bounds for
//     them. So only T[0] yields a defined hex string at the canonical idx.
// Net: of 4*4*4 = 64 candidate triples, exactly ONE returns a 6-char hex.

// CANONICAL_INDEX in [20, 30) ensures it exceeds every distractor table length.
const CANONICAL_INDEX = 20 + seedInt('IDX', 10);
// Distractor table lengths — all < 20, so CANONICAL_INDEX is out-of-bounds.
const DISTRACTOR_T_LENGTHS = [
  8  + seedInt('TLEN0', 4),  //  8..11
  12 + seedInt('TLEN1', 4),  // 12..15
  16 + seedInt('TLEN2', 4),  // 16..19
];

// 4 distinct BOOTSTRAP values — all 2-char hex. The canonical value is
// BOOTSTRAP_VALUES[0]; the other three exist only as decoys.
const BOOTSTRAP_VALUES = (() => {
  const out = [];
  let i = 0;
  while (out.length < 4) {
    const v = seedHex('BOOTSTRAP_' + i).slice(0, 2);
    if (!out.includes(v)) out.push(v);
    i++;
  }
  return out;
})();

// 4 MAPs. Only MAPS[0] (canonical) contains BOOTSTRAP_VALUES[0] as a key.
// All MAPs have 30 entries; non-canonical MAPs use random keys disjoint from
// every BOOTSTRAP value (so M[B] is undefined for any non-canonical chain).
function buildMap(mapIdx) {
  const isCanonical = mapIdx === 0;
  const keys = [];
  if (isCanonical) keys.push(BOOTSTRAP_VALUES[0]);
  let i = 0;
  while (keys.length < 30) {
    const candidate = seedHex('MAP_' + mapIdx + '_KEY_' + i).slice(0, 2);
    if (!BOOTSTRAP_VALUES.includes(candidate) && !keys.includes(candidate)) {
      keys.push(candidate);
    }
    i++;
    if (i > 10000) throw new Error('buildMap: cannot fill keys');
  }
  const obj = {};
  for (let k = 0; k < keys.length; k++) {
    if (isCanonical && k === 0) {
      obj[keys[k]] = CANONICAL_INDEX;
    } else {
      // Non-canonical entries: random ints in [0, 30). Never reached by a
      // valid chain, so values are irrelevant — but they need to look real.
      obj[keys[k]] = parseInt(seedHex('MAP_' + mapIdx + '_VAL_' + k).slice(0, 2), 16) % 30;
    }
  }
  return obj;
}
const MAPS = [0, 1, 2, 3].map(buildMap);

// 4 TABLEs. TABLES[0] is length 30 (canonical); the other 3 are shorter so
// CANONICAL_INDEX is out-of-bounds for them.
function buildTable(tableIdx) {
  const len = tableIdx === 0 ? 30 : DISTRACTOR_T_LENGTHS[tableIdx - 1];
  return Array.from({ length: len }, (_, i) =>
    seedHex('TABLE_' + tableIdx + '_' + i).slice(0, 6),
  );
}
const TABLES = [0, 1, 2, 3].map(buildTable);

// The canonical answer — verifier compares against this.
const REGION_KEY_VALUE = TABLES[0][CANONICAL_INDEX];

// Sanity assertions: keep the design invariants enforced at construction.
{
  const nonCanonicalDefined = [];
  for (let bi = 0; bi < 4; bi++) {
    for (let mi = 0; mi < 4; mi++) {
      for (let ti = 0; ti < 4; ti++) {
        if (bi === 0 && mi === 0 && ti === 0) continue;
        const idx = MAPS[mi][BOOTSTRAP_VALUES[bi]];
        if (idx !== undefined && idx >= 0 && idx < TABLES[ti].length) {
          nonCanonicalDefined.push([bi, mi, ti, TABLES[ti][idx]]);
        }
      }
    }
  }
  if (nonCanonicalDefined.length > 0) {
    throw new Error(
      'v4 invariant violated: non-canonical chain(s) yielded defined values: ' +
      JSON.stringify(nonCanonicalDefined),
    );
  }
  if (typeof REGION_KEY_VALUE !== 'string' || !/^[0-9a-f]{6}$/.test(REGION_KEY_VALUE)) {
    throw new Error('v4 canonical answer is not a 6-char hex: ' + REGION_KEY_VALUE);
  }
}

// Distractor constant names for the 18 non-needle files. Coarse greps
// (`grep -rn REGION_KEY`, `grep -rn REGION_INDEX`, `grep -rn REGION_LOOKUP`)
// return many hits; strict-equality on the full identifier is required.
const DISTRACTOR_NAMES = [
  'REGION_KEY_BOOTSTRAP_DEFAULT', 'REGION_KEY_BOOTSTRAP_FALLBACK', 'REGION_KEY_BOOTSTRAP_PREFIX',
  'REGION_KEY_PREFIX',            'REGION_KEY_DEFAULT',            'REGION_KEY_FALLBACK',
  'REGION_INDEX_MAP_DEFAULT',     'REGION_INDEX_MAP_FALLBACK',     'REGION_INDEX_MAP_PREFIX',
  'REGION_INDEX_DEFAULT',         'REGION_INDEX_FALLBACK',
  'REGION_LOOKUP_TABLE_DEFAULT',  'REGION_LOOKUP_TABLE_FALLBACK',  'REGION_LOOKUP_PREFIX',
  'REGION_LOOKUP_DEFAULT',        'REGION_LOOKUP_FALLBACK',
  'REGION_TABLE_DEFAULT',         'REGION_TABLE_FALLBACK',
];

// Generate one file's content (~1.5kb of plausible JS). Line 47 holds one of:
//   - REGION_KEY_BOOTSTRAP = '<hex>';             (any of the 4 BOOTSTRAP_FILES)
//   - REGION_INDEX_MAP     = { <hex>: <int>, .. }; (any of the 4 MAP_FILES)
//   - REGION_LOOKUP_TABLE  = [<hex>, ...];         (any of the 4 TABLE_FILES)
//   - distractor (any of the 18 non-needle files)
// Same surrounding shape for every file so needles aren't structurally
// distinguishable from a quick `head` peek.
function generateFile(filepath) {
  const r = prngHex(filepath);
  const helperA = 'helper_' + r.slice(0, 6);
  const helperB = 'helper_' + r.slice(6, 12);
  const constA  = r.slice(12, 18);
  const constB  = r.slice(18, 24);
  const constC  = r.slice(24, 30);
  const distractorName  = DISTRACTOR_NAMES[parseInt(r.slice(30, 32), 16) % DISTRACTOR_NAMES.length];
  const distractorValue = r.slice(32, 38);
  const tableKeyA = r.slice(38, 44);
  const tableValA = r.slice(44, 50);
  const tableKeyB = r.slice(50, 56);
  const tableValB = r.slice(56, 62);

  const bootstrapIdx = BOOTSTRAP_FILES.indexOf(filepath);
  const mapIdx       = MAP_FILES.indexOf(filepath);
  const tableIdx     = TABLE_FILES.indexOf(filepath);

  let line47;
  if (bootstrapIdx >= 0) {
    line47 = "export const REGION_KEY_BOOTSTRAP = '" + BOOTSTRAP_VALUES[bootstrapIdx] + "';";
  } else if (mapIdx >= 0) {
    line47 = 'export const REGION_INDEX_MAP = ' + JSON.stringify(MAPS[mapIdx]) + ';';
  } else if (tableIdx >= 0) {
    line47 = 'export const REGION_LOOKUP_TABLE = ' + JSON.stringify(TABLES[tableIdx]) + ';';
  } else {
    line47 = 'export const ' + distractorName + " = '" + distractorValue + "';";
  }

  const lines = [
    '// ' + filepath + ' — auto-generated module (haystack v4)',                 // 1
    '// Part of a synthetic workspace seeded for retrieval-over-distance tests.',// 2
    '// Contents are deterministic per VERSION_SEED; do not hand-edit.',         // 3
    '',                                                                          // 4
    "export const MODULE_ID  = '" + constA + "';",                               // 5
    "export const MODULE_TAG = '" + constB + "';",                               // 6
    '',                                                                          // 7
    '/**',                                                                       // 8
    ' * ' + helperA + ' — opaque helper. Reverses an input string.',             // 9
    ' * @param {string} input',                                                  // 10
    ' * @returns {string}',                                                      // 11
    ' */',                                                                       // 12
    'export function ' + helperA + '(input) {',                                  // 13
    "  if (typeof input !== 'string') throw new TypeError('expected string');",  // 14
    "  return input.split('').reverse().join('');",                              // 15
    '}',                                                                         // 16
    '',                                                                          // 17
    '/**',                                                                       // 18
    ' * ' + helperB + ' — opaque helper. Sums an array of numbers.',             // 19
    ' * @param {Array<number>} arr',                                             // 20
    ' * @returns {number}',                                                      // 21
    ' */',                                                                       // 22
    'export function ' + helperB + '(arr) {',                                    // 23
    '  return arr.reduce((s, x) => s + x, 0);',                                  // 24
    '}',                                                                         // 25
    '',                                                                          // 26
    '// Internal lookup; not exported. Used by lookup() below.',                 // 27
    'const LOOKUP = {',                                                          // 28
    "  '" + tableKeyA + "': '" + tableValA + "',",                               // 29
    "  '" + tableKeyB + "': '" + tableValB + "',",                               // 30
    '};',                                                                        // 31
    '',                                                                          // 32
    'export function lookup(key) {',                                             // 33
    '  return LOOKUP[key] ?? null;',                                             // 34
    '}',                                                                         // 35
    '',                                                                          // 36
    '// Module-scoped counter; reset on import.',                                // 37
    'let _state = { count: 0, last: null };',                                    // 38
    '',                                                                          // 39
    'export function tick() {',                                                  // 40
    '  _state.count++;',                                                         // 41
    '  _state.last = Date.now();',                                               // 42
    '  return _state.count;',                                                    // 43
    '}',                                                                         // 44
    '',                                                                          // 45
    "export const STATE_VERSION = '" + constC + "';",                            // 46
    line47,                                                                      // 47 ← needle (one of two) or distractor
    '',                                                                          // 48
    'export default { ' + helperA + ', ' + helperB + ', lookup, tick };',        // 49
  ];
  return lines.join('\n') + '\n';
}

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { getMagicCode } from './solve.js';

const expected = '${REGION_KEY_VALUE}';
const actual = getMagicCode();
assert.equal(typeof actual, 'string', 'getMagicCode must return a string');
assert.equal(
  actual,
  expected,
  \`getMagicCode must return REGION_KEY value (expected '\${expected}', got '\${actual}')\`,
);
console.log('all-pass');
`;

const PROMPT = `\
The workspace contains three CLASSES of constants, scattered across files in
the lib/, data/, and config/ subdirectories:

  1. REGION_KEY_BOOTSTRAP — a 2-character hex string. EXPORTED FROM 4 FILES,
     each holding a different value.
  2. REGION_INDEX_MAP    — an object mapping 2-character hex keys to
     integers. EXPORTED FROM 4 FILES, each with different keys/values.
  3. REGION_LOOKUP_TABLE — an array of 6-character hex strings. EXPORTED FROM
     4 FILES, with different lengths and contents.

Of the 4 × 4 × 4 = 64 possible (BOOTSTRAP, MAP, TABLE) triples, exactly ONE is
self-consistent — meaning all of the following hold:

  (a) BOOTSTRAP's value is a key in MAP (i.e. MAP[BOOTSTRAP] is defined).
  (b) The integer MAP[BOOTSTRAP] is a valid index into TABLE
      (i.e. 0 <= MAP[BOOTSTRAP] < TABLE.length).
  (c) TABLE[MAP[BOOTSTRAP]] is a valid 6-character hex string.

For every other triple, at least one of (a)/(b)/(c) fails — typically MAP
returns undefined, or the index is out of bounds for TABLE. The "magic code"
is the value TABLE[MAP[BOOTSTRAP]] from the unique self-consistent triple.

Create solve.js at the workspace root that exports \`getMagicCode()\` returning
that hex string. Then ensure \`node verify.js\` exits 0. Do not edit verify.js.

Notes:
  - Many other files contain distractor constants like
    REGION_KEY_BOOTSTRAP_DEFAULT, REGION_INDEX_MAP_FALLBACK,
    REGION_LOOKUP_TABLE_DEFAULT — those don't count. You want exactly
    REGION_KEY_BOOTSTRAP / REGION_INDEX_MAP / REGION_LOOKUP_TABLE
    (strict match on the full identifier).
  - The exports look like:
        export const REGION_KEY_BOOTSTRAP = '<2-char-hex>';
        export const REGION_INDEX_MAP    = { "<hex>": <int>, ... };
        export const REGION_LOOKUP_TABLE = ["<6-char-hex>", ...];
  - solve.js lives at the workspace root (sibling of verify.js).
  - You may use any retrieval strategy and may write helper scripts.`;

const CLAW_TIMEOUT = 285_000;

describe(`needle-haystack: 30-file NIAH apply-the-needle (tier=${TIER_LABEL})`, () => {
  beforeEach(() => {
    workspace.reset();
    // Subdirs need explicit creation; workspace.reset() blows them away each run.
    const subdirs = new Set(FILES.map(f => path.dirname(f)));
    for (const d of subdirs) {
      fs.mkdirSync(path.join(workspace.WORKSPACE, d), { recursive: true });
    }
    for (const f of FILES) {
      fs.writeFileSync(
        path.join(workspace.WORKSPACE, f),
        generateFile(f),
      );
    }
    fs.writeFileSync(path.join(workspace.WORKSPACE, 'verify.js'), VERIFY_JS);
  });

  it('claw locates REGION_KEY and writes solve.js', { timeout: CLAW_TIMEOUT + 20_000 }, async () => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, timeoutMs: CLAW_TIMEOUT });

    const targetExists = workspace.exists('solve.js');
    let post = null;
    if (r.code === 0 && targetExists) {
      post = spawnSync('node', [path.join(workspace.WORKSPACE, 'verify.js')], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    }
    const passed = r.code === 0 && targetExists && post?.status === 0;

    console.log(`\n=== needle-haystack v4 (${TIER_LABEL}) ===`);
    console.log(`  canonical bootstrap: ${BOOTSTRAP_FILES[0]} = '${BOOTSTRAP_VALUES[0]}'`);
    console.log(`  canonical map:       ${MAP_FILES[0]} (MAP['${BOOTSTRAP_VALUES[0]}'] = ${CANONICAL_INDEX})`);
    console.log(`  canonical table:     ${TABLE_FILES[0]} (TABLE[${CANONICAL_INDEX}] = '${REGION_KEY_VALUE}')`);
    console.log(`  decoy bootstraps: ${BOOTSTRAP_FILES.slice(1).join(', ')}`);
    console.log(`  decoy maps:       ${MAP_FILES.slice(1).join(', ')}`);
    console.log(`  decoy tables:     ${TABLE_FILES.slice(1).join(', ')} (lengths ${DISTRACTOR_T_LENGTHS.join('/')})`);
    console.log(`  claw: exit=${r.code} elapsed=${r.elapsedMs}ms solve.js=${targetExists}`);
    if (r.code !== 0) console.log(`  claw stderr (tail):\n${r.stderr.slice(-1500)}`);
    if (post) console.log(`  verify: exit=${post.status} stdout=${post.stdout.trim()} stderr=${post.stderr.slice(0, 400).trim()}`);

    writeAssertionResult(r.runDir, {
      passed,
      claw_exit: r.code,
      target_file_exists: targetExists,
      post_status: post?.status ?? null,
      post_stderr_tail: post?.stderr?.slice(0, 800) ?? null,
    });

    if (r.terminal_status === 'timeout') assert.fail(`claw timed out after ${r.elapsedMs}ms`);

    assert.equal(r.code, 0, 'claw must exit cleanly');
    assert.equal(targetExists, true, 'solve.js must be created at workspace root');
    assert.equal(post?.status, 0, `verify.js failed:\n${post?.stderr?.slice(0, 800)}`);
  });
});
