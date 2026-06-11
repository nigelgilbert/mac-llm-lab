#!/usr/bin/env node
// #019 loose-end (synthesis) — normalized-treatment bootstrap CI for tier-16.
//
// The canonical tier-16 verdict (OPENCODE-AB-TIER16-VERDICT.md) reports a point
// estimate for the eligibility-asymmetry sensitivity (delta −7.7 → −5.5 pp when
// claw's 17 context-overflow `harness_error` rows are counted as eligible fails
// instead of dropped) but NO confidence interval — the canonical renderer drops
// harness_error rows before bootstrapping, so it can only produce the −7.7 CI.
//
// This script closes that loose end. It reclassifies context-overflow
// `harness_error` rows on BOTH sides of the comparison as eligible FAILS
// (passed=false, terminal_status → 'timeout'), then runs the SAME #015
// statistic (lib/paired_bootstrap.js, paired by test_id, B=10000, seed
// 0xc0ffee) to get a real CI on the normalized delta.
//
// SYMMETRY (issue #021): the original cut reclassified only the BASELINE side.
// That was numerically correct for the frozen tier-16 dataset (0 OpenCode
// overflow harness_error rows there — oc overflows surfaced as eligible
// timeouts), but post-#002 sweeps re-type OpenCode overflows to harness_error
// too (patch-context-overflow.mjs). One-sided reclassification on such a
// registry would count baseline overflows as fails while silently DROPPING
// treatment overflows, biasing the sensitivity estimate toward the treatment.
// Both sides are therefore reclassified, and the per-side counts are printed.
//
// This is a POST-HOC sensitivity analysis, not the pre-registered §0a decision.
// The canonical verdict stands on the drop-harness_error rule. This only
// quantifies the uncertainty on the asymmetry-corrected estimate so the paper
// can state "−5.5 pp, 90% CI [...]" instead of a bare point.
//
// Usage:
//   node scripts/config-ab-normalized-ci.mjs <registry.jsonl> --tier N [--seed 0xc0ffee] [--B 10000]
//       [--treatment opencode-a] [--baseline claw-rig]
//
// --tier is REQUIRED (positive integer). Post-#021 this is the GENERAL
// symmetric overflow-comparability tool, not a tier-16-only renderer — but an
// omitted tier must not silently pool every tier in the registry under a
// single heading, so there is no default.
//
// Exit codes: 0 on a successful render; 1 = statistic could not be computed
// (PairedBootstrapError, e.g. no paired tasks); 2 = bad args.

import { readRegistry } from '../lib/registry.js';
import { pairedBootstrapCI, PairedBootstrapError } from '../lib/paired_bootstrap.js';
import { VALID_CONFIGS } from '../lib/config.js';

const MARGIN_PP = 5;

function parseArgs(argv) {
  const a = argv.slice(2);
  const opts = { seed: 0xc0ffee, B: 10000, treatment: 'opencode-a', baseline: 'claw-rig' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tier') opts.tier = Number.parseInt(a[++i], 10);
    else if (a[i] === '--seed') opts.seed = Number(a[++i]);
    else if (a[i] === '--B') opts.B = Number.parseInt(a[++i], 10);
    else if (a[i] === '--treatment') opts.treatment = a[++i];
    else if (a[i] === '--baseline') opts.baseline = a[++i];
    else if (!opts.registryPath) opts.registryPath = a[i];
    else { console.error(`unexpected arg: ${a[i]}`); process.exit(2); }
  }
  // --tier is required: without it the script would pool every tier in the
  // registry while the heading names a single one. parseInt of a missing or
  // non-numeric value yields NaN, so one finite-positive-integer check covers
  // both the omitted and the malformed case.
  if (!opts.registryPath || !Number.isFinite(opts.tier) || !Number.isInteger(opts.tier) || opts.tier <= 0) {
    console.error('usage: config-ab-normalized-ci.mjs <registry.jsonl> --tier N [--seed N] [--B N] [--treatment ID] [--baseline ID]  (--tier required: positive integer)');
    process.exit(2);
  }
  for (const side of ['treatment', 'baseline']) {
    if (!VALID_CONFIGS.includes(opts[side])) {
      console.error(`--${side} "${opts[side]}" is not in VALID_CONFIGS {${VALID_CONFIGS.join(', ')}}`);
      process.exit(2);
    }
  }
  if (opts.treatment === opts.baseline) {
    console.error('--treatment and --baseline must differ');
    process.exit(2);
  }
  return opts;
}

function main() {
  const { registryPath, tier, seed, B, treatment: TREATMENT, baseline: BASELINE } = parseArgs(process.argv);
  const all = readRegistry({ registryPath });
  const rows = all.filter((r) => r.hardware_tier === tier); // tier is required (parseArgs)

  // Reclassify: context-overflow harness_error → eligible fail, on BOTH sides
  // of the comparison (issue #021 — symmetric by construction, so a post-#002
  // registry whose treatment-side overflows are also typed harness_error
  // cannot have them silently dropped while the baseline's count as fails).
  // Rows belonging to neither side are left untouched; summarizeTasks filters
  // them out anyway, and the printed per-side counts stay exact in multi-arm
  // registries.
  const reclassified = { [BASELINE]: 0, [TREATMENT]: 0 };
  const normalized = rows.map((r) => {
    if (
      (r.config_id === BASELINE || r.config_id === TREATMENT) &&
      r.terminal_status === 'harness_error' &&
      r.harness_error === 'context_overflow'
    ) {
      reclassified[r.config_id] += 1;
      return { ...r, passed: false, terminal_status: 'timeout' };
    }
    return r;
  });

  const canonical = pairedBootstrapCI(rows, { tier, treatment: TREATMENT, baseline: BASELINE, seed, B });
  const norm = pairedBootstrapCI(normalized, { tier, treatment: TREATMENT, baseline: BASELINE, seed, B });

  const fmt = (ci) =>
    `delta ${(ci.aggregateDelta * 100 >= 0 ? '+' : '')}${(ci.aggregateDelta * 100).toFixed(2)}pp  ` +
    `90% CI [${(ci.ci.lower * 100).toFixed(2)}, ${(ci.ci.upper * 100).toFixed(2)}]pp`;

  // Templated with the actual tier: `--tier 16` must render the byte-identical
  // committed string "tier-16" (the published repro outputs pin it).
  console.log(`=== tier-${tier} normalized-treatment sensitivity (post-hoc) ===`);
  console.log(`registry      : ${registryPath}`);
  console.log(`bootstrap     : B=${B}  seed=0x${(seed >>> 0).toString(16)}`);
  console.log(`reclassified  : ${reclassified[BASELINE]} baseline (${BASELINE}) + ${reclassified[TREATMENT]} treatment (${TREATMENT}) context-overflow harness_error rows → eligible fails`);
  console.log('');
  console.log(`canonical (drop overflow)     : ${fmt(canonical)}   [pre-registered]`);
  console.log(`normalized (overflow = fail)  : ${fmt(norm)}   [sensitivity]`);
  console.log('');
  const normLb = norm.ci.lower * 100;
  const normUb = norm.ci.upper * 100;
  console.log(`normalized non-inferiority    : CI lower ${normLb.toFixed(1)}pp ${normLb > -MARGIN_PP ? '>' : '≤'} −${MARGIN_PP}pp  →  ${normLb > -MARGIN_PP ? 'MET' : 'NOT MET'}`);
  console.log(`normalized excludes 0?        : ${normUb < 0 ? `yes (upper ${normUb.toFixed(1)}pp < 0 → still worse)` : 'no'}`);
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
