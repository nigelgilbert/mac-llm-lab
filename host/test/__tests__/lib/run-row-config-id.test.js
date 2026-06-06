// Issue #002: registry `config_id` dimension. Pins the four acceptance
// criteria: the coarse bundle label is a required, enum-constrained schema
// field; row assembly populates it from run context; existing claw runs
// default to `claw-rig`; and validation accepts valid values while rejecting
// out-of-enum and missing ones.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRow } from '../../lib/registry.js';
import { assembleRow } from '../../lib/run_row.js';

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
  it('defaults existing claw runs to claw-rig when ctx omits config_id', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath));
    assert.equal(row.config_id, 'claw-rig');
    assert.deepEqual(validateRow(row), []);
  });

  it('threads an explicit config_id from run context', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath, { config_id: 'opencode-a' }));
    assert.equal(row.config_id, 'opencode-a');
    assert.deepEqual(validateRow(row), []);
  });

  it('accepts both enum values and rejects an out-of-enum value', () => {
    const manifestPath = writeManifest();
    const row = assembleRow(clawResult(), baseCtx(manifestPath));

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
    const row = assembleRow(clawResult(), baseCtx(manifestPath));
    const { config_id, ...withoutConfigId } = row;
    const errs = validateRow(withoutConfigId);
    assert.ok(
      errs.some((e) => e.includes('missing required field: config_id')),
      `expected a missing-required error, got ${JSON.stringify(errs)}`,
    );
  });
});
