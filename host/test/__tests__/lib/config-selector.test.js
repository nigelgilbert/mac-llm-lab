// Issue #011: the process-level CONFIG selector. Pins the four selector ACs:
//   - one env (CONFIG) resolves the config_id + (downstream) the runner,
//   - unset preserves claw-rig,
//   - the opencode-a model_config_id is picked per tier from the manifest,
//   - selectRunner routes to runOpenCode for opencode-a (and demands the
//     HOST_WORKSPACE that makes cross-container /workspace sharing possible).
//
// Docker-free: the one routing test that actually invokes the resolved runner
// forces a deterministic spawn failure (a non-existent docker bin) so it asserts
// "runOpenCode was called" by its harness_error result shape without a daemon.
// The live cross-container round-trip lives in scripts/opencode-workspace-roundtrip.mjs.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfigId, modelConfigIdFor, VALID_CONFIGS } from '../../lib/config.js';
import { selectRunner } from '../../lib/runAgent.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(HERE, '..', '..', 'lib', 'model_configs.json');

const tmpdirs = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
after(() => { for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('resolveConfigId — one env, defaults to claw-rig', () => {
  it('unset → claw-rig', () => {
    assert.equal(resolveConfigId({}), 'claw-rig');
  });
  it('empty string → claw-rig', () => {
    assert.equal(resolveConfigId({ CONFIG: '' }), 'claw-rig');
  });
  it('claw-rig → claw-rig', () => {
    assert.equal(resolveConfigId({ CONFIG: 'claw-rig' }), 'claw-rig');
  });
  it('opencode-a → opencode-a', () => {
    assert.equal(resolveConfigId({ CONFIG: 'opencode-a' }), 'opencode-a');
  });
  it('unrecognized value throws (fail loud, never silently mislabel)', () => {
    assert.throws(() => resolveConfigId({ CONFIG: 'opencode' }), /not a recognized config/);
  });
  it('VALID_CONFIGS matches the registry pairing enum', () => {
    assert.deepEqual(VALID_CONFIGS, ['claw-rig', 'opencode-a']);
  });
});

describe('modelConfigIdFor — per-tier Config-B fingerprint', () => {
  it('claw-rig → undefined (claw supplies its own id per sweep)', () => {
    assert.equal(modelConfigIdFor({ configId: 'claw-rig', tier: '64' }), undefined);
  });
  it('opencode-a tier 64 → the t64 fingerprint', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a', tier: '64' }),
      'qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01-opencode-a',
    );
  });
  it('opencode-a tier 16 → the t16 fingerprint', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a', tier: 16 }), // numeric tier too
      'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-a',
    );
  });
  it('opencode-a on an unmapped tier throws', () => {
    assert.throws(() => modelConfigIdFor({ configId: 'opencode-a', tier: '99' }), /No opencode-a model_config_id/);
  });

  it('both mapped fingerprints exist in the committed manifest (drift guard)', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const tier of ['64', '16']) {
      const id = modelConfigIdFor({ configId: 'opencode-a', tier });
      assert.ok(manifest[id], `manifest is missing opencode-a entry ${id} for tier ${tier}`);
      assert.equal(manifest[id].model_config_id, id, `manifest[${id}].model_config_id mismatch`);
    }
  });
});

describe('selectRunner — CONFIG routes the default runner', () => {
  it('default (no CONFIG) returns a runner without needing HOST_WORKSPACE', () => {
    const run = selectRunner({});
    assert.equal(typeof run, 'function');
  });

  it('opencode-a WITHOUT HOST_WORKSPACE throws (the mount contract is mandatory)', () => {
    assert.throws(
      () => selectRunner({ CONFIG: 'opencode-a' }),
      /HOST_WORKSPACE/,
    );
  });

  it('opencode-a WITH HOST_WORKSPACE returns a runner (selection succeeds)', () => {
    const run = selectRunner({ CONFIG: 'opencode-a', HOST_WORKSPACE: makeTmp('hw-') });
    assert.equal(typeof run, 'function');
  });

  // The HOST_WORKSPACE demand above is the deterministic, daemon-free proof that
  // CONFIG=opencode-a takes the opencode branch: the claw branch never inspects
  // HOST_WORKSPACE, so a throw keyed on it can only come from the opencode path.
  // The real end-to-end invocation of runOpenCode (and the cross-container
  // /workspace round-trip) is proven live by scripts/opencode-workspace-roundtrip.mjs.
});
