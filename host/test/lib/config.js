// Process-level Config A/B selector (issue #011).
//
// ONE env — `CONFIG` — is the single source of truth for both halves of the
// A/B injection:
//   1. which runner runAgent's defaultRunner resolves to (claw vs opencode), and
//   2. the coarse `config_id` bundle label stamped on every registry row.
// Because the two ride the same value, test files stay BYTE-IDENTICAL (no
// per-file CONFIG branching) and a row's serving bundle can never disagree with
// the runner that produced it.
//
//   CONFIG unset | ''   → 'claw-rig'   (default; current behavior preserved)
//   CONFIG=claw-rig     → 'claw-rig'
//   CONFIG=opencode-a   → 'opencode-a'
//
// The accepted values are exactly the `config_id` enum the registry already
// pairs on (lib/run_row.js default 'claw-rig'; paired_bootstrap treatment
// 'opencode-a' / baseline 'claw-rig'), so CONFIG *is* the config_id — no second
// mapping to keep in sync.
//
// This module imports nothing from claw.js / runAgent.js / opencode.js so it can
// be a shared leaf dependency of all three without an import cycle.

/** The accepted CONFIG / config_id values (the registry's coarse bundle enum). */
export const VALID_CONFIGS = ['claw-rig', 'opencode-a'];

/**
 * Resolve the active `config_id` from the process env. Unset/empty defaults to
 * 'claw-rig' so pre-opencode callers are unaffected. Throws on an unrecognized
 * value — fail loud rather than silently mislabel rows or pick the wrong runner.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {'claw-rig'|'opencode-a'}
 */
export function resolveConfigId(env = process.env) {
  const raw = env.CONFIG;
  if (raw === undefined || raw === '') return 'claw-rig';
  if (!VALID_CONFIGS.includes(raw)) {
    throw new Error(
      `CONFIG="${raw}" is not a recognized config; expected one of ` +
      `${VALID_CONFIGS.join(', ')} (unset = claw-rig).`,
    );
  }
  return raw;
}

// Config-B (OpenCode) serving fingerprints per hardware tier. These are the
// distinct model_config_ids decided in OPENCODE-HARNESS-AB-PLAN.md §4.5 and
// committed in lib/model_configs.json — same weights/sampler as the tier's claw
// production config, but a serving note describing OpenCode's path (corrected
// Jinja, no grammar, native tool-call, thinking-off). Keyed by TIER string so a
// driver only needs CONFIG=opencode-a + TIER; the right fingerprint is picked
// for it. The committed manifest is the source of truth for the *details*; this
// map only routes tier→id (a unit test asserts both ids exist in the manifest).
const OPENCODE_MODEL_CONFIG_ID_BY_TIER = {
  '64': 'qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01-opencode-a',
  '16': 'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-a',
};

/**
 * The OpenCode (Config B) model_config_id for a given tier. Returns `undefined`
 * for the claw side (claw's production model_config_id varies per sampler sweep
 * and is always supplied explicitly via RUN_REGISTRY_MODEL_CONFIG_ID, so there
 * is nothing to auto-pick). Throws for an opencode-a request on an unknown tier
 * rather than emit a row against a non-existent manifest entry.
 *
 * @param {Object} o
 * @param {'claw-rig'|'opencode-a'} o.configId
 * @param {string|number} o.tier   Hardware tier (e.g. '64' | '16').
 * @returns {string|undefined}
 */
export function modelConfigIdFor({ configId, tier } = {}) {
  if (configId !== 'opencode-a') return undefined;
  const key = String(tier);
  const id = OPENCODE_MODEL_CONFIG_ID_BY_TIER[key];
  if (!id) {
    throw new Error(
      `No opencode-a model_config_id mapped for tier "${tier}"; known tiers: ` +
      `${Object.keys(OPENCODE_MODEL_CONFIG_ID_BY_TIER).join(', ')}.`,
    );
  }
  return id;
}
