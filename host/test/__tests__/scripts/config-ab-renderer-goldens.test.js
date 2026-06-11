// Issue #025: verdict-renderer degenerate-value guards + golden-output tests
// for the three published-number renderers (config-ab-verdict.mjs,
// config-ab-pairing-check.mjs, config-ab-normalized-ci.mjs).
//
// Two formatting holes could land garbage verbatim in committed verdict docs:
//
//   1. Iteration parity: a side with ZERO numeric `iters_count` rows rendered
//      `median null  min Infinity  max -Infinity  (n=0)` — `Math.min/max(...[])`
//      and median()'s null return, unguarded. Now the same n=0 → "unavailable"
//      treatment the wall-clock section got in #012.
//   2. NaN durations: durationS returns NaN (not null) for a PRESENT but
//      malformed timestamp, and the old `!= null` filter admitted it,
//      poisoning median/p90/max AND the Rule 0a.2 ratio (`NaN×  →  NOT MET`).
//      Now filtered with Number.isFinite — the bad ROW is excluded, the
//      remaining stats stay finite. (Which rows feed the Rule 0a.2 decision
//      median is issue #026's question; these guards only change how
//      degenerate VALUES render.)
//
// Golden coverage: the seeded bootstrap (lib/paired_bootstrap.js, B=10000,
// seed 0xc0ffee defaults) makes exact output assertions safe, so the headline
// renders (per-task deltas, aggregate delta, CI bounds, gate/verdict lines)
// are pinned (a) over small committed fixture registries and (b) over the
// committed canonical evidence registries in docs/data/ — the latter pin the
// PUBLISHED numbers per docs/data/README.md, so any drift in the statistic or
// the renderers turns the suite red. The canonical registries are read-only
// evidence: these tests read them and must never write them.
//
// Fixtures (committed JSONL under ./fixtures/, tier 64, hand-computable):
//   registry-golden-small.jsonl
//     3 tasks × 2 arms × 2 runs, all eligible. Per-task deltas +50/−50/+50pp
//     → aggregate +16.7pp; claw 20s rows vs oc 10s rows → ratio 0.50×;
//     iters claw {5,4,7,3,6,2} / oc {3,3,2,4,5,1}.
//   registry-no-treatment-iters.jsonl
//     2 tasks × 2 arms × 2 runs; NO opencode-a row carries a numeric
//     iters_count (two absent, one string "seven") → treatment side n=0.
//   registry-malformed-timestamps.jsonl
//     claw: 4 good 20s rows + 1 row with start_time "not-a-timestamp";
//     oc: 3 good rows (30s, 10s, 30s) + 1 row with end_time "garbage"
//     → finite stats over n=4 / n=3, ratio exactly 1.50× (≤ 1.5 → MET).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const FIXTURES = path.join(__dirname, 'fixtures');
// Committed canonical evidence registries (docs/data/README.md). Baked into
// the test image (Dockerfile COPY docs/data) for the compose `test` service.
const DATA = path.join(__dirname, '..', '..', 'docs', 'data');
const TIER64_REGISTRY = path.join(DATA, 'run_registry.config-ab-20260606-165548.jsonl');
const TIER16_REGISTRY = path.join(DATA, 'run_registry.config-ab-20260607-062848.jsonl');
const SIDECAR_REGISTRY = path.join(DATA, 'run_registry.sidecar-port-20260610.jsonl');

function run(script, registry, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPTS, script), registry, ...args],
    { encoding: 'utf8' },
  );
}

// Exact-substring golden assertion: every pinned line is asserted verbatim
// (column padding included) rather than via regex, so a renderer formatting
// drift — not just a number drift — turns the test red.
function assertLines(stdout, lines) {
  for (const line of lines) {
    assert.ok(
      stdout.includes(line),
      `golden line not found:\n  ${JSON.stringify(line)}\nin stdout:\n${stdout}`,
    );
  }
}

describe('config-ab-verdict.mjs — iteration-parity n=0 guard (issue #025)', () => {
  const res = run('config-ab-verdict.mjs', path.join(FIXTURES, 'registry-no-treatment-iters.jsonl'), ['--tier', '64']);

  it('exits 0 with no stack trace', () => {
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assert.ok(!/^\s+at /m.test(res.stderr), `stderr has a stack trace:\n${res.stderr}`);
  });

  it('side with zero numeric iters_count renders "unavailable", never Infinity/-Infinity/null (pre-#025: "median null  min Infinity  max -Infinity  (n=0)")', () => {
    assertLines(res.stdout, [
      '  opencode-a  iters_count unavailable (n=0 rows with numeric iters_count)',
    ]);
    assert.ok(!/Infinity/.test(res.stdout), `stdout leaks Infinity:\n${res.stdout}`);
    assert.ok(!/median null/.test(res.stdout), `stdout leaks a null median:\n${res.stdout}`);
  });

  it('the other side still renders real iteration stats (a string iters_count is not numeric)', () => {
    // oc-wordy-0 carries iters_count "seven" — non-numeric, must not count.
    assertLines(res.stdout, ['  claw-rig    median 4.5  min 3  max 7  (n=4)']);
  });

  it('the rest of the verdict still renders (Rules 0a.1/0a.2 + verdict block)', () => {
    assertLines(res.stdout, [
      '--- Rule 0a.1: pass-rate non-inferiority ---',
      '  ratio (opencode-a median / claw-rig median): 0.50×  ≤ 1.5×  →  MET',
      '=== VERDICT (tier-64) ===',
    ]);
  });
});

describe('config-ab-verdict.mjs — NaN-duration guard (issue #025)', () => {
  const res = run('config-ab-verdict.mjs', path.join(FIXTURES, 'registry-malformed-timestamps.jsonl'), ['--tier', '64']);

  it('exits 0 and renders NO NaN anywhere (pre-#025: "median NaNs … max NaNs" and "ratio NaN×")', () => {
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assert.ok(!/NaN/.test(res.stdout), `stdout leaks NaN:\n${res.stdout}`);
  });

  it('malformed start_time row is excluded from the baseline stats (5 rows, n=4 finite durations)', () => {
    assertLines(res.stdout, [
      '  claw-rig    median 20.0s  p90 20.0s  max 20.0s  (n=4; eligible-only median 20.0s)',
    ]);
  });

  it('malformed end_time row is excluded from the treatment stats (4 rows, n=3 finite durations)', () => {
    assertLines(res.stdout, [
      '  opencode-a  median 30.0s  p90 30.0s  max 30.0s  (n=3; eligible-only median 30.0s)',
    ]);
  });

  it('Rule 0a.2 ratio is computed over the finite durations (1.50× → MET; the NaN poisoning previously flipped it to NOT MET)', () => {
    assertLines(res.stdout, [
      '  ratio (opencode-a median / claw-rig median): 1.50×  ≤ 1.5×  →  MET',
    ]);
  });
});

describe('config-ab-verdict.mjs — golden headline render over fixture registry (issue #025)', () => {
  const res = run('config-ab-verdict.mjs', path.join(FIXTURES, 'registry-golden-small.jsonl'), ['--tier', '64']);

  it('exits 0', () => {
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
  });

  it('per-task pass-rate lines render exactly', () => {
    assertLines(res.stdout, [
      '  csv-parser                         1/2        2/2         +50.0pp',
      '  wordy                              2/2        1/2         -50.0pp',
      '  zebra-puzzle                       1/2        2/2         +50.0pp',
      '  (0 unpaired — every task has eligible runs on both sides)',
    ]);
  });

  it('Rule 0a.1 block: aggregate delta, seeded-bootstrap CI bounds, margin line', () => {
    assertLines(res.stdout, [
      '  paired tasks       : 3',
      '  aggregate delta    : +16.7pp  (opencode-a − claw-rig)',
      '  90% paired-bootstrap CI: [-16.7, 50.0]pp',
      '  margin             : CI lower -16.7pp ≤ −5pp  →  NOT MET',
    ]);
  });

  it('Rule 0a.2 + iteration-parity blocks render exact finite stats', () => {
    assertLines(res.stdout, [
      '  claw-rig    median 20.0s  p90 20.0s  max 20.0s  (n=6; eligible-only median 20.0s)',
      '  opencode-a  median 10.0s  p90 10.0s  max 10.0s  (n=6; eligible-only median 10.0s)',
      '  ratio (opencode-a median / claw-rig median): 0.50×  ≤ 1.5×  →  MET',
      '  claw-rig    median 4.5  min 2  max 7  (n=6)',
      '  opencode-a  median 3  min 1  max 5  (n=6)',
    ]);
  });

  it('verdict block renders the gate results and the KEEP line', () => {
    assertLines(res.stdout, [
      '=== VERDICT (tier-64) ===',
      '  Rule 0a.1 (pass-rate non-inferiority): NOT MET',
      '  Rule 0a.2 (wall-clock ≤ 1.5×)       : MET',
      '  → KEEP the claw rig at this tier',
    ]);
  });
});

describe('config-ab-pairing-check.mjs — golden render over fixture registry (issue #025)', () => {
  const res = run('config-ab-pairing-check.mjs', path.join(FIXTURES, 'registry-golden-small.jsonl'), ['--tier', '64']);

  it('exits 0', () => {
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
  });

  it('histogram, uniqueness, and per-task delta lines render exactly', () => {
    assertLines(res.stdout, [
      '  claw-rig     6',
      '  opencode-a   6',
      'run_id uniqueness: OK — no duplicates within (opencode-a, claw-rig, tier 64) scope',
      'paired tasks: 3   unpaired: 0',
      '  csv-parser           claw-rig=1/2  opencode-a=2/2  delta=50.0pp',
      '  wordy                claw-rig=2/2  opencode-a=1/2  delta=-50.0pp',
      '  zebra-puzzle         claw-rig=1/2  opencode-a=2/2  delta=50.0pp',
    ]);
  });

  it('seeded-bootstrap smoke line and the PASS gate line render exactly', () => {
    assertLines(res.stdout, [
      'paired_bootstrap: nTasks=3  aggregateDelta=16.7pp  90% CI [-16.7, 50.0]pp',
      'PASS — every row config_id-stamped; both sides bucketed (claw-rig=6, opencode-a=6 eligible paired runs). Baseline NOT dropped.',
    ]);
  });
});

// --- Published-number goldens over the COMMITTED canonical registries -------
// docs/data/README.md's re-derivation command block, run as tests. These pin
// the published record: tier-64 RETIRE +3.1pp [0.8, 6.3] 0.61×; tier-16 KEEP
// −7.7pp [−13.1, −2.5] 0.96×; tier-16 normalized −5.47pp [−10.94, 0.00];
// sidecar prompt effect +6.6pp [3.1, 10.2]; +prompt vs claw −1.5pp [−6.4, 3.5]
// 0.85×; sidecar normalized +0.78pp [−3.91, 5.86]. Read-only: the registries
// are committed evidence (never modified by any test).
describe('published-number goldens over the canonical registries (issue #025; docs/data/README.md)', () => {
  it('tier-64 verdict: +3.1pp [0.8, 6.3], wall 0.61×, RETIRE (superior)', () => {
    const res = run('config-ab-verdict.mjs', TIER64_REGISTRY, ['--tier', '64']);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      '  aggregate delta    : +3.1pp  (opencode-a − claw-rig)',
      '  90% paired-bootstrap CI: [0.8, 6.3]pp',
      '  ratio (opencode-a median / claw-rig median): 0.61×  ≤ 1.5×  →  MET',
      '  → RETIRE the claw rig at this tier (opencode-a is superior on pass-rate AND faster)',
    ]);
  });

  it('tier-16 verdict: −7.7pp [−13.1, −2.5], wall 0.96×, KEEP', () => {
    const res = run('config-ab-verdict.mjs', TIER16_REGISTRY, ['--tier', '16']);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      '  aggregate delta    : -7.7pp  (opencode-a − claw-rig)',
      '  90% paired-bootstrap CI: [-13.1, -2.5]pp',
      '  ratio (opencode-a median / claw-rig median): 0.96×  ≤ 1.5×  →  MET',
      '  → KEEP the claw rig at this tier',
    ]);
  });

  it('tier-16 normalized sensitivity (§6.3): −5.47pp [−10.94, 0.00] (canonical −7.74pp [−13.06, −2.51])', () => {
    const res = run('config-ab-normalized-ci.mjs', TIER16_REGISTRY, ['--tier', '16']);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      'canonical (drop overflow)     : delta -7.74pp  90% CI [-13.06, -2.51]pp   [pre-registered]',
      'normalized (overflow = fail)  : delta -5.47pp  90% CI [-10.94, 0.00]pp   [sensitivity]',
      'normalized non-inferiority    : CI lower -10.9pp ≤ −5pp  →  NOT MET',
    ]);
  });

  it('sidecar prompt effect (+prompt vs +git): +6.6pp [3.1, 10.2], superior', () => {
    const res = run('config-ab-verdict.mjs', SIDECAR_REGISTRY, [
      '--tier', '16', '--treatment', 'opencode-a+prompt', '--baseline', 'opencode-a+git',
    ]);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      '  aggregate delta    : +6.6pp  (opencode-a+prompt − opencode-a+git)',
      '  90% paired-bootstrap CI: [3.1, 10.2]pp',
      '  → opencode-a+prompt is SUPERIOR to opencode-a+git on pass-rate; wall-clock rule met (mechanism comparison, not a §0a retire decision)',
    ]);
  });

  it('sidecar canonical (+prompt vs claw-rig): −1.5pp [−6.4, 3.5], wall 0.85×, KEEP', () => {
    const res = run('config-ab-verdict.mjs', SIDECAR_REGISTRY, [
      '--tier', '16', '--treatment', 'opencode-a+prompt',
    ]);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      '  aggregate delta    : -1.5pp  (opencode-a+prompt − claw-rig)',
      '  90% paired-bootstrap CI: [-6.4, 3.5]pp',
      '  ratio (opencode-a+prompt median / claw-rig median): 0.85×  ≤ 1.5×  →  MET',
      '  → KEEP the claw rig at this tier',
    ]);
  });

  it('sidecar normalized sensitivity (+prompt vs claw-rig): +0.78pp [−3.91, 5.86], non-inferiority MET', () => {
    const res = run('config-ab-normalized-ci.mjs', SIDECAR_REGISTRY, [
      '--tier', '16', '--treatment', 'opencode-a+prompt',
    ]);
    assert.equal(res.status, 0, `exit ${res.status}; stderr:\n${res.stderr}`);
    assertLines(res.stdout, [
      'canonical (drop overflow)     : delta -1.49pp  90% CI [-6.44, 3.53]pp   [pre-registered]',
      'normalized (overflow = fail)  : delta +0.78pp  90% CI [-3.91, 5.86]pp   [sensitivity]',
      'normalized non-inferiority    : CI lower -3.9pp > −5pp  →  MET',
    ]);
  });
});
