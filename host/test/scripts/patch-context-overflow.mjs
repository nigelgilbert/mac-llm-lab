#!/usr/bin/env node
// #002 post-arm context-overflow patch (Option A, decision 2026-06-10).
//
// WHY A POST-ARM PATCH EXISTS AT ALL: registry rows are emitted IN-RUN by the
// reporter, from the on-disk sidecar at cell end. In-run overflow detection
// (lib/opencode_server_timings.js captureServerTimings → the transcript's
// Layer-A relabel) types the sidecar BEFORE the row is emitted — but only when
// the run's server-log capture window was readable in-container. Two cases
// blind the in-run path:
//   1. the OrbStack virtiofs freeze (issues/WORKLOG.md T2): under sweep load
//      every container's view of the host-appended llama-server log freezes —
//      stat AND reads, fresh mounts included — so the in-run slice is empty;
//   2. an overflow run that wedges opencode hard enough to leave no usable
//      session DB: the runner degrades to the outcome-only sidecar, which the
//      transcript relabel never touches.
// In both cases the row was already emitted as an ELIGIBLE model failure
// ('timeout'/'error', passed=false/null) — wrong under the #002 decision. The
// driver (run-config-ab.sh) therefore slices EVERY fresh runDir's window from
// the HOST log (host processes always see truth) post-arm, and this script
// scans the slice and — when the pinned oracle line is present — patches BOTH
// the run_summary sidecar AND the already-emitted registry row, strictly
// BEFORE the row audit / pairing gate read the registry.
//
// ORACLE + ATTRIBUTION: the pinned llama-server n_ctx-exceeded line
// (CONTEXT_OVERFLOW_RE, empirically captured against build b1-5594d13 — see
// lib/opencode_server_timings.js). A rejected request produces no timing
// block, so the line is not correlatable to an iteration; attribution is
// window-based: an overflow line inside a run's slice window belongs to that
// run (single-client topology; the ±1-tick window pads make this slightly
// over-inclusive — documented in docs/OPENCODE-SERVER-TIMINGS.md §#002).
//
// WHAT GETS PATCHED (idempotent; second run over the same inputs is a no-op):
//   run_summary.json (sidecar — free-form, full provenance):
//     terminal_status → 'harness_error'    (unless 'done' — recovered run)
//     passed          → null
//     context_overflow → true
//     harness_error   → 'context_overflow'
//     context_overflow_detected_via → 'host_slice_post_arm'
//       (an existing 'in_run_capture' value is PRESERVED — the in-run path
//        already typed this run; the registry row is then verified, not moved)
//     context_overflow_line → the matched oracle line
//     timing_caveats  += one context_overflow_relabel/... caveat (deduped)
//   registry row (schema-constrained: run_registry.schema.json is
//   additionalProperties:false, so the row is patched WITHIN schema fields and
//   the patch provenance lives on the run_summary sidecar, reachable from the
//   row via trace_artifact_uri/run_id):
//     terminal_status → 'harness_error'
//     passed          → null
//     harness_error   → 'context_overflow'
//
// RECOVERED-RUN CARVE-OUT (same rule as the in-run path): an overflow line in
// the window of a run whose sidecar says terminal_status 'done' means the
// client recovered — the sidecar gets context_overflow:true + provenance but
// NO relabel, and the registry row is left alone.
//
// Exit codes (CLI):
//   0 — no overflow found, or overflow found and everything needed was
//       patched / already correct (incl. row_absent: the cell never emitted a
//       row — the driver's expected-attempts audit owns that case)
//   1 — overflow found but a required patch could NOT be applied (the registry
//       would enter the gate with a mis-typed eligible failure — the driver
//       must redden the sweep)
//   2 — usage / missing-artifact error
//
// Usage:
//   node patch-context-overflow.mjs scan-and-patch \
//     --run-dir <dir> --registry <run_registry.jsonl> [--slice <path>]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { scanContextOverflow } from '../lib/opencode_server_timings.js';
import { SLICE_BASENAME } from './repair-server-timings.mjs';

export const DETECTED_VIA_POST_ARM = 'host_slice_post_arm';

const OVERFLOW_CAVEAT_RE = /^context_overflow_(relabel|recovered)/;

function relabelCaveat(line) {
  return (
    'context_overflow_relabel: llama-server rejected a request in this ' +
    "run's capture window (n_ctx exceeded) — terminal_status re-typed " +
    'harness_error / passed null per #002 Layer-A (excluded from pass ' +
    `denominators). Oracle line: ${line ?? 'n/a'}`
  );
}

function recoveredCaveat() {
  return (
    'context_overflow_recovered: an n_ctx-exceeded rejection appeared in ' +
    "this run's capture window but the run finished clean (exit 0) — " +
    'recorded, NOT re-typed (#002); the workspace oracle decides pass/fail.'
  );
}

/**
 * Patch a run_summary object IN MEMORY for a detected overflow. Pure transform
 * (unit-tested): returns { summary, changed, relabeled }.
 *
 * @param {object} summary   parsed run_summary.json
 * @param {{ line: string }} overflow  scanContextOverflow result
 * @returns {{ summary: object, changed: boolean, relabeled: boolean }}
 */
export function applyOverflowToSummary(summary, overflow) {
  const before = JSON.stringify(summary);
  const out = { ...summary };

  // Recovered-run carve-out: 'done' keeps its label (and an earlier in-run
  // relabel to 'harness_error' is already correct — not 'done', so it falls
  // through and the idempotent writes below leave it byte-identical).
  const relabeled = out.terminal_status !== 'done';

  out.context_overflow = true;
  // Preserve the in-run provenance when the transcript already typed this run.
  if (out.context_overflow_detected_via !== 'in_run_capture') {
    out.context_overflow_detected_via = DETECTED_VIA_POST_ARM;
    out.context_overflow_line = overflow.line ?? null;
  }
  if (relabeled) {
    out.terminal_status = 'harness_error';
    out.passed = null;
    out.harness_error = 'context_overflow';
  }
  // Caveat: add exactly one. When the in-run path already wrote the identical
  // caveat (same mechanical format), leave the array untouched — preserving
  // its position keeps the rewrite byte-identical (idempotency with the
  // transcript's own relabel, whose caveat may not be last).
  const desired = relabeled
    ? relabelCaveat(out.context_overflow_line ?? overflow.line)
    : recoveredCaveat();
  const caveats = Array.isArray(out.timing_caveats) ? out.timing_caveats : [];
  if (!caveats.includes(desired)) {
    out.timing_caveats = caveats.filter((c) => !OVERFLOW_CAVEAT_RE.test(String(c)));
    out.timing_caveats.push(desired);
  }

  return { summary: out, changed: JSON.stringify(out) !== before, relabeled };
}

/**
 * Patch the registry row for runId in a JSONL registry, within schema fields
 * only (additionalProperties:false — see module header). Non-matching lines
 * are passed through BYTE-IDENTICAL (no reserialization). Atomic rewrite
 * (tmp + rename in the same dir). Returns one of:
 *   { status: 'patched', line_no }       row moved to harness_error/passed null
 *   { status: 'already_typed', line_no } row already carries the relabel
 *   { status: 'row_absent' }             no row with this run_id (cap-killed
 *                                        cell — the expected-attempts audit
 *                                        names it; nothing to patch here)
 *
 * @param {string} registryPath
 * @param {string} runId
 * @returns {{ status: string, line_no?: number }}
 */
export function patchRegistryRowOverflow(registryPath, runId) {
  if (!fs.existsSync(registryPath)) return { status: 'row_absent' };
  const raw = fs.readFileSync(registryPath, 'utf8');
  const lines = raw.split('\n');

  let found = -1;
  let row = null;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) continue;
    let parsed;
    try { parsed = JSON.parse(t); } catch { continue; }
    if (parsed && parsed.run_id === runId) {
      // Last match wins (run_ids are UUIDs; duplicates should not exist, but a
      // re-emitted row would be the later, authoritative one).
      found = i;
      row = parsed;
    }
  }
  if (found === -1) return { status: 'row_absent' };

  if (
    row.terminal_status === 'harness_error' &&
    row.passed === null &&
    row.harness_error === 'context_overflow'
  ) {
    return { status: 'already_typed', line_no: found + 1 };
  }

  row.terminal_status = 'harness_error';
  row.passed = null;
  row.harness_error = 'context_overflow';
  lines[found] = JSON.stringify(row);

  const tmp = path.join(
    path.dirname(registryPath),
    `.${path.basename(registryPath)}.overflow-patch.tmp`,
  );
  fs.writeFileSync(tmp, lines.join('\n'));
  fs.renameSync(tmp, registryPath);
  return { status: 'patched', line_no: found + 1 };
}

/**
 * Scan a runDir's host-extracted server-log slice for the pinned overflow line
 * and patch run_summary + the registry row (see module header). Loud: prints a
 * one-line JSON result on stdout; the relabel itself is announced on stderr
 * naming the run.
 *
 * @param {string} runDir
 * @param {{ registryPath: string, slicePath?: string }} opts
 * @returns {{ run_id: string, overflow: boolean, relabeled?: boolean,
 *             summary_changed?: boolean, registry?: string,
 *             registry_line?: number, detected_via?: string, line?: string }}
 */
export function scanAndPatchRunDir(runDir, { registryPath, slicePath } = {}) {
  const summaryPath = path.join(runDir, 'run_summary.json');
  const slice = slicePath ?? path.join(runDir, SLICE_BASENAME);
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`no run_summary.json in ${runDir}`);
  }
  if (!fs.existsSync(slice)) {
    throw new Error(
      `no server log slice at ${slice} — the driver slices every fresh runDir ` +
      'when OPENCODE_SERVER_TIMINGS=1; a missing slice is a driver bug, not a clean run',
    );
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const runId = summary.run_id ?? path.basename(runDir);

  const overflow = scanContextOverflow(fs.readFileSync(slice, 'utf8'));
  if (!overflow) return { run_id: runId, overflow: false };

  const { summary: patched, changed, relabeled } = applyOverflowToSummary(summary, overflow);
  if (changed) {
    fs.writeFileSync(summaryPath, JSON.stringify(patched, null, 2) + '\n');
  }

  let registry = { status: 'not_relabeled' };
  if (relabeled) {
    registry = patchRegistryRowOverflow(registryPath, runId);
    console.error(
      `[overflow-patch] run ${runId}: context overflow in capture window ` +
      `(${overflow.line}) — sidecar ${changed ? 'patched' : 'already typed'}; ` +
      `registry row ${registry.status}` +
      (registry.line_no ? ` (line ${registry.line_no} of ${registryPath})` : ''),
    );
  } else {
    console.error(
      `[overflow-patch] run ${runId}: overflow line in window but the run ` +
      `finished clean — recorded on the sidecar, NOT re-typed (recovered run).`,
    );
  }

  return {
    run_id: runId,
    overflow: true,
    relabeled,
    summary_changed: changed,
    registry: registry.status,
    ...(registry.line_no ? { registry_line: registry.line_no } : {}),
    detected_via: patched.context_overflow_detected_via,
    line: overflow.line,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.error(`Usage:
  node patch-context-overflow.mjs scan-and-patch --run-dir <dir> --registry <run_registry.jsonl> [--slice <path>]`);
}

function parseArgs(argv) {
  const a = argv.slice(2);
  const cmd = a.shift();
  const opts = {};
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    if (k === '--run-dir') opts.runDir = a[++i];
    else if (k === '--registry') opts.registryPath = a[++i];
    else if (k === '--slice') opts.slicePath = a[++i];
    else if (k === '--help' || k === '-h') { printHelp(); process.exit(0); }
    else { console.error(`unknown arg: ${k}`); printHelp(); process.exit(2); }
  }
  return { cmd, opts };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { cmd, opts } = parseArgs(process.argv);
  if (cmd !== 'scan-and-patch' || !opts.runDir || !opts.registryPath) {
    printHelp();
    process.exit(2);
  }
  try {
    const result = scanAndPatchRunDir(opts.runDir, opts);
    process.stdout.write(JSON.stringify(result) + '\n');
    // An overflow whose registry row could not be brought to the relabeled
    // state (and is not the audit-owned row_absent case) must redden the
    // sweep: the gate would otherwise read a mis-typed eligible failure.
    const ok =
      !result.overflow ||
      !result.relabeled ||
      ['patched', 'already_typed', 'row_absent'].includes(result.registry);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`patch-context-overflow scan-and-patch: ${e?.message ?? e}`);
    process.exit(1);
  }
}
