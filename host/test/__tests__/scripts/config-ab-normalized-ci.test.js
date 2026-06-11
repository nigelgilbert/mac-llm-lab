// Issue #021: symmetric overflow normalization + renderer parity for
// scripts/config-ab-normalized-ci.mjs.
//
// The script's "symmetric overflow scoring" originally reclassified
// context-overflow harness_error rows as eligible fails ONLY on the baseline
// side (`r.config_id === BASELINE`). Correct for the frozen tier-16 dataset
// (0 OpenCode overflow harness_error rows there), but post-#002 sweeps
// re-type OpenCode overflows to harness_error too (patch-context-overflow.mjs)
// — run one-sided on such a registry, baseline overflows count as fails while
// treatment overflows are silently DROPPED, biasing the sensitivity estimate
// toward the treatment. #021 makes the reclassification symmetric and brings
// the script to parity with its sibling renderers (VALID_CONFIGS validation,
// treatment ≠ baseline, PairedBootstrapError → structured FAIL).
//
// These tests spawn the real script on fixture registries and pin:
//   (a) the frozen-dataset shape (baseline-side overflow harness_error only)
//       still produces the committed behavior class: normalization moves the
//       delta toward zero by exactly the baseline-side reclassification, and
//       the treatment side reports 0 reclassified rows — i.e. the change
//       cannot move the published tier-16 −5.47pp [−10.94, +0.00] number;
//   (b) the post-#002 shape (overflow harness_error on BOTH sides): treatment
//       rows enter the treatment denominator as fails too — the normalized
//       delta is the symmetric value, not the one-sided treatment-favoring one;
//   (c) arg-validation failures exit 2 with the VALID_CONFIGS / must-differ
//       messages, and PairedBootstrapError surfaces as a structured FAIL
//       (exit 1), never a raw stack trace.
//
// Fixtures (committed JSONL under ./fixtures/, tier 16, hand-computable):
//   registry-overflow-baseline-only.jsonl
//     task-alpha: claw 1/2 done + 1 overflow herr, oc 1/2 done
//     task-beta : claw 2/2 done,                   oc 1/2 done
//     canonical  delta = ((0.5−0.5) + (0.5−1.0))/2 = −0.25       → −25.00pp
//     normalized delta = ((0.5−1/3) + (0.5−1.0))/2 = −1/6        → −16.67pp
//   registry-overflow-both-sides.jsonl
//     task-alpha: claw 1/2 done + overflow herr, oc 1/2 done + overflow herr
//     task-beta : claw 2/2 done,                 oc 1/1 done + overflow herr
//     canonical  delta = ((0.5−0.5) + (1.0−1.0))/2 = 0           → +0.00pp
//     normalized delta = ((1/3−1/3) + (0.5−1.0))/2 = −0.25       → −25.00pp
//     (the pre-#021 one-sided rule would have yielded +8.33pp here: baseline
//      overflows counted as fails, treatment overflows silently dropped)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'config-ab-normalized-ci.mjs');
const FIXTURES = path.join(__dirname, 'fixtures');

function runScript(fixtureName, extraArgs = []) {
  const registry = path.join(FIXTURES, fixtureName);
  return spawnSync(
    process.execPath,
    [SCRIPT, registry, '--tier', '16', ...extraArgs],
    { encoding: 'utf8' },
  );
}

describe('config-ab-normalized-ci.mjs — symmetric overflow normalization (issue #021)', () => {
  describe('(a) frozen-dataset shape: overflow harness_error on the BASELINE side only', () => {
    const res = runScript('registry-overflow-baseline-only.jsonl');

    it('exits 0 with no stack trace', () => {
      assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });

    it('heading is templated from --tier and renders the committed byte-identical string for tier 16', () => {
      assert.match(res.stdout, /^=== tier-16 normalized-treatment sensitivity \(post-hoc\) ===$/m);
    });

    it('reports baseline-side reclassification and ZERO treatment-side rows', () => {
      assert.match(
        res.stdout,
        /reclassified\s+: 1 baseline \(claw-rig\) \+ 0 treatment \(opencode-a\) context-overflow harness_error rows → eligible fails/,
      );
    });

    it('canonical delta drops the overflow row; normalized counts it as a baseline fail (committed −7.7 → −5.47pp behavior class: delta moves toward zero)', () => {
      assert.match(res.stdout, /canonical \(drop overflow\)\s+: delta -25\.00pp/);
      assert.match(res.stdout, /normalized \(overflow = fail\)\s+: delta -16\.67pp/);
    });
  });

  describe('(b) post-#002 shape: overflow harness_error on BOTH sides', () => {
    const res = runScript('registry-overflow-both-sides.jsonl');

    it('exits 0 and reports per-side reclassification counts', () => {
      assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(
        res.stdout,
        /reclassified\s+: 1 baseline \(claw-rig\) \+ 2 treatment \(opencode-a\) context-overflow harness_error rows → eligible fails/,
      );
    });

    it('treatment-side overflow rows enter the treatment denominator as fails (symmetric −25.00pp, not the one-sided +8.33pp)', () => {
      assert.match(res.stdout, /canonical \(drop overflow\)\s+: delta \+0\.00pp/);
      // One-sided pre-#021 behavior was ((0.5−1/3) + (1.0−1.0))/2 = +8.33pp —
      // baseline overflows scored as fails, treatment's silently dropped.
      assert.match(res.stdout, /normalized \(overflow = fail\)\s+: delta -25\.00pp/);
      assert.ok(!/normalized \(overflow = fail\)\s+: delta \+8\.33pp/.test(res.stdout));
    });
  });

  describe('(c) arg validation and structured failure (parity with sibling renderers)', () => {
    // --tier is REQUIRED (Copilot review on #021): without it the script used
    // to pool ALL tiers under a hardcoded tier-16 heading. Spawn the script
    // WITHOUT the runScript helper (which always injects --tier 16).
    it('missing --tier exits 2 with the usage message (no tier default, no all-tier pooling)', () => {
      const registry = path.join(FIXTURES, 'registry-overflow-baseline-only.jsonl');
      const res = spawnSync(process.execPath, [SCRIPT, registry], { encoding: 'utf8' });
      assert.equal(res.status, 2, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /usage: config-ab-normalized-ci\.mjs .*--tier required: positive integer/);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });

    it('non-numeric --tier exits 2 with the usage message', () => {
      const registry = path.join(FIXTURES, 'registry-overflow-baseline-only.jsonl');
      const res = spawnSync(process.execPath, [SCRIPT, registry, '--tier', 'sixteen'], { encoding: 'utf8' });
      assert.equal(res.status, 2, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /usage: config-ab-normalized-ci\.mjs .*--tier required: positive integer/);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });

    it('typo\'d --treatment exits 2 with the VALID_CONFIGS message, not a stack trace', () => {
      const res = runScript('registry-overflow-baseline-only.jsonl', ['--treatment', 'opencode-z']);
      assert.equal(res.status, 2, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /--treatment "opencode-z" is not in VALID_CONFIGS \{claw-rig, opencode-a, opencode-a\+git, opencode-a\+prompt\}/);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });

    it('typo\'d --baseline exits 2 with the VALID_CONFIGS message', () => {
      const res = runScript('registry-overflow-baseline-only.jsonl', ['--baseline', 'claw-pig']);
      assert.equal(res.status, 2, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /--baseline "claw-pig" is not in VALID_CONFIGS/);
    });

    it('treatment === baseline exits 2 with the must-differ message', () => {
      const res = runScript('registry-overflow-baseline-only.jsonl', ['--treatment', 'claw-rig', '--baseline', 'claw-rig']);
      assert.equal(res.status, 2, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /--treatment and --baseline must differ/);
    });

    it('PairedBootstrapError (no paired tasks at a foreign tier) → structured FAIL, exit 1, no raw stack trace', () => {
      const registry = path.join(FIXTURES, 'registry-overflow-baseline-only.jsonl');
      const res = spawnSync(
        process.execPath,
        [SCRIPT, registry, '--tier', '99'],
        { encoding: 'utf8' },
      );
      assert.equal(res.status, 1, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.match(res.stderr, /FAIL: no paired tasks/);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });
  });
});
