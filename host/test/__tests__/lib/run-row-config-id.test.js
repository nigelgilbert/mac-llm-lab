// Issue #002: registry `config_id` dimension. Pins the acceptance criteria:
// the coarse bundle label is a required, enum-constrained schema field; row
// assembly populates it from run context; and validation accepts valid values
// while rejecting out-of-enum and missing ones.
//
// Issue #009 (config_id provenance): assembleRow no longer defaults an absent
// ctx.config_id to 'claw-rig' — it THROWS naming the field. The old default
// let offline-recovered opencode runs get silently stamped as the historical
// claw baseline and land on the wrong side of the A/B. 'claw-rig' stays in the
// schema enum (preserved historical registries keep validating); it just can't
// be minted by omission.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRow } from '../../lib/registry.js';
import { assembleRow, RunRowAssemblyError } from '../../lib/run_row.js';

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });
});

// A minimal model-config manifest so assembleRow can resolve denormalized
// fields without depending on the committed manifest.
const MODEL_CONFIG_ID = 'test-config-001';
function writeManifest() {
  const dir = makeTmp('rr-manifest-');
  const p = path.join(dir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify({
    [MODEL_CONFIG_ID]: {
      model_config_id: MODEL_CONFIG_ID,
      model_id: 'test/model@rev',
      model_family: 'test',
      quantization: 'Q4_K_M',
      context_limit: 8192,
      runtime_backend: 'llama-server@test',
      sampler_config_id: 'sampler-001',
      harness_version: 'h-test',
      prompt_pack_version: 'pp-test',
    },
  }));
  return p;
}

function baseCtx(manifestPath, extra = {}) {
  return {
    run_kind: 'smoke',
    hardware_tier: 16,
    memory_gb: 16,
    model_config_id: MODEL_CONFIG_ID,
    test_id: 'expression-eval',
    test_version: 'v1',
    oracle_type: 'public_verifier',
    harness_version: 'h-test',
    manifestPath,
    ...extra,
  };
}

// assembleRow reads sidecar artifacts from runDir; an empty dir exercises the
// "no artifacts" fallbacks (start_time defaults to now, terminal_status from
// claw exit code) which is all we need to check config_id threading.
function clawResult() {
  return { runId: 'run-abc', runDir: makeTmp('rr-run-'), code: 0 };
}

describe('run-registry config_id dimension (issue #002)', () => {
  it('threads an explicit config_id from run context', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: 'opencode-a' }));
    assert.equal(row.config_id, 'opencode-a');
    assert.deepEqual(validateRow(row), []);
  });

  it('still accepts an EXPLICIT claw-rig (historical label stays in the enum)', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: 'claw-rig' }));
    assert.equal(row.config_id, 'claw-rig');
    assert.deepEqual(validateRow(row), []);
  });

  it('accepts both enum values and rejects an out-of-enum value', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: 'claw-rig' }));

    assert.deepEqual(validateRow({ ...row, config_id: 'claw-rig' }), []);
    assert.deepEqual(validateRow({ ...row, config_id: 'opencode-a' }), []);

    const bad = validateRow({ ...row, config_id: 'bogus' });
    assert.ok(
      bad.some((e) => e.includes('config_id') && e.includes('not in enum')),
      `expected an enum-membership error, got ${JSON.stringify(bad)}`,
    );
  });

  it('rejects a row missing config_id (required field)', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: 'claw-rig' }));
    const { config_id, ...withoutConfigId } = row;
    const errs = validateRow(withoutConfigId);
    assert.ok(
      errs.some((e) => e.includes('missing required field: config_id')),
      `expected a missing-required error, got ${JSON.stringify(errs)}`,
    );
  });
});

describe('config_id provenance: required, no claw-rig default (issue #009)', () => {
  it('throws when ctx omits config_id, naming the field', () => {
    const manifestPath = writeManifest();
    assert.throws(
      () => assembleRow(clawResult(), baseCtx(manifestPath)),
      (err) => {
        assert.ok(err instanceof RunRowAssemblyError, `expected RunRowAssemblyError, got ${err?.name}`);
        assert.match(err.message, /config_id/, 'error message must name the missing field');
        return true;
      },
    );
  });

  it('throws on null and empty-string config_id too (no silent fallthrough)', () => {
    const manifestPath = writeManifest();
    for (const bad of [null, '']) {
      assert.throws(
        () => assembleRow(clawResult(), baseCtx(manifestPath, { config_id: bad })),
        /config_id/,
        `config_id=${JSON.stringify(bad)} must throw`,
      );
    }
  });

  it('never mints claw-rig by omission: every assembled row carries the ctx label verbatim', () => {
    const manifestPath = writeManifest();
    for (const cid of ['opencode-a', 'opencode-a+git', 'opencode-a+prompt']) {
      const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: cid }));
      assert.equal(row.config_id, cid);
      assert.notEqual(row.config_id, 'claw-rig');
      assert.deepEqual(validateRow(row), []);
    }
  });
});
