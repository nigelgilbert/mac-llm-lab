#!/usr/bin/env node
// Paired-run gate for the config-vs-config sweep driver (run-config-ab.sh).
//
// After a sweep the driver appends every arm's rows to a single registry
// file. This script proves the two things the driver exists to guarantee, and
// EXITS NON-ZERO if either fails — so a silently-mislabeled or silently-dropped
// row turns the whole driver red instead of producing a hollow "green" sweep:
//
//   1. config_id discipline. EVERY row in the registry carries a config_id in
//      the VALID_CONFIGS enum. A row with a missing/foreign config_id
//      is the footgun this gate was written to close: paired_bootstrap
//      (lib/paired_bootstrap.js summarizeTasks) filters on
//      `r.config_id === treatment | baseline` with NO default, so a row without
//      the key is SILENTLY excluded from pairing. We refuse to let one exist.
//
//   2. Both sides bucket. paired_bootstrap, run over these rows, must find at
//      least one eligible run for BOTH configs — i.e. the baseline is NOT
//      dropped to zero.
//
// It deliberately reuses lib/paired_bootstrap.js (the real #015 statistic) and
// lib/registry.js (the real reader) rather than re-deriving buckets, so this
// gate sees exactly what the report layer (#016) will.
//
// Usage:
//   node scripts/config-ab-pairing-check.mjs <registry.jsonl> [--tier 64] \
//       [--treatment opencode-a] [--baseline claw-rig]
//
// --treatment/--baseline (defaults opencode-a / claw-rig) point invariant 2 at
// a specific arm pair — needed once a registry holds more than two configs
// (e.g. the sidecar-port arms opencode-a+git / opencode-a+prompt).
//
// Exit codes: 0 = both invariants hold; 1 = a row lacks/forges config_id, or a
// config bucketed zero eligible runs, or no paired tasks. 2 = bad invocation.

import { readRegistry } from '../lib/registry.js';
import { summarizeTasks, pairedBootstrapCI, PairedBootstrapError } from '../lib/paired_bootstrap.js';
import { VALID_CONFIGS } from '../lib/config.js';

function parseArgs(argv) {
  const a = argv.slice(2);
  const opts = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tier') opts.tier = Number.parseInt(a[++i], 10);
    else if (a[i] === '--treatment') opts.treatment = a[++i];
    else if (a[i] === '--baseline') opts.baseline = a[++i];
    else if (!opts.registryPath) opts.registryPath = a[i];
    else { console.error(`unexpected arg: ${a[i]}`); process.exit(2); }
  }
  if (!opts.registryPath) {
    console.error('usage: config-ab-pairing-check.mjs <registry.jsonl> [--tier 64] [--treatment ID] [--baseline ID]');
    process.exit(2);
  }
  for (const side of ['treatment', 'baseline']) {
    if (opts[side] != null && !VALID_CONFIGS.includes(opts[side])) {
      console.error(`--${side} "${opts[side]}" is not in VALID_CONFIGS {${VALID_CONFIGS.join(', ')}}`);
      process.exit(2);
    }
  }
  return opts;
}

function main() {
  const { registryPath, tier, treatment: treatmentOpt, baseline: baselineOpt } = parseArgs(process.argv);
  const rows = readRegistry({ registryPath });

  console.log(`=== config-ab paired-run gate ===`);
  console.log(`registry : ${registryPath}`);
  console.log(`rows     : ${rows.length}${tier != null ? `  (tier filter: ${tier})` : ''}`);

  if (rows.length === 0) {
    console.error(`FAIL: registry is empty — neither phase emitted a row (RUN_REGISTRY_EMIT unset? reporter unwired? both phases wedged?).`);
    process.exit(1);
  }

  // --- Invariant 1: config_id discipline on EVERY row ----------------------
  // assembleRow defaults config_id to 'claw-rig' and resolveConfigId never
  // returns out-of-enum, so a clean inline-emit row can't violate this — which
  // is exactly why we assert it: a violation means a row reached the registry
  // by some OTHER path (legacy harvest, hand-edit, schema drift), and that is
  // the row paired_bootstrap would silently drop.
  const bad = [];
  const byConfig = new Map();
  for (let i = 0; i < rows.length; i++) {
    const cid = rows[i].config_id;
    if (cid == null || !VALID_CONFIGS.includes(cid)) {
      bad.push({ idx: i, run_id: rows[i].run_id ?? '<no run_id>', config_id: cid ?? '<missing>' });
      continue;
    }
    byConfig.set(cid, (byConfig.get(cid) ?? 0) + 1);
  }
  console.log(`\nconfig_id histogram (all rows):`);
  for (const c of VALID_CONFIGS) console.log(`  ${c.padEnd(12)} ${byConfig.get(c) ?? 0}`);
  if (bad.length) {
    console.error(`\nFAIL: ${bad.length} row(s) carry a missing/foreign config_id (would be SILENTLY dropped from pairing):`);
    for (const b of bad.slice(0, 10)) console.error(`  row[${b.idx}] run_id=${b.run_id} config_id=${b.config_id}`);
    process.exit(1);
  }
  console.log(`  OK — every row carries a config_id in {${VALID_CONFIGS.join(', ')}}`);

  // --- Invariant 2: both sides bucket, claw baseline not dropped ------------
  // summarizeTasks gives the eligible-run counts per cell exactly as the
  // bootstrap (and the #016 report) will see them.
  const { perTask, unpairedTasks, treatment, baseline } = summarizeTasks(rows, { tier, treatment: treatmentOpt, baseline: baselineOpt });

  let baselineEligible = 0;
  let treatmentEligible = 0;
  for (const t of perTask) {
    baselineEligible += t.baselineN;
    treatmentEligible += t.treatmentN;
  }
  // perTask only contains PAIRED tasks; unpaired tasks (present in just one
  // config) still tell us whether a side produced eligible runs at all.
  const unpairedWithBaseline = unpairedTasks.filter((u) => u.hasBaseline).length;
  const unpairedWithTreatment = unpairedTasks.filter((u) => u.hasTreatment).length;

  console.log(`\npaired tasks: ${perTask.length}   unpaired: ${unpairedTasks.length}`);
  for (const t of perTask) {
    console.log(
      `  ${t.test_id.padEnd(20)} ` +
      `${baseline}=${t.baselinePasses}/${t.baselineN}  ` +
      `${treatment}=${t.treatmentPasses}/${t.treatmentN}  ` +
      `delta=${(t.delta * 100).toFixed(1)}pp`,
    );
  }
  for (const u of unpairedTasks) {
    console.log(`  ${u.test_id.padEnd(20)} UNPAIRED (baseline=${u.hasBaseline} treatment=${u.hasTreatment})`);
  }

  const failures = [];
  if (perTask.length === 0) {
    failures.push(
      `no PAIRED tasks: no test_id has an eligible run in BOTH configs ` +
      `(baseline eligible on ${unpairedWithBaseline} unpaired task(s), ` +
      `treatment on ${unpairedWithTreatment}).`,
    );
  }
  if (baselineEligible === 0) {
    failures.push(`baseline ('${baseline}') bucketed ZERO eligible paired runs — the exact regression this gate guards against.`);
  }
  if (treatmentEligible === 0) {
    failures.push(`treatment ('${treatment}') bucketed ZERO eligible paired runs.`);
  }

  if (failures.length) {
    console.error(`\nFAIL:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  // Run the real statistic too, so the gate also smoke-tests the #015 entry
  // point on live rows (degenerate CI at 1 task is fine — we assert bucketing,
  // not significance).
  try {
    const ci = pairedBootstrapCI(rows, { tier, treatment: treatmentOpt, baseline: baselineOpt });
    console.log(
      `\npaired_bootstrap: nTasks=${ci.nTasks}  aggregateDelta=${(ci.aggregateDelta * 100).toFixed(1)}pp  ` +
      `90% CI [${(ci.ci.lower * 100).toFixed(1)}, ${(ci.ci.upper * 100).toFixed(1)}]pp`,
    );
  } catch (e) {
    if (!(e instanceof PairedBootstrapError)) throw e;
    // Shouldn't happen given the guards above, but surface rather than crash.
    console.error(`\nFAIL: pairedBootstrapCI threw: ${e.message}`);
    process.exit(1);
  }

  console.log(
    `\nPASS — every row config_id-stamped; both sides bucketed ` +
    `(${baseline}=${baselineEligible}, ${treatment}=${treatmentEligible} eligible paired runs). Baseline NOT dropped.`,
  );
  process.exit(0);
}

main();
