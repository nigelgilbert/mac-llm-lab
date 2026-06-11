// Pre-registered non-inferiority statistic for the OpenCode A/B (issue #015).
//
// Computes the 90% *paired-bootstrap* CI on the `(opencode-a − claw-rig)`
// aggregate pass-rate, paired by task and bootstrapped over the tasks — NOT
// over pooled Bernoulli trials. See OPENCODE-HARNESS-AB-PLAN.md §0a:
//
//   - Unit of analysis: per-task pass-probability, paired by task, bootstrapped
//     over the tasks (the plan fixes the panel at 35). Tasks aren't iid runs,
//     so we resample *tasks*, using each task's N=8 pass-probability as a fixed
//     point estimate — we do NOT resample the 8 trials inside a task and we do
//     NOT pool the 35×8 = 280 individual runs into one Bernoulli urn (that would
//     understate variance by treating tasks as iid).
//   - The headline is the lower bound of the 90% CI on the aggregate delta; the
//     decision rule retires the claw rig iff that lower bound is > −5 pp (and a
//     wall-clock condition handled elsewhere).
//   - Per-task deltas are reported alongside the aggregate so one regressed task
//     is visible, not averaged away.
//
// Pure functions over run-registry rows (lib/schemas/run_registry.schema.json).
// No I/O, no clock, no global RNG — the bootstrap is driven by a seeded PRNG so
// results are bit-for-bit reproducible given (rows, seed, B). This lets it be
// unit-tested against synthetic rows before the real sweep (#014) lands.
//
// Units: pass-rates and deltas are proportions in [0, 1] (a delta of −0.05 is
// the −5 pp margin). The report layer (#016) converts to percentage points.
//
// Usage:
//   import { pairedBootstrapCI } from './paired_bootstrap.js';
//   const result = pairedBootstrapCI(rows, { tier: 64, seed: 12345 });
//   result.aggregateDelta;   // mean over tasks of (opencode − claw) pass-prob
//   result.ci.lower;         // 5th-percentile bootstrap bound (the headline)

const DEFAULT_TREATMENT = 'opencode-a'; // the "B" side: opencode harness bundle
const DEFAULT_BASELINE = 'claw-rig'; // the established claw + llama-server stack

export class PairedBootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PairedBootstrapError';
  }
}

// --- seeded PRNG -------------------------------------------------------------
// mulberry32: a small, fast, well-distributed 32-bit PRNG. Deterministic given
// the seed, which is the whole point — tests pin a seed and assert exact CIs.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- percentile --------------------------------------------------------------
// Linear-interpolation percentile (numpy's default "linear" / type-7) over an
// ascending-sorted array. q in [0, 1]. Used for the bootstrap CI bounds.
export function percentile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) throw new PairedBootstrapError('percentile of empty array');
  if (n === 1) return sortedAsc[0];
  if (q <= 0) return sortedAsc[0];
  if (q >= 1) return sortedAsc[n - 1];
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

// --- eligibility -------------------------------------------------------------
// Layer-A discipline: a run only enters a pass-rate denominator if it produced
// a real pass/fail verdict. harness_error / interrupted rows carry passed===null
// and must drop out (run_registry.schema.json terminal_status + passed docs).
// Exported (issue #012) so the verdict renderer (scripts/config-ab-verdict.mjs)
// applies the exact same predicate instead of carrying a private copy.
export function isEligible(row) {
  return (
    row != null &&
    typeof row.passed === 'boolean' &&
    row.terminal_status !== 'harness_error' &&
    row.terminal_status !== 'interrupted'
  );
}

// Resolve the single tier in play. If `tier` is given, filter to it. Otherwise
// the rows must all share one tier — analysis is per-tier (a tier-64 retire and
// a tier-16 keep is a valid outcome), so mixing tiers in one CI is a caller bug.
function selectTier(rows, tier) {
  if (tier != null) return rows.filter((r) => r.hardware_tier === tier);
  const tiers = new Set(rows.map((r) => r.hardware_tier));
  if (tiers.size > 1) {
    throw new PairedBootstrapError(
      `rows span multiple tiers (${[...tiers].sort().join(', ')}); pass { tier } ` +
        'to analyze one tier at a time',
    );
  }
  return rows;
}

// --- per-task cells ----------------------------------------------------------
// Group eligible rows by (test_id, config_id) into pass counts, then pair each
// task across the two configs. A task is paired only if BOTH configs have at
// least one eligible run for it; tasks present in only one config are reported
// as unpaired and excluded from the aggregate (you can't difference a missing
// cell). N is the eligible run count per cell — ideally 8.
export function summarizeTasks(rows, opts = {}) {
  if (!Array.isArray(rows)) {
    throw new PairedBootstrapError('rows must be an array of registry rows');
  }
  const treatment = opts.treatment ?? DEFAULT_TREATMENT;
  const baseline = opts.baseline ?? DEFAULT_BASELINE;

  const tierRows = selectTier(rows, opts.tier).filter(
    (r) => r.config_id === treatment || r.config_id === baseline,
  );

  // test_id -> { [config_id]: { passes, n } }
  const cells = new Map();
  for (const row of tierRows) {
    if (!isEligible(row)) continue;
    const taskId = row.test_id;
    if (!cells.has(taskId)) cells.set(taskId, {});
    const byConfig = cells.get(taskId);
    const cell = byConfig[row.config_id] ?? { passes: 0, n: 0 };
    cell.n += 1;
    if (row.passed === true) cell.passes += 1;
    byConfig[row.config_id] = cell;
  }

  const perTask = [];
  const unpairedTasks = [];
  // Stable, deterministic task order (sorted by test_id) so per-task output and
  // the bootstrap delta vector are reproducible regardless of row order.
  for (const taskId of [...cells.keys()].sort()) {
    const byConfig = cells.get(taskId);
    const t = byConfig[treatment];
    const b = byConfig[baseline];
    if (!t || !b || t.n === 0 || b.n === 0) {
      unpairedTasks.push({
        test_id: taskId,
        hasTreatment: Boolean(t && t.n > 0),
        hasBaseline: Boolean(b && b.n > 0),
      });
      continue;
    }
    const treatmentPassProb = t.passes / t.n;
    const baselinePassProb = b.passes / b.n;
    perTask.push({
      test_id: taskId,
      treatmentPassProb,
      baselinePassProb,
      delta: treatmentPassProb - baselinePassProb,
      treatmentPasses: t.passes,
      treatmentN: t.n,
      baselinePasses: b.passes,
      baselineN: b.n,
    });
  }

  return { perTask, unpairedTasks, treatment, baseline };
}

// --- main entry point --------------------------------------------------------
// Compute the per-task deltas, the aggregate (treatment − baseline) delta, and
// the paired-bootstrap CI on that aggregate by resampling tasks with replacement.
//
// Options:
//   tier        only analyze rows at this hardware_tier (else rows must be
//               single-tier already).
//   treatment   config_id of the "B" side (default 'opencode-a').
//   baseline    config_id of the baseline (default 'claw-rig').
//   B           number of bootstrap resamples (default 10000).
//   ciLevel     two-sided CI level (default 0.90 → bounds at the 5th/95th pct).
//   seed        PRNG seed (default fixed) — pin it for reproducibility.
//   expectedTasks  optional; if the paired-task count differs, a warning string
//                  is attached (the plan fixes the panel at 35). Not an error,
//                  so partial sweeps can still be inspected.
export function pairedBootstrapCI(rows, opts = {}) {
  const B = opts.B ?? 10000;
  const ciLevel = opts.ciLevel ?? 0.9;
  const seed = opts.seed ?? 0xc0ffee;
  if (!(B > 0) || !Number.isInteger(B)) {
    throw new PairedBootstrapError('B must be a positive integer');
  }
  if (!(ciLevel > 0 && ciLevel < 1)) {
    throw new PairedBootstrapError('ciLevel must be in (0, 1)');
  }

  const { perTask, unpairedTasks, treatment, baseline } = summarizeTasks(rows, opts);

  const n = perTask.length;
  if (n === 0) {
    throw new PairedBootstrapError(
      'no paired tasks: every task is missing an eligible run in one of the ' +
        `two configs (${treatment} / ${baseline})`,
    );
  }

  const deltas = perTask.map((t) => t.delta);
  const aggregateDelta = deltas.reduce((s, d) => s + d, 0) / n;

  // Paired bootstrap: each resample draws n task-indices with replacement and
  // recomputes the mean delta. Resampling indices (not configs) keeps the
  // pairing intact — the same task contributes its treatment and baseline
  // pass-prob together, so within-task correlation is preserved.
  const rng = mulberry32(seed);
  const stats = new Float64Array(B);
  for (let bIdx = 0; bIdx < B; bIdx++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += deltas[Math.floor(rng() * n)];
    }
    stats[bIdx] = sum / n;
  }
  const sorted = Array.from(stats).sort((x, y) => x - y);

  const qLow = (1 - ciLevel) / 2;
  const qHigh = 1 - qLow;
  const lower = percentile(sorted, qLow);
  const upper = percentile(sorted, qHigh);

  const result = {
    tier: opts.tier ?? (rows.length ? rows[0].hardware_tier : null),
    treatment,
    baseline,
    nTasks: n,
    aggregateDelta,
    ci: { level: ciLevel, lower, upper, qLow, qHigh },
    perTask,
    unpairedTasks,
    bootstrap: { B, seed },
  };

  if (opts.expectedTasks != null && n !== opts.expectedTasks) {
    result.warning =
      `expected ${opts.expectedTasks} paired tasks, found ${n}` +
      (unpairedTasks.length ? ` (${unpairedTasks.length} unpaired)` : '');
  }

  return result;
}

// Convenience predicate for the decision rule's statistical limb: the CI lower
// bound is above the non-inferiority margin. marginPp is in percentage points
// (default 5 → −0.05 proportion). The wall-clock limb lives elsewhere; this is
// only the pass-rate condition.
export function meetsNonInferiority(result, { marginPp = 5 } = {}) {
  return result.ci.lower > -(marginPp / 100);
}
