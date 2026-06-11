#!/usr/bin/env node
// Harvest existing claw-run sidecars under host/test/.claw-runtime/<run-id>/
// and emit one registry row per run, joining to the test-manifest header for
// test_version + oracle_type.
//
// This closes Sprint 0 sign-off criterion 1 ("a single dry-run lands in the
// registry with all mandatory fields populated") for any past or current run
// that produced a run_summary.json. It does NOT spawn claw — it consumes
// existing artifacts.
//
// Usage:
//   node scripts/harvest-runs-to-registry.mjs \
//        --runtime-root /workspace/.claw-runtime \
//        --tests-dir   /test/__tests__/tier-eval \
//        --ctx         /tmp/harvest-ctx.json \
//        --config-id   opencode-a+prompt \
//        --registry    /workspace/.claw-runtime/run_registry.jsonl \
//        [--run-id <id>]              # harvest just one run
//        [--since <ms>]               # filter by run_started_ms (must be a
//                                     # finite number; non-numeric exits 2)
//        [--dry-run]                  # validate + report; do not append
//
// IDEMPOTENT (issue #023): the target registry is read FIRST and any run_id
// already present is skipped (reported as `skipped: already_in_registry`).
// The script is not transactional — it can exit 1 mid-stream after some rows
// appended, inviting an operator retry — so a re-run over the same
// --runtime-root must never re-append rows and silently inflate per-task N.
//
// --config-id is REQUIRED (issue #009) and validated against lib/config.js's
// VALID_CONFIGS. The sidecar cannot infer which A/B arm produced a run, and
// assembleRow no longer defaults the label — so the operator must declare it
// explicitly or the harvest exits nonzero. The flag is the single source of
// the label; a conflicting `config_id` inside the --ctx JSON is an error.
//
// The --ctx JSON supplies the static fields that the sidecar can't infer:
//   {
//     "run_kind": "overnight_screen" | "smoke" | "dry_run" | ...,
//     "hardware_tier": 16 | 32 | 64,
//     "memory_gb": 16 | 32 | 64,
//     "model_config_id": "qwen36-35b-...",
//     "harness_version": "<git sha>",
//     "canonical_status": "canonical" (default) | "legacy-compatible" | ...,
//     "screening_only": true (default for overnight_screen) | false,
//     "iteration_budget": null,
//     "timeout_budget_ms": null,
//     "prompt_pack_version": "pp01" (optional override of manifest entry)
//   }
//
// Per-run fields come from disk:
//   - run_id          → run-id directory name
//   - test_id         → run_summary.json (set by ITER_DIST_TEST_ID at run time)
//   - test_version    → @manifest header (joined via --tests-dir)
//   - oracle_type     → @manifest header
//   - start/end_time  → run_summary.json
//   - terminal_status, passed → run_summary.json + assertion_result.json

import fs from 'node:fs';
import path from 'node:path';

import { emitRow, assembleRow } from '../lib/run_row.js';
import { validateRow, readRegistry, REGISTRY_PATH } from '../lib/registry.js';
import { readManifest } from '../lib/test_manifest.js';
import { VALID_CONFIGS } from '../lib/config.js';

function readJsonIfExists(dir, fname) {
  const p = path.join(dir, fname);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const opts = { dryRun: false };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--runtime-root') opts.runtimeRoot = a[++i];
    else if (k === '--tests-dir') opts.testsDir = a[++i];
    else if (k === '--ctx') opts.ctxPath = a[++i];
    else if (k === '--config-id') opts.configId = a[++i];
    else if (k === '--registry') opts.registryPath = a[++i];
    else if (k === '--run-id') opts.runId = a[++i];
    else if (k === '--since') opts.sinceRaw = a[++i];
    else if (k === '--dry-run') opts.dryRun = true;
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  console.error(`Usage: node harvest-runs-to-registry.mjs --runtime-root <dir> --tests-dir <dir> --ctx <ctx.json> --config-id <id> [--registry <path>] [--run-id <id>] [--since <ms>] [--dry-run]`);
  console.error(`  --config-id is required (issue #009): the coarse A/B bundle label stamped on every harvested row.`);
  console.error(`  Valid values: ${VALID_CONFIGS.join(', ')}`);
}

function loadCtx(p) {
  if (!p) throw new Error('--ctx is required');
  if (!fs.existsSync(p)) throw new Error(`ctx file not found: ${p}`);
  const ctx = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['run_kind', 'hardware_tier', 'memory_gb', 'model_config_id', 'harness_version']) {
    if (ctx[k] === undefined || ctx[k] === null || ctx[k] === '') {
      throw new Error(`ctx missing required field: ${k}`);
    }
  }
  return ctx;
}

function buildTestIndex(testsDir) {
  // Map test_id → { test_version, oracle_type, primary_axis, suite_layer }.
  const idx = {};
  for (const fname of fs.readdirSync(testsDir)) {
    if (!fname.endsWith('.test.js')) continue;
    try {
      const m = readManifest(path.join(testsDir, fname));
      idx[m.test_id] = m;
    } catch (e) {
      console.error(`[warn] manifest for ${fname} unparseable: ${e.message}`);
    }
  }
  return idx;
}

function listRunIds(runtimeRoot, { runId, sinceMs } = {}) {
  if (runId) return [runId];
  const out = [];
  for (const name of fs.readdirSync(runtimeRoot)) {
    const full = path.join(runtimeRoot, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (!fs.existsSync(path.join(full, 'run_summary.json'))) continue;
    if (sinceMs != null) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(full, 'run_summary.json'), 'utf8'));
        if ((s.run_started_ms ?? 0) < sinceMs) continue;
      } catch {
        continue;
      }
    }
    out.push(name);
  }
  return out;
}

function harvestOne(runId, runtimeRoot, ctx, testIdx) {
  const runDir = path.join(runtimeRoot, runId);
  const summaryPath = path.join(runDir, 'run_summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { runId, status: 'skipped', reason: 'no run_summary.json' };
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const test_id = summary.test_id;
  if (!test_id) {
    return { runId, status: 'skipped', reason: 'run_summary.json has null test_id (ITER_DIST_TEST_ID was not set at run time)' };
  }
  const manifest = testIdx[test_id];
  if (!manifest) {
    return { runId, status: 'skipped', reason: `no manifest for test_id=${test_id} under tests-dir` };
  }
  const clawResult = {
    runId,
    runDir,
    iterationsPath: path.join(runDir, 'iterations.jsonl'),
    runSummaryPath: summaryPath,
    code: typeof summary.exit_code === 'number' ? summary.exit_code : 0,
    timeout: !!summary.timeout,
    signal: null,
    elapsedMs: summary.run_elapsed_ms ?? null,
  };
  const rowCtx = {
    ...ctx,
    test_id,
    test_version: manifest.test_version,
    oracle_type: manifest.oracle_type,
  };
  const row = assembleRow(clawResult, rowCtx);
  const errors = validateRow(row);
  if (errors.length) {
    return { runId, status: 'invalid', errors, row };
  }
  return { runId, status: 'ok', row };
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.runtimeRoot) { console.error('--runtime-root required'); process.exit(2); }
  if (!opts.testsDir)    { console.error('--tests-dir required');    process.exit(2); }
  if (!opts.ctxPath)     { console.error('--ctx required');           process.exit(2); }
  // Issue #009: the harvested arm must be declared explicitly — the sidecar
  // cannot infer it and assembleRow no longer defaults to 'claw-rig'.
  if (!opts.configId) {
    console.error('--config-id required');
    printHelp();
    process.exit(2);
  }
  if (!VALID_CONFIGS.includes(opts.configId)) {
    console.error(`--config-id "${opts.configId}" is not in VALID_CONFIGS {${VALID_CONFIGS.join(', ')}}`);
    printHelp();
    process.exit(2);
  }
  // Issue #023: a non-numeric --since used to parse to NaN, and every
  // `run_started_ms < NaN` comparison is false — silently disabling the
  // filter and harvesting EVERYTHING. Refuse before touching any artifact.
  if (opts.sinceRaw !== undefined) {
    const sinceMs = Number(opts.sinceRaw);
    if (opts.sinceRaw === '' || !Number.isFinite(sinceMs)) {
      console.error(
        `--since "${opts.sinceRaw}" is not a finite number (expected ms since epoch); `
        + 'a NaN would silently disable the filter and harvest everything.',
      );
      process.exit(2);
    }
    opts.sinceMs = sinceMs;
  }

  const ctx = loadCtx(opts.ctxPath);
  // The CLI flag is the single source of the bundle label. A different
  // config_id buried in the ctx JSON would silently win/lose depending on
  // spread order — refuse the ambiguity outright.
  if (ctx.config_id !== undefined && ctx.config_id !== opts.configId) {
    console.error(
      `ctx file config_id "${ctx.config_id}" conflicts with --config-id "${opts.configId}"; `
      + 'remove config_id from the ctx file (--config-id is the single source of the label).',
    );
    process.exit(2);
  }
  ctx.config_id = opts.configId;
  const testIdx = buildTestIndex(opts.testsDir);
  const runIds = listRunIds(opts.runtimeRoot, { runId: opts.runId, sinceMs: opts.sinceMs });

  // Issue #023 idempotency: read the TARGET registry first and skip any
  // run_id already present, so an operator retry after a mid-stream exit 1
  // never re-appends rows (duplicates silently inflate per-task N downstream).
  const registryTarget = opts.registryPath ?? REGISTRY_PATH;
  const alreadyPresent = new Set(
    readRegistry({ registryPath: registryTarget })
      .map((r) => r.run_id)
      .filter((id) => id != null),
  );

  console.log(`harvesting ${runIds.length} run(s) from ${opts.runtimeRoot}`);
  console.log(`config_id: ${opts.configId} (stamped on every harvested row)`);
  console.log(`test_id index: ${Object.keys(testIdx).length} manifest(s) loaded from ${opts.testsDir}`);
  console.log(`registry: ${registryTarget} (${alreadyPresent.size} run_id(s) already present will be skipped)`);

  let ok = 0, skipped = 0, invalid = 0, appended = 0, alreadyInRegistry = 0;
  for (const runId of runIds) {
    if (alreadyPresent.has(runId)) {
      skipped += 1;
      alreadyInRegistry += 1;
      console.log(`  skip  ${runId} (skipped: already_in_registry)`);
      continue;
    }
    const result = harvestOne(runId, opts.runtimeRoot, ctx, testIdx);
    if (result.status === 'ok') {
      ok += 1;
      if (opts.dryRun) {
        console.log(`  ok    ${runId} → ${result.row.test_id} ${result.row.terminal_status}`);
      } else {
        const target = opts.registryPath
          ? { registryPath: opts.registryPath }
          : {};
        // emitRow re-validates and appends. We've already validated, but
        // re-validation is cheap and centralizes the appendRow call site.
        // Sprint 1.20: pass the full clawResult shape that harvestOne built —
        // run_row.js's pickTerminalStatus now needs `code`/`timeout` to gate
        // the upstream-failure relabel, and the prior stripped form silently
        // suppressed it.
        const summary = readJsonIfExists(path.join(opts.runtimeRoot, runId), 'run_summary.json');
        emitRow({
          runId,
          runDir: path.join(opts.runtimeRoot, runId),
          iterationsPath: path.join(opts.runtimeRoot, runId, 'iterations.jsonl'),
          runSummaryPath: path.join(opts.runtimeRoot, runId, 'run_summary.json'),
          code: typeof summary?.exit_code === 'number' ? summary.exit_code : 0,
          timeout: !!summary?.timeout,
          signal: null,
          elapsedMs: summary?.run_elapsed_ms ?? null,
        }, { ...ctx, ...rebuildCtxForRow(result.row), ...target });
        appended += 1;
        alreadyPresent.add(runId); // guard within-invocation duplicates too
        console.log(`  appended ${runId} → ${result.row.test_id}`);
      }
    } else if (result.status === 'invalid') {
      invalid += 1;
      console.error(`  INVALID ${runId}: ${result.errors.join('; ')}`);
    } else {
      skipped += 1;
      console.log(`  skip  ${runId} (${result.reason})`);
    }
  }
  console.log(`\nsummary: ok=${ok} appended=${appended} invalid=${invalid} skipped=${skipped} already_in_registry=${alreadyInRegistry}`);
  process.exit(invalid > 0 ? 1 : 0);
}

// emitRow takes ctx with run_kind/hardware_tier/etc; rebuildCtxForRow extracts
// the per-row test_id/test_version/oracle_type that harvestOne resolved from
// the manifest, so emitRow's second call to assembleRow yields the same row.
function rebuildCtxForRow(row) {
  return {
    test_id: row.test_id,
    test_version: row.test_version,
    oracle_type: row.oracle_type,
  };
}

main();
