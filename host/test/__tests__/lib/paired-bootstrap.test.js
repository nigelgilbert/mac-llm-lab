// Issue #015: paired-bootstrap non-inferiority CI library. Pins the pre-
// registered statistic from OPENCODE-HARNESS-AB-PLAN.md §0a — the 90% paired-
// bootstrap CI on (opencode-a − claw-rig) aggregate pass-rate, paired by task
// and resampled over tasks (NOT over pooled Bernoulli trials) — plus the per-
// task deltas. Every case is deterministically seeded so the asserted CI bounds
// are reproducible.
//
// Synthetic cells are built at N=8 (the plan's per-cell sample size). The helper
// `cell()` emits N rows for one (task, config) cell with `passes` of them passing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  pairedBootstrapCI,
  summarizeTasks,
  meetsNonInferiority,
  mulberry32,
  percentile,
  PairedBootstrapError,
} from '../../lib/paired_bootstrap.js';

// Emit N rows for one (task, config) cell; the first `passes` pass. Defaults
// mirror a clean tier-64 `done` run so eligibility is the common path.
function cell(test_id, config_id, passes, n = 8, { tier = 64, terminal_status = 'done' } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      run_id: `${test_id}-${config_id}-${i}`,
      config_id,
      test_id,
      hardware_tier: tier,
      terminal_status,
      passed: i < passes,
    });
  }
  return out;
}

// Build a paired panel: tasks is an array of { id, t, b } giving treatment and
// baseline pass counts (out of N) per task. Returns the flat row list.
function panel(tasks, opts = {}) {
  const rows = [];
  for (const task of tasks) {
    rows.push(...cell(task.id, 'opencode-a', task.t, 8, opts));
    rows.push(...cell(task.id, 'claw-rig', task.b, 8, opts));
  }
  return rows;
}

describe('paired-bootstrap CI library (issue #015)', () => {
  describe('per-task deltas and aggregate', () => {
    it('returns each task delta = treatment − baseline pass-prob, sorted by test_id', () => {
      const rows = panel([
        { id: 'csv-parser', t: 7, b: 6 }, // +0.125
        { id: 'expression-eval', t: 4, b: 8 }, // −0.5
      ]);
      const { perTask } = summarizeTasks(rows, { tier: 64 });

      assert.equal(perTask.length, 2);
      assert.deepEqual(perTask.map((p) => p.test_id), ['csv-parser', 'expression-eval']);

      const csv = perTask[0];
      assert.equal(csv.treatmentPassProb, 7 / 8);
      assert.equal(csv.baselinePassProb, 6 / 8);
      assert.equal(csv.delta, 7 / 8 - 6 / 8);
      assert.equal(csv.treatmentPasses, 7);
      assert.equal(csv.treatmentN, 8);
      assert.equal(csv.baselineN, 8);

      assert.equal(perTask[1].delta, 4 / 8 - 8 / 8);
    });

    it('aggregate delta is the mean of per-task deltas (B − claw)', () => {
      // Two tasks: +0.5 and −0.5 → mean 0.
      const rows = panel([
        { id: 't1', t: 8, b: 4 },
        { id: 't2', t: 4, b: 8 },
      ]);
      const result = pairedBootstrapCI(rows, { tier: 64, seed: 12345 });
      assert.equal(result.aggregateDelta, 0);
      assert.equal(result.nTasks, 2);
    });
  });

  describe('resamples over tasks, not pooled runs', () => {
    it('a ±0.5 two-task panel yields a wide discrete CI (=[−0.5, +0.5])', () => {
      // Task deltas +0.5 and −0.5. Resampling 2 *tasks* with replacement gives
      // a mean in {−0.5, 0, +0.5} with probs {0.25, 0.5, 0.25}, so the 5th/95th
      // percentiles land squarely on ∓0.5. If the library instead pooled the
      // 2×8 = 16 Bernoulli trials (treatment 12/16, baseline 12/16) the CI would
      // be a narrow band around 0 — nothing like ±0.5. The wide bound is the
      // signature of correct task-level resampling.
      const rows = panel([
        { id: 't1', t: 8, b: 4 },
        { id: 't2', t: 4, b: 8 },
      ]);
      const result = pairedBootstrapCI(rows, { tier: 64, seed: 12345, B: 10000 });
      assert.equal(result.ci.lower, -0.5);
      assert.equal(result.ci.upper, 0.5);
    });

    it('a single task collapses the bootstrap CI to that task’s delta', () => {
      // With one task every resample picks it, so the CI is degenerate. This is
      // the limiting case of task-level (not trial-level) resampling.
      const rows = panel([{ id: 'only', t: 5, b: 7 }]); // delta = −0.25
      const result = pairedBootstrapCI(rows, { tier: 64, seed: 1 });
      assert.equal(result.aggregateDelta, -0.25);
      assert.equal(result.ci.lower, -0.25);
      assert.equal(result.ci.upper, -0.25);
    });
  });

  describe('decision-rule synthetic cases (deterministic seeding)', () => {
    it('clear non-inferior: CI lower bound well above the −5pp margin', () => {
      // 20 tasks at parity (8/8 vs 8/8 → delta 0) and 15 slightly better
      // (7/8 vs 6/8 → +0.125). Every task delta ≥ 0, so the lower bound is ≥ 0.
      const tasks = [];
      for (let i = 0; i < 20; i++) tasks.push({ id: `par-${i}`, t: 8, b: 8 });
      for (let i = 0; i < 15; i++) tasks.push({ id: `up-${i}`, t: 7, b: 6 });
      const result = pairedBootstrapCI(panel(tasks), { tier: 64, seed: 5, expectedTasks: 35 });

      assert.equal(result.nTasks, 35);
      assert.ok(result.aggregateDelta > 0, `expected positive aggregate, got ${result.aggregateDelta}`);
      assert.ok(result.ci.lower >= 0, `expected lower ≥ 0, got ${result.ci.lower}`);
      assert.ok(result.ci.lower > -0.05);
      assert.equal(meetsNonInferiority(result), true);
      assert.equal(result.warning, undefined); // 35 == expected → no warning
    });

    it('clear inferior: entire CI sits below the −5pp margin', () => {
      // 20 tasks at −0.875 (1/8 vs 8/8) and 15 at −0.75 (2/8 vs 8/8).
      const tasks = [];
      for (let i = 0; i < 20; i++) tasks.push({ id: `bad-${i}`, t: 1, b: 8 });
      for (let i = 0; i < 15; i++) tasks.push({ id: `worse-${i}`, t: 2, b: 8 });
      const result = pairedBootstrapCI(panel(tasks), { tier: 64, seed: 9 });

      assert.ok(result.aggregateDelta < -0.5);
      assert.ok(result.ci.upper < -0.05, `expected upper < −0.05, got ${result.ci.upper}`);
      assert.equal(meetsNonInferiority(result), false);
    });

    it('borderline: aggregate at exactly −5pp but CI straddles the margin', () => {
      // 6 tasks +0.25 (8/8 vs 6/8) and 4 tasks −0.5 (2/8 vs 6/8) → mean −0.05.
      // The spread pulls the lower bound below the margin while the upper bound
      // stays above it, so the non-inferiority verdict is "not established".
      const tasks = [];
      for (let i = 0; i < 6; i++) tasks.push({ id: `plus-${i}`, t: 8, b: 6 });
      for (let i = 0; i < 4; i++) tasks.push({ id: `minus-${i}`, t: 2, b: 6 });
      const result = pairedBootstrapCI(panel(tasks), { tier: 64, seed: 777 });

      assert.ok(Math.abs(result.aggregateDelta - -0.05) < 1e-12);
      assert.ok(result.ci.lower < -0.05, `expected lower < −0.05, got ${result.ci.lower}`);
      assert.ok(result.ci.upper > -0.05, `expected upper > −0.05, got ${result.ci.upper}`);
      assert.equal(meetsNonInferiority(result), false);
    });
  });

  describe('reproducibility', () => {
    it('same seed → identical CI; point estimate is RNG-independent', () => {
      const rows = panel([
        { id: 't1', t: 8, b: 4 },
        { id: 't2', t: 4, b: 8 },
        { id: 't3', t: 6, b: 5 },
      ]);
      const a = pairedBootstrapCI(rows, { tier: 64, seed: 42 });
      const b = pairedBootstrapCI(rows, { tier: 64, seed: 42 });
      assert.deepEqual(a.ci, b.ci);

      const c = pairedBootstrapCI(rows, { tier: 64, seed: 99 });
      // Different seed: the aggregate point estimate is deterministic regardless,
      assert.equal(a.aggregateDelta, c.aggregateDelta);
    });
  });

  describe('grouping by config_id and tier', () => {
    it('pairs only tasks present in both configs; reports unpaired tasks', () => {
      const rows = [
        ...cell('paired', 'opencode-a', 8),
        ...cell('paired', 'claw-rig', 8),
        ...cell('only-claw', 'claw-rig', 8), // no treatment cell
        ...cell('only-oc', 'opencode-a', 8), // no baseline cell
      ];
      const { perTask, unpairedTasks } = summarizeTasks(rows, { tier: 64 });

      assert.deepEqual(perTask.map((p) => p.test_id), ['paired']);
      const unpairedIds = unpairedTasks.map((u) => u.test_id).sort();
      assert.deepEqual(unpairedIds, ['only-claw', 'only-oc']);
      const onlyClaw = unpairedTasks.find((u) => u.test_id === 'only-claw');
      assert.equal(onlyClaw.hasBaseline, true);
      assert.equal(onlyClaw.hasTreatment, false);
    });

    it('filters to the requested tier and ignores other tiers', () => {
      const rows = [
        ...panel([{ id: 't1', t: 8, b: 4 }], { tier: 64 }),
        ...panel([{ id: 't1', t: 1, b: 8 }], { tier: 16 }), // different tier, same task id
      ];
      const result = pairedBootstrapCI(rows, { tier: 64, seed: 1 });
      assert.equal(result.tier, 64);
      assert.equal(result.nTasks, 1);
      assert.equal(result.perTask[0].delta, 8 / 8 - 4 / 8); // the tier-64 cell only
    });

    it('throws when rows span multiple tiers and no tier is given', () => {
      const rows = [
        ...panel([{ id: 't1', t: 8, b: 4 }], { tier: 64 }),
        ...panel([{ id: 't2', t: 4, b: 8 }], { tier: 16 }),
      ];
      assert.throws(() => pairedBootstrapCI(rows, { seed: 1 }), PairedBootstrapError);
    });
  });

  describe('Layer-A eligibility', () => {
    it('drops harness_error / interrupted (passed=null) rows from denominators', () => {
      const rows = [
        ...cell('e1', 'opencode-a', 8),
        ...cell('e1', 'claw-rig', 4, 6), // 6 clean rows, 4 pass
        // two harness_error rows for the same baseline cell — must not count.
        { run_id: 'h1', config_id: 'claw-rig', test_id: 'e1', hardware_tier: 64, terminal_status: 'harness_error', passed: null },
        { run_id: 'i1', config_id: 'claw-rig', test_id: 'e1', hardware_tier: 64, terminal_status: 'interrupted', passed: null },
      ];
      const { perTask } = summarizeTasks(rows, { tier: 64 });
      assert.equal(perTask.length, 1);
      assert.equal(perTask[0].baselineN, 6); // 8 rows in, 2 excluded
      assert.equal(perTask[0].baselinePasses, 4);
      assert.equal(perTask[0].baselinePassProb, 4 / 6);
    });
  });

  describe('input validation', () => {
    it('throws when no tasks are paired', () => {
      const rows = cell('only-claw', 'claw-rig', 8);
      assert.throws(() => pairedBootstrapCI(rows, { tier: 64, seed: 1 }), PairedBootstrapError);
    });

    it('rejects bad B / ciLevel', () => {
      const rows = panel([{ id: 't1', t: 8, b: 8 }]);
      assert.throws(() => pairedBootstrapCI(rows, { tier: 64, B: 0 }), PairedBootstrapError);
      assert.throws(() => pairedBootstrapCI(rows, { tier: 64, ciLevel: 1.5 }), PairedBootstrapError);
    });

    it('attaches a warning when paired-task count differs from expectedTasks', () => {
      const rows = panel([{ id: 't1', t: 8, b: 8 }]);
      const result = pairedBootstrapCI(rows, { tier: 64, seed: 1, expectedTasks: 35 });
      assert.match(result.warning, /expected 35 paired tasks, found 1/);
    });
  });

  describe('numeric primitives', () => {
    it('mulberry32 is deterministic and in [0, 1)', () => {
      const a = mulberry32(123);
      const b = mulberry32(123);
      for (let i = 0; i < 5; i++) {
        const x = a();
        assert.equal(x, b());
        assert.ok(x >= 0 && x < 1);
      }
    });

    it('percentile interpolates linearly between order statistics', () => {
      const xs = [0, 1, 2, 3, 4]; // already ascending
      assert.equal(percentile(xs, 0), 0);
      assert.equal(percentile(xs, 1), 4);
      assert.equal(percentile(xs, 0.5), 2);
      assert.equal(percentile(xs, 0.25), 1);
    });
  });
});
