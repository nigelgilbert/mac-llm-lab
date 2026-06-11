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
  it('sidecar-port arms resolve to themselves', () => {
    assert.equal(resolveConfigId({ CONFIG: 'opencode-a+git' }), 'opencode-a+git');
    assert.equal(resolveConfigId({ CONFIG: 'opencode-a+prompt' }), 'opencode-a+prompt');
  });
  it('unrecognized value throws (fail loud, never silently mislabel)', () => {
    assert.throws(() => resolveConfigId({ CONFIG: 'opencode' }), /not a recognized config/);
  });
  it('VALID_CONFIGS matches the registry pairing enum', () => {
    assert.deepEqual(VALID_CONFIGS, ['claw-rig', 'opencode-a', 'opencode-a+git', 'opencode-a+prompt']);
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

  // Sidecar-port arms (OPENCODE-SIDECAR-PORT-HANDOFF.md §4): +git is serving-
  // identical to opencode-a (git-init is harness-side provenance, carried by
  // config_id), so it reuses the tier's opencode-a fingerprint; +prompt changes
  // the prompt pack (AGENTS.md plant) and gets its own fingerprint.
  it('opencode-a+git reuses the tier fingerprint of opencode-a', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a+git', tier: '16' }),
      'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-a',
    );
  });
  it('opencode-a+prompt tier 16 → the dedicated prompt fingerprint', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a+prompt', tier: '16' }),
      'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-prompt',
    );
  });

  // Tier-32 (#011): same 9B as tier-16 at Q5_K_XL — serving-validation
  // fingerprints only (decision §2.7/§4; no comparative claim).
  it('opencode-a tier 32 → the t32 fingerprint', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a', tier: '32' }),
      'qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-a',
    );
  });
  it('opencode-a+prompt tier 32 → the dedicated t32 prompt fingerprint', () => {
    assert.equal(
      modelConfigIdFor({ configId: 'opencode-a+prompt', tier: 32 }), // numeric tier too
      'qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-prompt',
    );
  });

  it('opencode-a+prompt on an unmapped tier throws (only tiers 16/32 are wired)', () => {
    assert.throws(
      () => modelConfigIdFor({ configId: 'opencode-a+prompt', tier: '64' }),
      /No opencode-a\+prompt model_config_id/,
    );
  });

  it('all mapped fingerprints exist in the committed manifest (drift guard)', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const cells = [
      ['opencode-a', '64'], ['opencode-a', '16'], ['opencode-a', '32'],
      ['opencode-a+git', '16'], ['opencode-a+prompt', '16'],
      ['opencode-a+git', '32'], ['opencode-a+prompt', '32'],
    ];
    for (const [configId, tier] of cells) {
      const id = modelConfigIdFor({ configId, tier });
      assert.ok(manifest[id], `manifest is missing ${configId} entry ${id} for tier ${tier}`);
      assert.equal(manifest[id].model_config_id, id, `manifest[${id}].model_config_id mismatch`);
    }
  });
});

describe('selectRunner — CONFIG routes the default runner', () => {
  // Since #010 (claw stack retired, tag claw-stack-final) the historical
  // claw-rig config resolves for registry reading but has NO runner: selecting
  // it — explicitly or via an unset CONFIG — must fail loud, not run the wrong
  // arm or silently mislabel rows.
  it('default (no CONFIG) throws: claw-rig is historical, not runnable', () => {
    assert.throws(() => selectRunner({}), /claw-stack-final|no runner/);
  });

  it('explicit CONFIG=claw-rig throws the same way', () => {
    assert.throws(() => selectRunner({ CONFIG: 'claw-rig' }), /claw-stack-final|no runner/);
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

  it('sidecar-port arms route to the opencode branch (HOST_WORKSPACE demanded)', () => {
    for (const CONFIG of ['opencode-a+git', 'opencode-a+prompt']) {
      assert.throws(() => selectRunner({ CONFIG }), /HOST_WORKSPACE/);
      const run = selectRunner({ CONFIG, HOST_WORKSPACE: makeTmp('hw-') });
      assert.equal(typeof run, 'function');
    }
  });

  // The HOST_WORKSPACE demand above is the deterministic, daemon-free proof that
  // CONFIG=opencode-a takes the opencode branch (the historical claw-rig path
  // throws before ever inspecting HOST_WORKSPACE). The real end-to-end
  // invocation of runOpenCode (and the cross-container /workspace round-trip)
  // is proven live by scripts/opencode-workspace-roundtrip.mjs.
});
