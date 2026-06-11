#!/usr/bin/env node
// Row-accountability audit for sweep drivers (#003; originally Sprint 1.14 for
// the retired run-overnight-screen.sh driver): enumerate every
// (test × tier × config × rep) cell a sweep intends to attempt, write it as a
// CSV plan, and post-sweep diff the run-registry JSONL against it so cells
// that were planned but produced no row are surfaced LOUDLY — those are
// harness drops (reporter SIGTERM window, missing runDir, sidecar hiccup,
// per-cell timeout kill), not model fails.
//
// LIVE CALLER: host/test/run-config-ab.sh (#003). The driver writes the plan
// (TASKS × REPEATS × ARMS, single tier) before its arms phase, takes a
// registry line-count watermark at start, and diffs after the gate with
// `--since-line <watermark>` so REUSE_ROWS=1 sweeps audit only the rows THIS
// sweep appended. A nonzero diff turns the sweep red (driver exit 2).
//
// Research-team direction (TIER-EVAL-MEMO-20260429-pre-overnight.md): "the
// expected row count is clarified before kickoff" so Wilson CIs in Sprint 2
// are computed against planned N rather than observed N.
//
// Eligibility rule: a tier-eval test is "emit-eligible" if it invokes a
// registry-writing entry point — either the lib/runAgent.js helper (Sprint
// 1.22) or the underlying writeAssertionResult primitive directly. The three
// streamMessage-based tests (latency, tool-discipline, prose-quality) do not
// call either and so do not produce registry rows; they're excluded from the
// expected manifest (and `plan --filter` REJECTS them rather than planning
// rows that can never appear).
//
// Subcommands:
//   plan   — write expected_attempts.<sweep>.csv
//   diff   — diff a registry JSONL against an expected CSV
//
// Usage:
//   node scripts/expected-attempts.mjs plan \
//        --tests-dir host/test/__tests__/tier-eval \
//        --tiers "64" --configs "opencode-a opencode-a+git" --reps 1 \
//        [--filter "deep-equal wordy"] \
//        --out host/test/.claw-runtime/expected_attempts.<sweep>.csv
//
//   node scripts/expected-attempts.mjs diff \
//        --expected host/test/.claw-runtime/expected_attempts.<sweep>.csv \
//        --registry host/test/.claw-runtime/run_registry.<sweep>.jsonl \
//        [--since-line <n>]   # skip the first n registry lines (REUSE_ROWS watermark)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HEADER = 'test_id,hardware_tier,config_id,rep_index';

function parseArgs(argv) {
  const a = argv.slice(2);
  const cmd = a.shift();
  const opts = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--tests-dir') opts.testsDir = a[++i];
    else if (k === '--tiers') opts.tiers = a[++i];
    else if (k === '--configs') opts.configs = a[++i];
    else if (k === '--reps') opts.reps = parseInt(a[++i], 10);
    else if (k === '--out') opts.outPath = a[++i];
    else if (k === '--filter') opts.filter = a[++i];
    else if (k === '--expected') opts.expectedPath = a[++i];
    else if (k === '--registry') opts.registryPath = a[++i];
    else if (k === '--since-line') opts.sinceLine = parseInt(a[++i], 10);
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return { cmd, opts };
}

function printHelp() {
  console.error(`Usage:
  node expected-attempts.mjs plan --tests-dir <dir> --tiers "16 32 64" --configs "id1 id2" --reps 8 --out <csv> [--filter "stem1 stem2 ..."]
  node expected-attempts.mjs diff --expected <csv> --registry <jsonl> [--since-line <n>]`);
}

export function isEmitEligible(filePath) {
  // A tier-eval test produces a registry row iff its source references one of
  // the two registry-writing entry points: the lib/runAgent.js helper (Sprint
  // 1.22, ex-runAgentSetup) or the underlying writeAssertionResult primitive
  // (for tests that opt out of the helper). Family C (latency / prose-quality
  // / tool-discipline) references neither.
  //
  // Note: listEligibleTests() below does not recurse, so direct-primitive
  // callers under __tests__/tier-eval/frontier/ are not reached — see that
  // directory's README for why frontier tests are deliberately excluded from
  // the screening pipeline.
  const src = fs.readFileSync(filePath, 'utf8');
  return /\b(runAgent|writeAssertionResult)\b/.test(src);
}

function listEligibleTests(testsDir) {
  const out = [];
  for (const fname of fs.readdirSync(testsDir).sort()) {
    if (!fname.endsWith('.test.js')) continue;
    const full = path.join(testsDir, fname);
    if (!isEmitEligible(full)) continue;
    out.push(fname.replace(/\.test\.js$/, ''));
  }
  return out;
}

function planCmd(opts) {
  if (!opts.testsDir) throw new Error('--tests-dir required');
  if (!opts.tiers) throw new Error('--tiers required');
  if (!opts.configs || !opts.configs.trim()) throw new Error('--configs required (space-separated config_ids — the sweep ARMS)');
  if (!opts.reps || opts.reps < 1) throw new Error('--reps required (>=1)');
  if (!opts.outPath) throw new Error('--out required');

  const tiers = opts.tiers.trim().split(/\s+/).map((s) => parseInt(s, 10));
  for (const t of tiers) {
    if (![16, 32, 64].includes(t)) throw new Error(`invalid tier: ${t}`);
  }
  const configs = opts.configs.trim().split(/\s+/);
  let tests = listEligibleTests(opts.testsDir);
  if (opts.filter) {
    const want = new Set(opts.filter.trim().split(/\s+/).filter(Boolean));
    const missing = [...want].filter((s) => !tests.includes(s));
    if (missing.length) {
      throw new Error(
        `--filter mentions test(s) that are unknown or not emit-eligible (no ` +
        `runAgent/writeAssertionResult call → no registry row to audit): ${missing.join(', ')}`,
      );
    }
    tests = tests.filter((s) => want.has(s));
  }
  if (tests.length === 0) throw new Error(`no emit-eligible tests under ${opts.testsDir}`);

  const lines = [HEADER];
  // Order matches run-config-ab.sh's sweep loop: config (arm) outermost, then
  // tier, then test stem, then rep (the driver's FILTER repeats each stem
  // REPEATS times consecutively). Order only affects readability — the diff
  // keys on the full (test, tier, config, rep) tuple.
  for (const config_id of configs) {
    for (const tier of tiers) {
      for (const test_id of tests) {
        for (let rep = 1; rep <= opts.reps; rep++) {
          lines.push(`${test_id},${tier},${config_id},${rep}`);
        }
      }
    }
  }
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, lines.join('\n') + '\n');
  const cells = lines.length - 1;
  console.error(`expected-attempts: wrote ${cells} cells (${tests.length} tests × ${tiers.length} tiers × ${configs.length} configs × ${opts.reps} reps) → ${opts.outPath}`);
}

function readExpected(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  if (lines[0] !== HEADER) throw new Error(`header mismatch in ${p} (want "${HEADER}")`);
  const cells = new Map();
  for (const line of lines.slice(1)) {
    const [test_id, tier, config_id, rep] = line.split(',');
    const key = `${test_id}|${tier}|${config_id}|${rep}`;
    cells.set(key, { test_id, tier: parseInt(tier, 10), config_id, rep: parseInt(rep, 10) });
  }
  return cells;
}

function diffCmd(opts) {
  if (!opts.expectedPath) throw new Error('--expected required');
  if (!opts.registryPath) throw new Error('--registry required');
  const sinceLine = opts.sinceLine ?? 0;
  if (!Number.isInteger(sinceLine) || sinceLine < 0) throw new Error('--since-line must be a non-negative integer');

  const expected = readExpected(opts.expectedPath);
  const observedKeys = new Set();
  const observedByGroup = new Map(); // test|tier|config → row count

  // --since-line N: the REUSE_ROWS watermark. The driver snapshots the
  // registry's line count BEFORE its arms phase; only lines appended after
  // that (this sweep's fresh rows) participate in the diff, so pre-existing
  // baseline rows neither satisfy nor inflate this sweep's plan. Slice by raw
  // line index (before dropping blanks) so the offset matches `wc -l`.
  const reg = fs.existsSync(opts.registryPath)
    ? fs.readFileSync(opts.registryPath, 'utf8').split('\n').slice(sinceLine).filter(Boolean)
    : [];
  for (const line of reg) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const group = `${row.test_id}|${row.hardware_tier}|${row.config_id}`;
    const seen = (observedByGroup.get(group) ?? 0) + 1;
    observedByGroup.set(group, seen);
    // Match the rep-th observed row of this (test × tier × config) to
    // expected rep=seen.
    observedKeys.add(`${group}|${seen}`);
  }

  const missing = [];
  for (const [k, cell] of expected) {
    if (!observedKeys.has(k)) missing.push(cell);
  }
  // Groups observed beyond the planned reps (over-emission). Should be 0;
  // surfaces a mistakenly-multiplied driver loop or a stale --since-line.
  const extras = [];
  for (const [group, n] of observedByGroup) {
    const [test_id, tier, config_id] = group.split('|');
    const planned = [...expected.values()].filter(
      (c) => c.test_id === test_id && c.tier === parseInt(tier, 10) && c.config_id === config_id,
    ).length;
    if (n > planned) extras.push({ test_id, tier: parseInt(tier, 10), config_id, observed: n, planned });
  }

  const observedTotal = reg.length;
  const expectedTotal = expected.size;
  console.log(`expected: ${expectedTotal} cells`);
  console.log(`observed: ${observedTotal} rows${sinceLine ? ` (fresh rows after line ${sinceLine} watermark)` : ''}`);
  console.log(`missing:  ${missing.length} cells`);
  console.log(`over:     ${extras.length} (test × tier × config) keys with row count > planned reps`);
  if (missing.length) {
    console.log('\n--- missing cells (planned but no row) ---');
    for (const c of missing.slice(0, 50)) {
      console.log(`  ${c.test_id} config=${c.config_id} tier=${c.tier} rep=${c.rep}`);
    }
    if (missing.length > 50) console.log(`  ... (${missing.length - 50} more)`);
  }
  if (extras.length) {
    console.log('\n--- over-emission (more rows than planned reps) ---');
    for (const e of extras) {
      console.log(`  ${e.test_id} config=${e.config_id} tier=${e.tier}: observed=${e.observed} planned=${e.planned}`);
    }
  }
  // Non-zero exit means the sweep diverged from plan.
  process.exit(missing.length === 0 && extras.length === 0 ? 0 : 1);
}

// Main guard — only run the CLI when this file is the entry point. Imports
// from unit tests (host/test/__tests__/scripts/expected-attempts.test.js) hit
// this module for `isEmitEligible`; without the guard, parseArgs would consume
// the test runner's argv and exit non-zero.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { cmd, opts } = parseArgs(process.argv);
  try {
    if (cmd === 'plan') planCmd(opts);
    else if (cmd === 'diff') diffCmd(opts);
    else { printHelp(); process.exit(2); }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}
