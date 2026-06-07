#!/usr/bin/env node
// #016 — tier verdict renderer for the OpenCode config-(a) A/B.
//
// Re-derives EVERY figure in the verdict from the raw run-registry rows and
// applies the two pre-registered §0a decision rules
// (OPENCODE-HARNESS-AB-PLAN.md). It deliberately reuses the real #015 statistic
// (lib/paired_bootstrap.js) and the real registry reader (lib/registry.js) so a
// reviewer auditing the committed verdict doc against the registry sees exactly
// the numbers the report was rendered from — nothing is hand-transcribed.
//
//   Rule 0a.1 (pass-rate non-inferiority): lower bound of the 90% paired-
//     bootstrap CI on (opencode-a − claw-rig) aggregate pass-rate > −5 pp.
//   Rule 0a.2 (speed): opencode-a median wall-clock ≤ 1.5× claw-rig's.
//
// Per-task deltas are printed so a single regressed task is visible, not
// averaged away. Attrition (ineligible rows) is enumerated, never silently
// dropped. Token / server-decode parity are reported as ABSENT from this
// dataset rather than implied (the schema carries no token field; the #014
// sweep ran with server timings OFF — see the doc's deferral note).
//
// Usage:
//   node scripts/config-ab-verdict.mjs <registry.jsonl> [--tier 64] [--seed 0xc0ffee] [--B 10000]
//
// Exit codes: 0 always on a successful render (the verdict — retire/keep — is in
// the output, not the exit code; this is a reporter, not a gate). 2 = bad args.

import { readRegistry } from '../lib/registry.js';
import {
  pairedBootstrapCI,
  summarizeTasks,
  percentile,
  PairedBootstrapError,
} from '../lib/paired_bootstrap.js';
import { VALID_CONFIGS } from '../lib/config.js';

const MARGIN_PP = 5; // §0a non-inferiority margin
const SPEED_MULT = 1.5; // §0a.2 wall-clock ceiling
const TREATMENT = 'opencode-a';
const BASELINE = 'claw-rig';

function parseArgs(argv) {
  const a = argv.slice(2);
  const opts = { seed: 0xc0ffee, B: 10000 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tier') opts.tier = Number.parseInt(a[++i], 10);
    else if (a[i] === '--seed') opts.seed = Number(a[++i]);
    else if (a[i] === '--B') opts.B = Number.parseInt(a[++i], 10);
    else if (!opts.registryPath) opts.registryPath = a[i];
    else { console.error(`unexpected arg: ${a[i]}`); process.exit(2); }
  }
  if (!opts.registryPath) {
    console.error('usage: config-ab-verdict.mjs <registry.jsonl> [--tier 64] [--seed N] [--B N]');
    process.exit(2);
  }
  return opts;
}

const isEligible = (r) =>
  typeof r.passed === 'boolean' &&
  r.terminal_status !== 'harness_error' &&
  r.terminal_status !== 'interrupted';

const durationS = (r) =>
  r.start_time && r.end_time
    ? (new Date(r.end_time) - new Date(r.start_time)) / 1000
    : null;

function median(xs) {
  if (!xs.length) return null;
  return percentile([...xs].sort((a, b) => a - b), 0.5);
}
function pctile(xs, q) {
  if (!xs.length) return null;
  return percentile([...xs].sort((a, b) => a - b), q);
}

function main() {
  const { registryPath, tier, seed, B } = parseArgs(process.argv);
  const all = readRegistry({ registryPath });
  const rows = tier == null ? all : all.filter((r) => r.hardware_tier === tier);

  console.log('=== #016 config-(a) A/B verdict ===');
  console.log(`registry : ${registryPath}`);
  console.log(`rows     : ${all.length}${tier != null ? `  (tier ${tier}: ${rows.length})` : ''}`);
  console.log(`bootstrap: B=${B}  seed=0x${(seed >>> 0).toString(16)}`);

  // --- Provenance per side (one line each, distinct serving fingerprint) -----
  console.log('\n--- Provenance (model_config_id | model | quant | ctx | sampler | prompt_pack | harness) ---');
  for (const cid of VALID_CONFIGS) {
    const fps = new Set(
      rows
        .filter((r) => r.config_id === cid)
        .map((r) =>
          [r.model_config_id, r.model_id, r.quantization, r.context_limit, r.sampler_config_id, r.prompt_pack_version, r.harness_version].join(' | '),
        ),
    );
    for (const fp of fps) console.log(`  ${cid.padEnd(11)} ${fp}`);
  }

  // --- Pass-rate (Rule 0a.1) -------------------------------------------------
  const ci = pairedBootstrapCI(rows, { tier, treatment: TREATMENT, baseline: BASELINE, seed, B });
  const lowerPp = ci.ci.lower * 100;
  const upperPp = ci.ci.upper * 100;
  const deltaPp = ci.aggregateDelta * 100;
  const rule1 = ci.ci.lower > -(MARGIN_PP / 100);
  const superior = ci.ci.lower > 0; // CI excludes 0 from below

  console.log('\n--- Per-task pass-rates (paired, sorted by test_id) ---');
  console.log(`  ${'test_id'.padEnd(34)} ${BASELINE.padEnd(10)} ${TREATMENT.padEnd(11)} delta`);
  for (const t of ci.perTask) {
    console.log(
      `  ${t.test_id.padEnd(34)} ${`${t.baselinePasses}/${t.baselineN}`.padEnd(10)} ` +
        `${`${t.treatmentPasses}/${t.treatmentN}`.padEnd(11)} ${(t.delta * 100 >= 0 ? '+' : '')}${(t.delta * 100).toFixed(1)}pp`,
    );
  }
  if (ci.unpairedTasks.length) {
    console.log(`  UNPAIRED (${ci.unpairedTasks.length}):`);
    for (const u of ci.unpairedTasks) console.log(`    ${u.test_id} (baseline=${u.hasBaseline} treatment=${u.hasTreatment})`);
  } else {
    console.log('  (0 unpaired — every task has eligible runs on both sides)');
  }

  const minDelta = Math.min(...ci.perTask.map((t) => t.delta));
  const maxDelta = Math.max(...ci.perTask.map((t) => t.delta));
  const maxTask = ci.perTask.find((t) => t.delta === maxDelta);

  console.log('\n--- Rule 0a.1: pass-rate non-inferiority ---');
  console.log(`  paired tasks       : ${ci.nTasks}`);
  console.log(`  aggregate delta    : ${deltaPp >= 0 ? '+' : ''}${deltaPp.toFixed(1)}pp  (opencode-a − claw-rig)`);
  console.log(`  90% paired-bootstrap CI: [${lowerPp.toFixed(1)}, ${upperPp.toFixed(1)}]pp`);
  console.log(`  worst per-task delta: ${(minDelta * 100 >= 0 ? '+' : '')}${(minDelta * 100).toFixed(1)}pp   best: +${(maxDelta * 100).toFixed(1)}pp (${maxTask?.test_id})`);
  console.log(`  margin             : CI lower ${lowerPp.toFixed(1)}pp ${rule1 ? '>' : '≤'} −${MARGIN_PP}pp  →  ${rule1 ? 'MET' : 'NOT MET'}`);
  if (rule1 && superior) console.log(`  note               : CI excludes 0 from below → superior, not merely non-inferior`);

  // --- Wall-clock (Rule 0a.2) ------------------------------------------------
  console.log('\n--- Rule 0a.2: wall-clock ---');
  const stats = {};
  for (const cid of [BASELINE, TREATMENT]) {
    const sideAll = rows.filter((r) => r.config_id === cid);
    const durAll = sideAll.map(durationS).filter((d) => d != null);
    const durElig = sideAll.filter(isEligible).map(durationS).filter((d) => d != null);
    stats[cid] = { durAll, durElig, n: sideAll.length };
    console.log(
      `  ${cid.padEnd(11)} median ${median(durAll).toFixed(1)}s  p90 ${pctile(durAll, 0.9).toFixed(1)}s  ` +
        `max ${Math.max(...durAll).toFixed(1)}s  (n=${durAll.length}; eligible-only median ${median(durElig).toFixed(1)}s)`,
    );
  }
  const ratio = median(stats[TREATMENT].durAll) / median(stats[BASELINE].durAll);
  const rule2 = ratio <= SPEED_MULT;
  console.log(`  ratio (oc median / claw median): ${ratio.toFixed(2)}×  ${rule2 ? '≤' : '>'} ${SPEED_MULT}×  →  ${rule2 ? 'MET' : 'NOT MET'}`);

  // --- Iteration parity ------------------------------------------------------
  console.log('\n--- Iteration parity (iters_count) ---');
  for (const cid of [BASELINE, TREATMENT]) {
    const it = rows.filter((r) => r.config_id === cid && typeof r.iters_count === 'number').map((r) => r.iters_count);
    console.log(`  ${cid.padEnd(11)} median ${median(it)}  min ${Math.min(...it)}  max ${Math.max(...it)}  (n=${it.length})`);
  }

  // --- Token parity ----------------------------------------------------------
  const hasTokens = rows.some((r) =>
    Object.keys(r).some((k) => /token/i.test(k)),
  );
  console.log('\n--- Token parity ---');
  console.log(`  ${hasTokens ? 'token fields present' : 'NOT RECORDED in this dataset — the run_registry schema carries no token field; deferred to the #021 transcript adapter.'}`);

  // --- Attrition -------------------------------------------------------------
  console.log('\n--- Attrition (terminal_status; eligibility per lib/paired_bootstrap.isEligible) ---');
  for (const cid of [BASELINE, TREATMENT]) {
    const side = rows.filter((r) => r.config_id === cid);
    const hist = {};
    for (const r of side) hist[r.terminal_status] = (hist[r.terminal_status] || 0) + 1;
    const elig = side.filter(isEligible).length;
    console.log(`  ${cid.padEnd(11)} ${side.length} rows  ${JSON.stringify(hist)}  → ${elig} eligible`);
  }
  const nonDone = rows.filter((r) => r.terminal_status !== 'done');
  const droppedCount = nonDone.filter((r) => !isEligible(r)).length;
  console.log(`  non-done rows (${nonDone.length}; ${droppedCount} dropped as ineligible):`);
  for (const r of nonDone) {
    console.log(
      `    ${r.config_id.padEnd(11)} ${r.test_id.padEnd(20)} ${r.terminal_status.padEnd(13)} ` +
        `passed=${r.passed} ${isEligible(r) ? '[eligible]' : '[DROPPED]'}` +
        `${r.harness_error ? ` err=${JSON.stringify(r.harness_error)}` : ''}`,
    );
  }

  // --- Verdict ---------------------------------------------------------------
  const retire = rule1 && rule2;
  console.log('\n=== VERDICT (tier-' + tier + ') ===');
  console.log(`  Rule 0a.1 (pass-rate non-inferiority): ${rule1 ? 'MET' : 'NOT MET'}`);
  console.log(`  Rule 0a.2 (wall-clock ≤ ${SPEED_MULT}×)       : ${rule2 ? 'MET' : 'NOT MET'}`);
  console.log(
    `  → ${retire ? 'RETIRE the claw rig at this tier' : 'KEEP the claw rig at this tier'}` +
      (retire && superior ? ' (OpenCode is superior on pass-rate AND faster)' : ''),
  );

  if (ci.warning) console.log(`\n  ⚠ ${ci.warning}`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  if (e instanceof PairedBootstrapError) {
    console.error(`\nFAIL: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
