#!/usr/bin/env node
// One-shot backlog prune of per-run OpenCode DB captures (#015).
//
// THE PROBLEM: before #015, every transcript-capturing runOpenCode call kept
// its <runDir>/opencode-data/ (SQLite DB + -wal/-shm + logs + git snapshot
// trees, ~1.1 MB/run) forever — measured at review time: 1,310 run dirs /
// 962 MB under client/opencode/.opencode-runtime and growing with every
// sweep. The runner now prunes at run end on the non-degraded path
// (lib/opencode.js pruneOpenCodeDataDir); this script clears the existing
// backlog once, under the SAME policy.
//
// POLICY (the exact predicate, see shouldPruneRunDir / classifyRunDir):
//   PRUNE  <runDir>/opencode-data/ iff ALL of:
//     - opencode-data/ exists, AND
//     - run_summary.json exists AND parses, AND
//     - run_summary.telemetry === 'transcript' (the buildOpenCodeArtifacts
//       marker — normalization succeeded for this run), AND
//     - iterations.jsonl exists (the transcript sidecar actually landed).
//   RETAIN everything else:
//     - telemetry 'outcome_only' (the runner's degraded sidecar — the raw DB
//       is the only debugging oracle for these runs), or any OTHER/missing
//       telemetry value (conservative: only the exact non-degraded marker
//       prunes);
//     - missing/unparseable run_summary.json, missing iterations.jsonl;
//   NEVER TOUCHED, by construction: iterations.jsonl, run_summary.json,
//   assertion_result.json (harvester inputs), server.timings.jsonl,
//   server-log.slice (#007/#002 oracle artifacts), the runDir itself, and
//   non-runDir entries (smoke/ scratch, phase-ws, evidence dirs). The ONLY
//   thing ever deleted is an opencode-data/ subtree, via the same
//   basename-guarded primitive the runner uses (pruneOpenCodeDataDir).
//
// DRY-RUN BY DEFAULT. Nothing is deleted without an explicit --apply.
//
// Usage (no node on the host — run via the eval-runner image, repo
// path-matched, exactly like the driver's verdict hint):
//   docker run --rm -v "$REPO:$REPO" -w "$REPO/host/test" \
//     --entrypoint node mac-llm-lab-eval-runner:local \
//     scripts/prune-opencode-data.mjs [--root <runtimeRoot>] [--apply] [--json]
//
// Reports: dirs scanned, prunable/pruned count, bytes freed, retained-by-
// reason histogram. Exit 0 on success (incl. "nothing to do"); 1 when --apply
// hit any per-dir deletion failure (the failure is reported, the rest of the
// sweep still ran).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pruneOpenCodeDataDir } from '../lib/opencode.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const DATA_SUBDIR = 'opencode-data';
export const DEFAULT_RUNTIME_ROOT = path.join(
  REPO_ROOT, 'client', 'opencode', '.opencode-runtime',
);

// ---------------------------------------------------------------------------
// Decision core (unit-tested; exported).
// ---------------------------------------------------------------------------

/**
 * Classify one runtime-root entry under the #015 policy.
 *
 * @param {string} runDir absolute path of one .opencode-runtime/<entry>
 * @returns {{ runDir: string, dataDir: string|null, decision:
 *   'prune' | 'retain_degraded' | 'retain_no_summary' |
 *   'retain_bad_summary' | 'retain_no_iterations' | 'no_data',
 *   telemetry: string|null }}
 */
export function classifyRunDir(runDir) {
  const dataDir = path.join(runDir, DATA_SUBDIR);
  const out = { runDir, dataDir: null, decision: 'no_data', telemetry: null };

  let st;
  try { st = fs.statSync(dataDir); } catch { return out; }
  if (!st.isDirectory()) return out; // a FILE named opencode-data is not ours
  out.dataDir = dataDir;

  const summaryPath = path.join(runDir, 'run_summary.json');
  let raw;
  try { raw = fs.readFileSync(summaryPath, 'utf8'); }
  catch { out.decision = 'retain_no_summary'; return out; }

  let summary;
  try { summary = JSON.parse(raw); }
  catch { out.decision = 'retain_bad_summary'; return out; }

  out.telemetry = typeof summary?.telemetry === 'string' ? summary.telemetry : null;
  // Conservative: ONLY the exact non-degraded marker prunes. 'outcome_only',
  // anything unknown, and a missing field all retain.
  if (out.telemetry !== 'transcript') { out.decision = 'retain_degraded'; return out; }

  if (!fs.existsSync(path.join(runDir, 'iterations.jsonl'))) {
    out.decision = 'retain_no_iterations';
    return out;
  }

  out.decision = 'prune';
  return out;
}

/**
 * The runner-equivalent predicate, for callers that only need the boolean.
 * @param {string} runDir
 * @returns {boolean}
 */
export function shouldPruneRunDir(runDir) {
  return classifyRunDir(runDir).decision === 'prune';
}

/**
 * Recursive byte size of a tree (lstat — symlinks counted as links, never
 * followed; missing/no-permission entries count 0). Used for the "bytes
 * freed" report.
 * @param {string} p
 * @returns {number}
 */
export function duBytes(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isDirectory()) {
    let total = 0;
    let entries = [];
    try { entries = fs.readdirSync(p); } catch { return 0; }
    for (const e of entries) total += duBytes(path.join(p, e));
    return total;
  }
  return st.size;
}

/**
 * Scan a runtime root's DIRECT children (run dirs are flat UUID dirs; scratch
 * trees like smoke/ keep their own nested roots and are classified 'no_data'
 * here — deliberately untouched) and classify each.
 *
 * @param {string} root
 * @returns {Array<ReturnType<typeof classifyRunDir> & { bytes: number }>}
 */
export function scanRuntimeRoot(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return entries.map((name) => {
    const c = classifyRunDir(path.join(root, name));
    return { ...c, bytes: c.dataDir ? duBytes(c.dataDir) : 0 };
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { root: DEFAULT_RUNTIME_ROOT, apply: false, json: false };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === '--root') opts.root = path.resolve(a[++i]);
    else if (k === '--apply') opts.apply = true;
    else if (k === '--json') opts.json = true;
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  console.error(
    'Usage: node scripts/prune-opencode-data.mjs [--root <runtimeRoot>] [--apply] [--json]\n' +
    '  Dry-run by default: reports what WOULD be pruned. --apply deletes.\n' +
    `  Default root: ${DEFAULT_RUNTIME_ROOT}`,
  );
}

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

function main() {
  const opts = parseArgs(process.argv);
  if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
    console.error(`prune-opencode-data: root is not a directory: ${opts.root}`);
    process.exit(2);
  }

  const scanned = scanRuntimeRoot(opts.root);
  const byDecision = {};
  for (const r of scanned) {
    (byDecision[r.decision] ??= []).push(r);
  }
  const prunable = byDecision.prune ?? [];
  const prunableBytes = prunable.reduce((s, r) => s + r.bytes, 0);

  let prunedCount = 0;
  let prunedBytes = 0;
  let failures = 0;
  if (opts.apply) {
    for (const r of prunable) {
      // Same basename-guarded primitive the runner's end-of-run hook uses.
      if (pruneOpenCodeDataDir(r.dataDir)) {
        prunedCount += 1;
        prunedBytes += r.bytes;
      } else {
        failures += 1;
      }
    }
  }

  const report = {
    root: opts.root,
    mode: opts.apply ? 'apply' : 'dry-run',
    dirs_scanned: scanned.length,
    prunable: prunable.length,
    prunable_bytes: prunableBytes,
    pruned: prunedCount,
    pruned_bytes: prunedBytes,
    prune_failures: failures,
    retained_degraded: (byDecision.retain_degraded ?? []).length,
    retained_no_summary: (byDecision.retain_no_summary ?? []).length,
    retained_bad_summary: (byDecision.retain_bad_summary ?? []).length,
    retained_no_iterations: (byDecision.retain_no_iterations ?? []).length,
    no_data: (byDecision.no_data ?? []).length,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n');
  } else {
    console.log(`prune-opencode-data (${report.mode}) — root: ${report.root}`);
    console.log(`  dirs scanned:                 ${report.dirs_scanned}`);
    console.log(`  prunable (telemetry=transcript + opencode-data/): ${report.prunable} (${fmtBytes(prunableBytes)})`);
    console.log(`  retained degraded (outcome_only / non-transcript): ${report.retained_degraded}`);
    console.log(`  retained (no run_summary.json):       ${report.retained_no_summary}`);
    console.log(`  retained (unparseable run_summary):   ${report.retained_bad_summary}`);
    console.log(`  retained (no iterations.jsonl):       ${report.retained_no_iterations}`);
    console.log(`  no opencode-data/ (already pruned / not a runDir): ${report.no_data}`);
    if (opts.apply) {
      console.log(`  PRUNED: ${report.pruned} dir(s), ${fmtBytes(report.pruned_bytes)} freed` +
        (failures ? ` — ${failures} FAILURE(S), see stderr` : ''));
    } else {
      console.log(`  DRY RUN — nothing deleted. Re-run with --apply to free ${fmtBytes(prunableBytes)}.`);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
