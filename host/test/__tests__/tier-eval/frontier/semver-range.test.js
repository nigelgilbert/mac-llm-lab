/** @manifest
 * {
 *   "test_id": "semver-range",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": ["stateful_logic"],
 *   "suite_layer": "D",
 *   "difficulty_band": "frontier",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Frontier reserve. Stays in Layer D unless pilot shows t32 ≥ 30% — then promote to suite_layer B with band hard.",
 *   "expected_tier_signature": "floor",
 *   "known_confounds": ["context_pressure_high"],
 *   "introduced_in": "1.21",
 *   "notes": "H3 hand-authored; 2x assertion density vs expression-eval (~50 assertions). Probes spec_precision under dense edge surface: SemVer 2.0.0 + npm-style ranges (caret, tilde, hyphen, OR, wildcards, partial versions, pre-release). Hand-solve likely >10min — classified frontier per EVAL-DESIGN rule #1. Reserve unless pilot shows t32 capability."
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
import { matches } from './semver-range.js';

// Exact match
assert.equal(matches('1.2.3', '1.2.3'),         true,  'exact');
assert.equal(matches('1.2.3', '=1.2.3'),        true,  'exact with leading =');
assert.equal(matches('1.2.4', '1.2.3'),         false, 'exact mismatch patch');
assert.equal(matches('1.3.3', '1.2.3'),         false, 'exact mismatch minor');
assert.equal(matches('2.2.3', '1.2.3'),         false, 'exact mismatch major');

// Comparators
assert.equal(matches('1.2.4', '>1.2.3'),        true,  '> matches greater');
assert.equal(matches('1.2.3', '>1.2.3'),        false, '> rejects equal');
assert.equal(matches('1.2.3', '>=1.2.3'),       true,  '>= matches equal');
assert.equal(matches('1.2.4', '>=1.2.3'),       true,  '>= matches greater');
assert.equal(matches('1.2.2', '>=1.2.3'),       false, '>= rejects less');
assert.equal(matches('1.2.2', '<1.2.3'),        true,  '< matches less');
assert.equal(matches('1.2.3', '<1.2.3'),        false, '< rejects equal');
assert.equal(matches('1.2.3', '<=1.2.3'),       true,  '<= matches equal');
assert.equal(matches('1.2.4', '<=1.2.3'),       false, '<= rejects greater');

// Caret ^x.y.z: >=x.y.z and <(x+1).0.0 for major>=1
assert.equal(matches('1.2.3', '^1.2.3'),        true,  '^ matches base');
assert.equal(matches('1.2.4', '^1.2.3'),        true,  '^ matches patch up');
assert.equal(matches('1.5.0', '^1.2.3'),        true,  '^ matches minor up');
assert.equal(matches('2.0.0', '^1.2.3'),        false, '^ rejects major up');
assert.equal(matches('1.2.2', '^1.2.3'),        false, '^ rejects below base');
assert.equal(matches('1.0.0', '^1.2.3'),        false, '^ rejects below base minor');

// Caret with major=0: ^0.y.z = >=0.y.z <0.(y+1).0
assert.equal(matches('0.2.3', '^0.2.3'),        true,  '^0.x.y matches base');
assert.equal(matches('0.2.5', '^0.2.3'),        true,  '^0.x.y matches patch up');
assert.equal(matches('0.3.0', '^0.2.3'),        false, '^0.x.y rejects minor up (major-0 special)');

// Caret with major=0 minor=0: ^0.0.z = =0.0.z (locked)
assert.equal(matches('0.0.3', '^0.0.3'),        true,  '^0.0.z matches exact');
assert.equal(matches('0.0.4', '^0.0.3'),        false, '^0.0.z rejects patch up');

// Tilde ~x.y.z: >=x.y.z <(x).(y+1).0
assert.equal(matches('1.2.3', '~1.2.3'),        true,  '~ matches base');
assert.equal(matches('1.2.9', '~1.2.3'),        true,  '~ matches patch up');
assert.equal(matches('1.3.0', '~1.2.3'),        false, '~ rejects minor up');
assert.equal(matches('1.2.2', '~1.2.3'),        false, '~ rejects below');

// Hyphen range "a.b.c - x.y.z" inclusive on both ends
assert.equal(matches('1.2.3', '1.2.3 - 1.5.0'), true,  'hyphen lower bound');
assert.equal(matches('1.5.0', '1.2.3 - 1.5.0'), true,  'hyphen upper bound');
assert.equal(matches('1.4.0', '1.2.3 - 1.5.0'), true,  'hyphen middle');
assert.equal(matches('1.2.2', '1.2.3 - 1.5.0'), false, 'hyphen below');
assert.equal(matches('1.5.1', '1.2.3 - 1.5.0'), false, 'hyphen above');

// AND (space-joined comparators)
assert.equal(matches('1.5.0', '>=1.2.3 <2.0.0'), true,  'AND in range');
assert.equal(matches('2.0.0', '>=1.2.3 <2.0.0'), false, 'AND upper exclusive');
assert.equal(matches('1.2.2', '>=1.2.3 <2.0.0'), false, 'AND lower violated');

// OR ||
assert.equal(matches('1.5.0', '1.2.3 || >=2.0.0'),  true,  'OR first branch');
assert.equal(matches('2.5.0', '1.2.3 || >=2.0.0'),  true,  'OR second branch');
assert.equal(matches('1.2.4', '1.2.3 || >=2.0.0'),  false, 'OR neither');

// Wildcards
assert.equal(matches('1.2.5', '1.2.x'),         true,  'patch wildcard');
assert.equal(matches('1.3.0', '1.2.x'),         false, 'patch wildcard reject minor up');
assert.equal(matches('1.5.9', '1.x'),           true,  'minor wildcard');
assert.equal(matches('2.0.0', '1.x'),           false, 'minor wildcard reject major up');
assert.equal(matches('1.2.3', '*'),             true,  'any wildcard');
assert.equal(matches('99.99.99', '*'),          true,  'any wildcard high');

// Partial versions normalize
assert.equal(matches('1.0.0', '1'),             true,  'partial: 1 → 1.0.0');
assert.equal(matches('1.2.0', '1.2'),           true,  'partial: 1.2 → 1.2.0');
assert.equal(matches('1.2.5', '1.2'),           false, 'partial: 1.2 is exact, not range');

// Pre-release: a pre-release version satisfies a range only if some
// comparator in that range explicitly mentions a version with the same
// [major,minor,patch] tuple. Otherwise, pre-release versions are excluded.
assert.equal(matches('1.2.3-alpha', '>=1.2.3-alpha <1.3.0'), true,  'pre-release with explicit pre comparator');
assert.equal(matches('1.2.3-alpha', '>=1.2.0'),              false, 'pre-release excluded from non-pre range');
assert.equal(matches('1.2.3-beta',  '>=1.2.3-alpha'),        true,  'pre-release ordering: beta > alpha');
assert.equal(matches('1.2.3',       '>=1.2.3-alpha'),        true,  'release > any pre-release of same triple');
assert.equal(matches('1.2.3-alpha', '^1.2.3-alpha'),         true,  '^ with pre-release locks pre-release');

// Whitespace tolerance
assert.equal(matches('1.2.3', '  1.2.3  '),          true,  'trim outer whitespace');
assert.equal(matches('1.5.0', '>=1.2.3   <2.0.0'),    true,  'multiple spaces in AND');
`;

const PROMPT = `\
Create semver-range.js that exports \`matches(version, rangeSpec)\` returning
a boolean: does \`version\` satisfy \`rangeSpec\`?

Both inputs are strings.

Version syntax:
  <major>.<minor>.<patch>[-<prerelease>]
  All components are non-negative integers (no leading zeros except \`0\`).
  Pre-release is optional, e.g. \`1.2.3-alpha\`, \`1.2.3-beta.2\`.

Range syntax (npm/semver-style; the subset described here is what we test):

  exact:           \`1.2.3\`  or  \`=1.2.3\`
  comparators:     \`>1.2.3\`, \`>=1.2.3\`, \`<1.2.3\`, \`<=1.2.3\`
  AND:             space-separated, e.g. \`>=1.2.3 <2.0.0\`
  OR:              \`||\`-separated, e.g. \`1.2.3 || >=2.0.0\`
  caret \`^x.y.z\`:
    - if x ≥ 1: matches \`>=x.y.z <(x+1).0.0\`
    - if x = 0, y ≥ 1: matches \`>=0.y.z <0.(y+1).0\`
    - if x = 0, y = 0: matches exact \`=0.0.z\`
  tilde \`~x.y.z\`:  matches \`>=x.y.z <x.(y+1).0\`
  hyphen range:    \`a.b.c - x.y.z\` matches \`>=a.b.c <=x.y.z\` (inclusive)
  wildcards:
    \`1.2.x\`        matches \`>=1.2.0 <1.3.0\`
    \`1.x\`           matches \`>=1.0.0 <2.0.0\`
    \`*\`             matches anything
  partial versions:
    \`1\`             treated as the exact version \`1.0.0\`
    \`1.2\`           treated as the exact version \`1.2.0\`

Pre-release rule (npm convention):
  A pre-release version (e.g. \`1.2.3-alpha\`) satisfies a range only when
  at least one comparator in that range explicitly mentions a version with
  the SAME [major, minor, patch] tuple AND a pre-release tag. Otherwise,
  pre-release versions are excluded from the range. This avoids cases like
  \`1.2.3-alpha\` accidentally matching \`>=1.2.0\`.

Pre-release ordering: pre-release tags compare lexicographically dot-separated.
  \`1.2.3-alpha < 1.2.3-beta < 1.2.3\` (a release outranks any pre-release of
  the same triple).

Whitespace inside a range may be uneven; trim outer whitespace and tolerate
multiple spaces between AND comparators.

Return \`true\` if version satisfies rangeSpec, \`false\` otherwise.

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const CLAW_TIMEOUT = 285_000;

describe(`semver-range: dense semver/range parser (tier=${TIER_LABEL})`, () => {
  beforeEach(() => {
    workspace.reset();
    fs.writeFileSync(path.join(workspace.WORKSPACE, 'verify.js'), VERIFY_JS);
  });

  it('claw solves the task', { timeout: CLAW_TIMEOUT + 20_000 }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});

    const targetExists = workspace.exists('semver-range.js');
    let post = null;
    if (r.code === 0 && targetExists) {
      post = spawnSync('node', [path.join(workspace.WORKSPACE, 'verify.js')], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    }
    const passed = r.code === 0 && targetExists && post?.status === 0;

    console.log(`\n=== semver-range (${TIER_LABEL}) ===`);
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
    assert.equal(targetExists, true, 'semver-range.js must be created');
    assert.equal(post?.status, 0, `verify.js failed:\n${post?.stderr?.slice(0, 800)}`);
  });
});
