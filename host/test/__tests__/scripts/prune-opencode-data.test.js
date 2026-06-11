// Unit tests for the #015 disk-hygiene prune — the decision core of
// scripts/prune-opencode-data.mjs plus the shared deletion primitive
// lib/opencode.js pruneOpenCodeDataDir (the SAME primitive the runner's
// end-of-run hook calls).
//
// What is pinned, and why it matters:
//   1. The prune predicate: ONLY a runDir whose run_summary.json parses with
//      telemetry === 'transcript' AND whose iterations.jsonl exists is
//      prunable. Degraded (outcome_only) runs RETAIN opencode-data/ — it is
//      the only debugging oracle on that path; a wrong 'prune' here destroys
//      evidence, a wrong 'retain' merely wastes ~1.1 MB.
//   2. The deletion primitive's basename guard: pruneOpenCodeDataDir refuses
//      anything not named exactly 'opencode-data', so no caller bug can ever
//      delete a runDir or a sidecar file.
//   3. Sidecar survival: after a prune, iterations.jsonl / run_summary.json /
//      assertion_result.json / server.timings.jsonl / server-log.slice are
//      byte-identical and the runDir itself remains.
//   4. The CLI contract: dry-run by default (deletes NOTHING, reports what it
//      would free); --apply deletes exactly the prunable set; runDir count is
//      unchanged either way.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DATA_SUBDIR,
  classifyRunDir,
  shouldPruneRunDir,
  duBytes,
  scanRuntimeRoot,
} from '../../scripts/prune-opencode-data.mjs';
import { pruneOpenCodeDataDir } from '../../lib/opencode.js';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/prune-opencode-data.mjs',
);

const tmpdirs = [];
function mkTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-ocdata-'));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture builders — runDirs in the exact on-disk shapes the runner writes.
// ---------------------------------------------------------------------------

function writeDataCapture(runDir, { bytes = 4096 } = {}) {
  const dataDir = path.join(runDir, DATA_SUBDIR);
  fs.mkdirSync(path.join(dataDir, 'log'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'opencode.db'), Buffer.alloc(bytes, 7));
  fs.writeFileSync(path.join(dataDir, 'opencode.db-wal'), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(dataDir, 'log', 'opencode.log'), 'log line\n');
  return dataDir;
}

/** A normalized (non-degraded) runDir: transcript sidecars + DB capture. */
function mkTranscriptRunDir(root, name, opts = {}) {
  const runDir = path.join(root, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'),
    JSON.stringify({ schema_version: 1, run_id: name, iter: 1 }) + '\n');
  fs.writeFileSync(path.join(runDir, 'run_summary.json'),
    JSON.stringify({ schema_version: 1, run_id: name, telemetry: 'transcript', iter_count: 1 }, null, 2) + '\n');
  if (opts.withTimings) {
    fs.writeFileSync(path.join(runDir, 'server.timings.jsonl'),
      JSON.stringify({ run_id: name, iter: 1, server_decode_ms: 42 }) + '\n');
  }
  if (opts.withSlice) {
    fs.writeFileSync(path.join(runDir, 'server-log.slice'), 'slot print_timing: id 0 | task 1 |\n');
  }
  if (opts.withAssertion) {
    fs.writeFileSync(path.join(runDir, 'assertion_result.json'),
      JSON.stringify({ passed: true }) + '\n');
  }
  if (opts.withData !== false) writeDataCapture(runDir, opts);
  return runDir;
}

/** A degraded runDir: outcome-only sidecar, DB capture retained. */
function mkDegradedRunDir(root, name) {
  const runDir = path.join(root, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'iterations.jsonl'), '');
  fs.writeFileSync(path.join(runDir, 'run_summary.json'),
    JSON.stringify({ schema_version: 1, run_id: name, telemetry: 'outcome_only', iter_count: 0 }, null, 2) + '\n');
  writeDataCapture(runDir);
  return runDir;
}

function snapshotFiles(runDir, names) {
  const snap = {};
  for (const n of names) {
    const p = path.join(runDir, n);
    snap[n] = fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  return snap;
}

// ---------------------------------------------------------------------------
// 1. The prune predicate (classifyRunDir / shouldPruneRunDir).
// ---------------------------------------------------------------------------

describe('classifyRunDir — the #015 prune predicate', () => {
  it('prunes: telemetry=transcript + iterations.jsonl + opencode-data/ present', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1');
    const c = classifyRunDir(runDir);
    assert.equal(c.decision, 'prune');
    assert.equal(c.telemetry, 'transcript');
    assert.equal(shouldPruneRunDir(runDir), true);
  });

  it('retains the degraded outcome_only path (the debugging oracle)', () => {
    const root = mkTmpDir();
    const runDir = mkDegradedRunDir(root, 'r1');
    const c = classifyRunDir(runDir);
    assert.equal(c.decision, 'retain_degraded');
    assert.equal(c.telemetry, 'outcome_only');
    assert.equal(shouldPruneRunDir(runDir), false);
  });

  it('retains on an UNKNOWN telemetry marker (conservative: exact match only)', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1');
    fs.writeFileSync(path.join(runDir, 'run_summary.json'),
      JSON.stringify({ run_id: 'r1', telemetry: 'transcript_v2_or_whatever' }) + '\n');
    assert.equal(classifyRunDir(runDir).decision, 'retain_degraded');
  });

  it('retains when run_summary.json is missing', () => {
    const root = mkTmpDir();
    const runDir = path.join(root, 'r1');
    fs.mkdirSync(runDir, { recursive: true });
    writeDataCapture(runDir);
    assert.equal(classifyRunDir(runDir).decision, 'retain_no_summary');
  });

  it('retains when run_summary.json is unparseable', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1');
    fs.writeFileSync(path.join(runDir, 'run_summary.json'), '{not json');
    assert.equal(classifyRunDir(runDir).decision, 'retain_bad_summary');
  });

  it('retains when iterations.jsonl is missing despite telemetry=transcript', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1');
    fs.rmSync(path.join(runDir, 'iterations.jsonl'));
    assert.equal(classifyRunDir(runDir).decision, 'retain_no_iterations');
  });

  it('no_data when opencode-data/ is absent (already-pruned runDir is a no-op)', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1', { withData: false });
    const c = classifyRunDir(runDir);
    assert.equal(c.decision, 'no_data');
    assert.equal(c.dataDir, null);
  });

  it('no_data when opencode-data is a FILE, not a directory', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1', { withData: false });
    fs.writeFileSync(path.join(runDir, DATA_SUBDIR), 'imposter');
    assert.equal(classifyRunDir(runDir).decision, 'no_data');
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. The deletion primitive and sidecar survival.
// ---------------------------------------------------------------------------

describe('pruneOpenCodeDataDir — basename-guarded deletion primitive', () => {
  it('deletes an opencode-data/ tree and NOTHING else in the runDir', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1', {
      withTimings: true, withSlice: true, withAssertion: true,
    });
    const keep = ['iterations.jsonl', 'run_summary.json', 'assertion_result.json',
      'server.timings.jsonl', 'server-log.slice'];
    const before = snapshotFiles(runDir, keep);

    assert.equal(pruneOpenCodeDataDir(path.join(runDir, DATA_SUBDIR)), true);

    assert.equal(fs.existsSync(path.join(runDir, DATA_SUBDIR)), false, 'capture dir gone');
    assert.equal(fs.existsSync(runDir), true, 'runDir itself survives');
    const afterSnap = snapshotFiles(runDir, keep);
    for (const n of keep) {
      assert.ok(afterSnap[n] !== null, `${n} still present`);
      assert.deepEqual(afterSnap[n], before[n], `${n} byte-identical`);
    }
  });

  it('refuses any path not named exactly opencode-data (returns false, deletes nothing)', () => {
    const root = mkTmpDir();
    const runDir = mkTranscriptRunDir(root, 'r1');
    assert.equal(pruneOpenCodeDataDir(runDir), false, 'refuses the runDir itself');
    assert.equal(pruneOpenCodeDataDir(path.join(runDir, 'iterations.jsonl')), false, 'refuses a sidecar');
    assert.equal(pruneOpenCodeDataDir(''), false, 'refuses empty');
    assert.equal(pruneOpenCodeDataDir(null), false, 'refuses null');
    assert.equal(fs.existsSync(path.join(runDir, 'iterations.jsonl')), true);
    assert.equal(fs.existsSync(path.join(runDir, DATA_SUBDIR)), true);
  });

  it('is idempotent: pruning an already-absent dir returns true (force semantics)', () => {
    const root = mkTmpDir();
    const absent = path.join(root, 'never-made', DATA_SUBDIR);
    assert.equal(pruneOpenCodeDataDir(absent), true);
  });
});

describe('duBytes / scanRuntimeRoot', () => {
  it('duBytes sums a tree; scan reports per-dir capture bytes', () => {
    const root = mkTmpDir();
    mkTranscriptRunDir(root, 'r1', { bytes: 10_000 });
    const rows = scanRuntimeRoot(root);
    assert.equal(rows.length, 1);
    // 10000 (db) + 64 (wal) + 9 ('log line\n') = 10073
    assert.equal(rows[0].bytes, 10_073);
    assert.equal(rows[0].decision, 'prune');
  });

  it('classifies a mixed root and never lists non-capture entries as prunable', () => {
    const root = mkTmpDir();
    mkTranscriptRunDir(root, 'aaa');
    mkDegradedRunDir(root, 'bbb');
    mkTranscriptRunDir(root, 'ccc', { withData: false }); // already pruned
    fs.mkdirSync(path.join(root, 'smoke', 'live-ws'), { recursive: true }); // scratch
    const rows = scanRuntimeRoot(root);
    const byName = Object.fromEntries(rows.map((r) => [path.basename(r.runDir), r.decision]));
    assert.deepEqual(byName, {
      aaa: 'prune', bbb: 'retain_degraded', ccc: 'no_data', smoke: 'no_data',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. CLI contract: dry-run default, --apply, count invariance.
// ---------------------------------------------------------------------------

describe('prune-opencode-data.mjs CLI', () => {
  function runCli(args) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return r;
  }

  it('dry-run (default) reports the prunable set and deletes NOTHING', () => {
    const root = mkTmpDir();
    mkTranscriptRunDir(root, 'aaa', { bytes: 2048 });
    mkDegradedRunDir(root, 'bbb');

    const r = runCli(['--root', root, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.mode, 'dry-run');
    assert.equal(rep.dirs_scanned, 2);
    assert.equal(rep.prunable, 1);
    assert.ok(rep.prunable_bytes > 2048, 'reports bytes it would free');
    assert.equal(rep.pruned, 0);
    assert.equal(fs.existsSync(path.join(root, 'aaa', DATA_SUBDIR)), true, 'dry-run deleted nothing');
    assert.equal(fs.existsSync(path.join(root, 'bbb', DATA_SUBDIR)), true);
  });

  it('--apply prunes exactly the prunable set; runDir count unchanged; sidecars intact', () => {
    const root = mkTmpDir();
    mkTranscriptRunDir(root, 'aaa', { withTimings: true, withSlice: true, withAssertion: true });
    mkDegradedRunDir(root, 'bbb');
    mkTranscriptRunDir(root, 'ccc', { withData: false });
    const countBefore = fs.readdirSync(root).length;

    const r = runCli(['--root', root, '--apply', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.mode, 'apply');
    assert.equal(rep.pruned, 1);
    assert.equal(rep.prune_failures, 0);
    assert.ok(rep.pruned_bytes > 0);

    assert.equal(fs.readdirSync(root).length, countBefore, 'runDir count unchanged');
    assert.equal(fs.existsSync(path.join(root, 'aaa', DATA_SUBDIR)), false, 'normalized capture pruned');
    assert.equal(fs.existsSync(path.join(root, 'bbb', DATA_SUBDIR)), true, 'degraded capture retained');
    for (const f of ['iterations.jsonl', 'run_summary.json', 'assertion_result.json',
      'server.timings.jsonl', 'server-log.slice']) {
      assert.equal(fs.existsSync(path.join(root, 'aaa', f)), true, `${f} intact`);
    }
  });

  it('refuses a nonexistent root with exit 2', () => {
    const r = runCli(['--root', path.join(os.tmpdir(), 'no-such-prune-root-xyz')]);
    assert.equal(r.status, 2);
  });
});
