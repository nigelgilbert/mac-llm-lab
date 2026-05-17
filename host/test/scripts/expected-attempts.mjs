#!/usr/bin/env node
// Sprint 1.14: enumerate every (test × tier × rep) cell that the overnight
// driver intends to attempt, and write it to a CSV alongside the run-registry
// JSONL. Post-sweep, diff observed-vs-expected to surface cells that were
// planned but produced no row — those are harness drops, not model fails.
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
// expected manifest.
//
// Subcommands:
//   plan   — write expected_attempts.<sweep>.csv
//   diff   — diff a registry JSONL against an expected CSV
//
// Usage:
//   node scripts/expected-attempts.mjs plan \
//        --tests-dir host/test/__tests__/tier-eval \
//        --tiers "16 32 64" --reps 8 \
//        --out host/test/.claw-runtime/expected_attempts.<sweep>.csv
//
//   node scripts/expected-attempts.mjs diff \
//        --expected host/test/.claw-runtime/expected_attempts.<sweep>.csv \
//        --registry host/test/.claw-runtime/run_registry.<sweep>.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HEADER = 'test_id,hardware_tier,rep_index';

function parseArgs(argv) {
  const a = argv.slice(2);
  const cmd = a.shift();
  const opts = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--tests-dir') opts.testsDir = a[++i];
    else if (k === '--tiers') opts.tiers = a[++i];
    else if (k === '--reps') opts.reps = parseInt(a[++i], 10);
    else if (k === '--out') opts.outPath = a[++i];
    else if (k === '--filter') opts.filter = a[++i];
    else if (k === '--expected') opts.expectedPath = a[++i];
    else if (k === '--registry') opts.registryPath = a[++i];
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return { cmd, opts };
}

function printHelp() {
  console.error(`Usage:
  node expected-attempts.mjs plan --tests-dir <dir> --tiers "16 32 64" --reps 8 --out <csv> [--filter "id1 id2 ..."]
  node expected-attempts.mjs diff --expected <csv> --registry <jsonl>`);
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
  if (!opts.reps || opts.reps < 1) throw new Error('--reps required (>=1)');
  if (!opts.outPath) throw new Error('--out required');

  const tiers = opts.tiers.trim().split(/\s+/).map((s) => parseInt(s, 10));
  for (const t of tiers) {
    if (![16, 32, 64].includes(t)) throw new Error(`invalid tier: ${t}`);
  }
  let tests = listEligibleTests(opts.testsDir);
  if (opts.filter) {
    const want = new Set(opts.filter.trim().split(/\s+/).filter(Boolean));
    const missing = [...want].filter((s) => !tests.includes(s));
    if (missing.length) throw new Error(`--filter mentions unknown test(s): ${missing.join(', ')}`);
    tests = tests.filter((s) => want.has(s));
  }
  if (tests.length === 0) throw new Error(`no emit-eligible tests under ${opts.testsDir}`);

  const lines = [HEADER];
  // Order matches the overnight driver: rep-outer × tier-middle × test-inner.
  for (let rep = 1; rep <= opts.reps; rep++) {
    for (const tier of tiers) {
      for (const test_id of tests) {
        lines.push(`${test_id},${tier},${rep}`);
      }
    }
  }
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, lines.join('\n') + '\n');
  const cells = lines.length - 1;
  console.error(`expected-attempts: wrote ${cells} cells (${tests.length} tests × ${tiers.length} tiers × ${opts.reps} reps) → ${opts.outPath}`);
}

function readExpected(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  if (lines[0] !== HEADER) throw new Error(`header mismatch in ${p}`);
  const cells = new Map();
  for (const line of lines.slice(1)) {
    const [test_id, tier, rep] = line.split(',');
    const key = `${test_id}|${tier}|${rep}`;
    cells.set(key, { test_id, tier: parseInt(tier, 10), rep: parseInt(rep, 10) });
  }
  return cells;
}

function diffCmd(opts) {
  if (!opts.expectedPath) throw new Error('--expected required');
  if (!opts.registryPath) throw new Error('--registry required');

  const expected = readExpected(opts.expectedPath);
  const observedKeys = new Set();
  const observedByTestTier = new Map();

  const reg = fs.existsSync(opts.registryPath)
    ? fs.readFileSync(opts.registryPath, 'utf8').split('\n').filter(Boolean)
    : [];
  for (const line of reg) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const key = `${row.test_id}|${row.hardware_tier}`;
    const seen = (observedByTestTier.get(key) ?? 0) + 1;
    observedByTestTier.set(key, seen);
    // Match the rep-th observed row of this (test × tier) to expected rep=seen.
    observedKeys.add(`${row.test_id}|${row.hardware_tier}|${seen}`);
  }

  const missing = [];
  for (const [k, cell] of expected) {
    if (!observedKeys.has(k)) missing.push(cell);
  }
  // Cells observed beyond the planned reps (over-emission). Should be 0;
  // surfaces a mistakenly-multiplied driver loop.
  const extras = [];
  for (const [key, n] of observedByTestTier) {
    const [test_id, tier] = key.split('|');
    const planned = [...expected.values()].filter(
      (c) => c.test_id === test_id && c.tier === parseInt(tier, 10),
    ).length;
    if (n > planned) extras.push({ test_id, tier: parseInt(tier, 10), observed: n, planned });
  }

  const observedTotal = reg.length;
  const expectedTotal = expected.size;
  console.log(`expected: ${expectedTotal} cells`);
  console.log(`observed: ${observedTotal} rows`);
  console.log(`missing:  ${missing.length} cells`);
  console.log(`over:     ${extras.length} (test × tier) keys with row count > planned reps`);
  if (missing.length) {
    console.log('\n--- missing cells (planned but no row) ---');
    for (const c of missing.slice(0, 50)) {
      console.log(`  ${c.test_id} tier=${c.tier} rep=${c.rep}`);
    }
    if (missing.length > 50) console.log(`  ... (${missing.length - 50} more)`);
  }
  if (extras.length) {
    console.log('\n--- over-emission (more rows than planned reps) ---');
    for (const e of extras) {
      console.log(`  ${e.test_id} tier=${e.tier}: observed=${e.observed} planned=${e.planned}`);
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
