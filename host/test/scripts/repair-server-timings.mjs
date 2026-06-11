#!/usr/bin/env node
// Post-arm server-timings repair (#007 final AC — virtiofs-freeze recovery).
//
// THE PLATFORM PROBLEM (diagnosed live at the T2 boundary, issues/WORKLOG.md):
// on macOS + OrbStack under sweep load, virtiofs serves a FROZEN view of a
// host-appended bind-mounted file to ALL containers — stat AND reads, file-
// and dir-mounts, existing AND freshly-started containers — frozen at roughly
// sweep-start state, recovering only at idle. The in-container log cursor
// then reproducibly closes with byteEnd == byteStart while the host file grew
// by the run's full timing output, and even the relay fallback
// (relayReadSliceViaDocker) reads 0 fresh bytes mid-freeze. The in-place
// defensive layers (readEofSize, relay) stay — they win on healthy platforms —
// but only a HOST process always sees truth.
//
// THE FIX (host-slice + post-arm repair, run-config-ab.sh §"#007 repair"):
// while an arm runs, the driver keeps a host-side ticker appending
// `<epoch_ms> <host_log_size>` lines to a per-sweep index file. Post-arm, for
// each fresh runDir whose run_summary carries the freeze signature
// (`server_timings_join_status: 'no_server_timings'`), the driver:
//   1. asks this script (`window` subcommand) to map the run_summary's
//      run_started_ms/run_finished_ms wall-clock window to a byte window of
//      the host log via the index (mapIndexToWindow below);
//   2. extracts that window HOST-SIDE (`tail -c +N | head -c M`) into
//      <runDir>/server-log.slice — the RETAINED canonical per-run server-log
//      artifact (#002's overflow detection greps the same file);
//   3. invokes the `repair` subcommand on the runDir, which re-runs the very
//      same parse (parseServerLogTimings) + join (joinServerTimings) the
//      original writer used and REWRITES server.timings.jsonl + patches
//      run_summary.json's server-timings fields/caveats in the exact
//      buildOpenCodeArtifacts shapes (lib/opencode_transcript.js).
//
// Window mapping rule (mapIndexToWindow): floor to the tick at-or-before
// run_started_ms then pad ONE tick earlier (the session-title request fires
// ~at run start, so the leading pad matters); ceil to the tick at-or-after
// run_finished_ms then pad ONE tick later, falling back to the caller-supplied
// current host EOF when the run outlived the ticks. Over-inclusion is safe:
// the #008 join is token-keyed, so foreign blocks in the window simply stay
// unattached.
//
// Repair is IDEMPOTENT (same slice → byte-identical sidecar + run_summary) and
// must NOT touch iterations.jsonl, assertion_result.json, or the registry.
// Provenance is explicit: run_summary gains `server_timings_repaired_via:
// 'host_slice'` plus a `server_timings_repaired_via_host_slice: …` caveat.
//
// Subcommands:
//   window --run-dir <dir> --index <file> --eof <currentHostLogSize>
//       → prints "<byteStart> <byteEnd>" on stdout
//   repair --run-dir <dir> [--slice <path>]
//       → rewrites <dir>/server.timings.jsonl, patches <dir>/run_summary.json,
//         prints a one-line JSON summary on stdout

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  parseServerLogTimings,
  joinServerTimings,
  writeServerTimingsSidecar,
} from '../lib/opencode_server_timings.js';

export const SLICE_BASENAME = 'server-log.slice';

// ---------------------------------------------------------------------------
// Index parsing + wall-clock → byte-window mapping (unit-tested core).
// ---------------------------------------------------------------------------

/**
 * Parse the driver's ticker index: one `<epoch_ms> <host_log_size>` line per
 * ~3s tick. Malformed lines are skipped; ticks are returned sorted by time.
 * @param {string} text
 * @returns {Array<{ t: number, size: number }>}
 */
export function parseIndexText(text) {
  const ticks = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    ticks.push({ t: Number(m[1]), size: Number(m[2]) });
  }
  ticks.sort((a, b) => a.t - b.t);
  return ticks;
}

/**
 * Map a run's wall-clock window to a host-log byte window via the ticker
 * index. Rule (see module header): floor to the tick at-or-before startMs,
 * pad one tick earlier; ceil to the tick at-or-after endMs, pad one tick
 * later; when the pads run off the index, fall back to byte 0 (leading) /
 * `eofSize` (trailing — the caller stats the host log at repair time, which
 * is truth on the host). Returns byteEnd >= byteStart always.
 *
 * @param {Array<{ t: number, size: number }>} ticks  parseIndexText output
 * @param {number} startMs  run_summary.run_started_ms
 * @param {number} endMs    run_summary.run_finished_ms
 * @param {{ eofSize: number }} opts  current host log size (trailing fallback)
 * @returns {{ byteStart: number, byteEnd: number }}
 */
export function mapIndexToWindow(ticks, startMs, endMs, { eofSize }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`mapIndexToWindow: non-numeric window [${startMs}, ${endMs}]`);
  }
  if (!Number.isFinite(eofSize)) {
    throw new Error(`mapIndexToWindow: non-numeric eofSize ${eofSize}`);
  }
  const ts = Array.isArray(ticks) ? ticks : [];

  // Leading edge: last tick at-or-before start, then one tick earlier.
  let si = -1;
  for (let i = 0; i < ts.length; i += 1) {
    if (ts[i].t <= startMs) si = i;
    else break;
  }
  let byteStart;
  if (si === -1) {
    // No tick precedes the run (ticker started late / foreign runDir): byte 0.
    // Over-inclusive but safe — the token-keyed join skips foreign blocks.
    byteStart = 0;
  } else {
    byteStart = ts[Math.max(0, si - 1)].size;
  }

  // Trailing edge: first tick at-or-after end, then one tick later.
  let ei = -1;
  for (let i = 0; i < ts.length; i += 1) {
    if (ts[i].t >= endMs) { ei = i; break; }
  }
  let byteEnd;
  if (ei === -1 || ei + 1 >= ts.length) {
    byteEnd = eofSize; // run outlived the ticks (or pad runs off the index)
  } else {
    byteEnd = ts[ei + 1].size;
  }

  if (byteEnd < byteStart) byteEnd = byteStart;
  return { byteStart, byteEnd };
}

// ---------------------------------------------------------------------------
// Repair transform (unit-tested core).
// ---------------------------------------------------------------------------

const JOIN_CAVEAT_RE = /^server_timings_join_/;
const REPAIR_CAVEAT_RE = /^server_timings_repaired_via_host_slice:/;
const REPAIR_CAVEAT =
  'server_timings_repaired_via_host_slice: #007 virtiofs-freeze repair — ' +
  'server.timings.jsonl rebuilt by scripts/repair-server-timings.mjs from ' +
  'server-log.slice (host-extracted byte window; the in-container view of ' +
  'the mounted server log was frozen at run time).';

/**
 * Re-run parse + join over a runDir's retained server-log.slice and rewrite
 * the #022 artifacts exactly as buildOpenCodeArtifacts shapes them:
 *   - <runDir>/server.timings.jsonl rewritten via writeServerTimingsSidecar
 *   - run_summary.json: server_timings_join_status replaced; the single
 *     `server_timings_join_<status>: #022 log-cursor split (…)` caveat
 *     replaced (same mechanical format); `server_timings_repaired_via:
 *     'host_slice'` + its caveat added for provenance.
 * Idempotent: running twice over the same slice yields identical bytes.
 * NEVER touches iterations.jsonl, assertion_result.json, or the registry.
 *
 * @param {string} runDir
 * @param {{ slicePath?: string }} [opts]
 * @returns {{ run_id: string, join_status: string, join_keying: string|null,
 *             n_iterations: number, n_timings: number, n_matched: number,
 *             sidecar_rows: number, sidecar_path: string|null }}
 */
export function repairRunDir(runDir, opts = {}) {
  const summaryPath = path.join(runDir, 'run_summary.json');
  const iterationsPath = path.join(runDir, 'iterations.jsonl');
  const slicePath = opts.slicePath ?? path.join(runDir, SLICE_BASENAME);

  if (!fs.existsSync(summaryPath)) {
    throw new Error(`repair: no run_summary.json in ${runDir}`);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (!('server_timings_join_status' in summary)) {
    // Outcome-only sidecar or a flag-off run: server timings were never
    // enabled for this run — there is nothing to repair, refuse loudly.
    throw new Error(
      `repair: run_summary.json in ${runDir} carries no ` +
      `server_timings_join_status — not a timings-enabled transcript run; refusing.`,
    );
  }
  if (!fs.existsSync(iterationsPath)) {
    throw new Error(`repair: no iterations.jsonl in ${runDir}`);
  }
  if (!fs.existsSync(slicePath)) {
    throw new Error(`repair: no server log slice at ${slicePath}`);
  }

  const iterations = fs
    .readFileSync(iterationsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  const sliceText = fs.readFileSync(slicePath, 'utf8');
  const timings = parseServerLogTimings(sliceText);
  const join = joinServerTimings(iterations, timings, { enabled: true });

  const runId = summary.run_id ?? path.basename(runDir);
  const sidecarPath = writeServerTimingsSidecar(runDir, runId, join);
  const sidecarRows = (join.iterations || []).filter(
    (it) => it.server_total_ms != null || it.server_decode_ms != null,
  ).length;

  // Patch run_summary exactly as buildOpenCodeArtifacts writes it: same field,
  // same mechanical caveat format, plus explicit repair provenance. Strip any
  // prior join/repair caveats first so a re-run replaces instead of stacking.
  summary.server_timings_join_status = join.join_status;
  summary.server_timings_repaired_via = 'host_slice';
  const caveats = Array.isArray(summary.timing_caveats) ? summary.timing_caveats : [];
  summary.timing_caveats = caveats.filter(
    (c) => !JOIN_CAVEAT_RE.test(c) && !REPAIR_CAVEAT_RE.test(c),
  );
  summary.timing_caveats.push(
    `server_timings_join_${join.join_status}: #022 log-cursor split ` +
    `(${join.n_timings} timing record(s) over ${join.n_iterations} iteration(s)).`,
  );
  summary.timing_caveats.push(REPAIR_CAVEAT);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  return {
    run_id: runId,
    join_status: join.join_status,
    join_keying: join.join_keying,
    n_iterations: join.n_iterations,
    n_timings: join.n_timings,
    n_matched: join.n_matched,
    sidecar_rows: sidecarRows,
    sidecar_path: sidecarPath,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = argv.slice(2);
  const cmd = a.shift();
  const opts = {};
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === '--run-dir') opts.runDir = a[++i];
    else if (k === '--index') opts.indexPath = a[++i];
    else if (k === '--eof') opts.eofSize = Number(a[++i]);
    else if (k === '--slice') opts.slicePath = a[++i];
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return { cmd, opts };
}

function printHelp() {
  console.error(`Usage:
  node repair-server-timings.mjs window --run-dir <dir> --index <file> --eof <currentHostLogSize>
  node repair-server-timings.mjs repair --run-dir <dir> [--slice <path>]`);
}

function cmdWindow(opts) {
  if (!opts.runDir || !opts.indexPath || !Number.isFinite(opts.eofSize)) {
    console.error('window: --run-dir, --index and a numeric --eof are required');
    process.exit(2);
  }
  const summary = JSON.parse(
    fs.readFileSync(path.join(opts.runDir, 'run_summary.json'), 'utf8'),
  );
  const ticks = parseIndexText(fs.readFileSync(opts.indexPath, 'utf8'));
  const { byteStart, byteEnd } = mapIndexToWindow(
    ticks,
    Number(summary.run_started_ms),
    Number(summary.run_finished_ms),
    { eofSize: opts.eofSize },
  );
  process.stdout.write(`${byteStart} ${byteEnd}\n`);
}

function cmdRepair(opts) {
  if (!opts.runDir) {
    console.error('repair: --run-dir is required');
    process.exit(2);
  }
  const result = repairRunDir(opts.runDir, { slicePath: opts.slicePath });
  process.stdout.write(JSON.stringify(result) + '\n');
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { cmd, opts } = parseArgs(process.argv);
  try {
    if (cmd === 'window') cmdWindow(opts);
    else if (cmd === 'repair') cmdRepair(opts);
    else { printHelp(); process.exit(2); }
  } catch (e) {
    console.error(`repair-server-timings ${cmd}: ${e?.message ?? e}`);
    process.exit(1);
  }
}
