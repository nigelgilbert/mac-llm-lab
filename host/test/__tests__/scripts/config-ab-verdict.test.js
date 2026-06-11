// Issue #012: verdict-script robustness against timestamp-free registries.
//
// end_time: null is schema-legal (degraded sidecars) and such rows remain
// pass-rate-eligible, so a side whose rows ALL lack timestamps is a real
// dataset, not a corruption. Pre-#012 the Rule 0a.2 block chained .toFixed(1)
// onto median()/pctile() null returns and died with a raw TypeError AFTER
// rendering Rule 0a.1 (the top-level catch only handles PairedBootstrapError).
// These tests spawn the real script on fixture registries and pin the guarded
// behavior: complete verdict, "wall-clock unavailable" wording, exit 0, no
// stack trace.
//
// Fixtures (committed JSONL under ./fixtures/):
//   registry-no-treatment-timestamps.jsonl
//     2 tasks × 2 runs × 2 arms; every opencode-a row has end_time: null →
//     the whole treatment side has zero wall-clock observations (durAll empty).
//   registry-no-eligible-treatment-timestamps.jsonl
//     same, plus one opencode-a harness_error row that DOES carry timestamps →
//     durAll is non-empty but the eligible-only subset (durElig) is empty,
//     exercising the second guard independently.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'config-ab-verdict.mjs');
const FIXTURES = path.join(__dirname, 'fixtures');

function runVerdict(fixtureName, extraArgs = []) {
  const registry = path.join(FIXTURES, fixtureName);
  return spawnSync(
    process.execPath,
    [SCRIPT, registry, '--tier', '64', ...extraArgs],
    { encoding: 'utf8' },
  );
}

describe('config-ab-verdict.mjs — wall-clock guards (issue #012)', () => {
  describe('treatment side with zero timestamped rows (durAll empty)', () => {
    const res = runVerdict('registry-no-treatment-timestamps.jsonl');

    it('exits 0 with no stack trace (previously a raw TypeError after Rule 0a.1)', () => {
      assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.ok(!/TypeError/.test(res.stderr), `stderr has TypeError:\n${res.stderr}`);
      assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
    });

    it('still renders the full pass-rate section (Rule 0a.1)', () => {
      assert.match(res.stdout, /--- Rule 0a\.1: pass-rate non-inferiority ---/);
      assert.match(res.stdout, /paired tasks\s+: 2/);
      assert.match(res.stdout, /90% paired-bootstrap CI/);
    });

    it('prints "wall-clock unavailable" for the timestamp-free side, real stats for the other', () => {
      assert.match(res.stdout, /opencode-a\s+wall-clock unavailable \(n=0 rows with timestamps\)/);
      assert.match(res.stdout, /claw-rig\s+median 20\.0s/); // baseline unaffected
      assert.match(
        res.stdout,
        /ratio \(opencode-a median \/ claw-rig median\): wall-clock unavailable \(n=0 rows with timestamps\)\s+→\s+NOT MET/,
      );
    });

    it('renders a complete verdict: rule 0a.2 marked NOT MET (wall-clock unavailable), conservative KEEP', () => {
      assert.match(res.stdout, /=== VERDICT \(tier-64\) ===/);
      assert.match(res.stdout, /Rule 0a\.2 \(wall-clock ≤ 1\.5×\)\s+: NOT MET \(wall-clock unavailable\)/);
      assert.match(res.stdout, /KEEP the claw rig at this tier/);
    });
  });

  describe('treatment side whose only timestamped row is ineligible (durElig empty, durAll not)', () => {
    const res = runVerdict('registry-no-eligible-treatment-timestamps.jsonl');

    it('exits 0 and guards the eligible-only median independently of the all-rows median', () => {
      assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
      assert.ok(!/TypeError/.test(res.stderr), `stderr has TypeError:\n${res.stderr}`);
      // durAll has the harness_error row's 30s, so the side line renders real
      // numbers — but the eligible-only clause must take the guard path.
      assert.match(
        res.stdout,
        /opencode-a\s+median 30\.0s.*eligible-only wall-clock unavailable \(n=0 rows with timestamps\)/,
      );
      // Both medians exist (n=1 on the treatment side), so the ratio is numeric.
      assert.match(res.stdout, /ratio \(opencode-a median \/ claw-rig median\): 1\.50×/);
      assert.match(res.stdout, /=== VERDICT \(tier-64\) ===/);
    });
  });
});
