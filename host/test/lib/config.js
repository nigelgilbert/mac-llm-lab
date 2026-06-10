// Process-level Config A/B selector (issue #011).
//
// ONE env — `CONFIG` — is the single source of truth for both halves of the
// A/B injection:
//   1. which runner runAgent's defaultRunner resolves to, and
//   2. the coarse `config_id` bundle label stamped on every registry row.
// Because the two ride the same value, test files stay BYTE-IDENTICAL (no
// per-file CONFIG branching) and a row's serving bundle can never disagree with
// the runner that produced it.
//
//   CONFIG unset | ''        → 'claw-rig'   (historical default; NOT runnable — see below)
//   CONFIG=claw-rig          → 'claw-rig'   (historical; readable, NOT runnable)
//   CONFIG=opencode-a        → 'opencode-a'
//   CONFIG=opencode-a+git    → 'opencode-a+git'    (sidecar-port A/B control arm)
//   CONFIG=opencode-a+prompt → 'opencode-a+prompt' (sidecar-port A/B treatment arm)
//
// `claw-rig` is HISTORICAL-ONLY since #008/#010 retired the claw stack
// (archived at git tag `claw-stack-final`). It stays in VALID_CONFIGS so the
// preserved registries under host/test/docs/data/ keep validating and the
// analysis scripts keep pairing against those rows — but
// lib/runAgent.js selectRunner throws if it is selected for execution.
//
// The `opencode-a+git` / `opencode-a+prompt` pair is the tier-16 sidecar-port
// experiment (OPENCODE-SIDECAR-PORT-HANDOFF.md §4): both get a git-initialized
// /workspace (OpenCode's rules discovery no-ops in a bare dir — handoff §2);
// `+prompt` additionally plants claw's system-prompt.md verbatim as AGENTS.md.
// Two arms because `git init` alone may change OpenCode behavior (snapshots/
// diffs) — comparing +prompt against +git isolates the *prompt* effect from the
// git-init confound. The original `opencode-a` stays byte-identical (bare
// workspace) so prior rows keep their meaning.
//
// The accepted values are exactly the `config_id` enum the registry already
// pairs on (lib/run_row.js default 'claw-rig'; paired_bootstrap treatment
// 'opencode-a' / baseline 'claw-rig'), so CONFIG *is* the config_id — no second
// mapping to keep in sync.
//
// This module imports nothing from runAgent.js / opencode.js / registry_emit.js
// so it can be a shared leaf dependency of all of them without an import cycle.

/** The accepted CONFIG / config_id values (the registry's coarse bundle enum).
 *  'claw-rig' is historical-only (readable rows, no runner). */
export const VALID_CONFIGS = ['claw-rig', 'opencode-a', 'opencode-a+git', 'opencode-a+prompt'];

/** Every RUNNABLE config — all route to the OpenCode runner. */
export const OPENCODE_CONFIGS = ['opencode-a', 'opencode-a+git', 'opencode-a+prompt'];

/**
 * True iff this config_id runs under the OpenCode harness (any arm).
 * @param {string} configId
 */
export function isOpenCodeConfig(configId) {
  return OPENCODE_CONFIGS.includes(configId);
}

/**
 * Resolve the active `config_id` from the process env. Unset/empty resolves to
 * 'claw-rig' (the historical default — kept so registry-reading code paths and
 * pre-#010 sidecars keep their meaning; selecting it for EXECUTION throws in
 * selectRunner, so an unset CONFIG fails loud at run time rather than running
 * the wrong arm). Throws on an unrecognized value — fail loud rather than
 * silently mislabel rows or pick the wrong runner.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {'claw-rig'|'opencode-a'|'opencode-a+git'|'opencode-a+prompt'}
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

// `opencode-a+prompt` plants claw's system-prompt.md as a committed AGENTS.md —
// that is a *prompt-pack* change, so it gets its own serving fingerprint.
// `opencode-a+git` is deliberately ABSENT here and falls through to the tier's
// plain opencode-a fingerprint: its serving (server, template, sampler, prompt
// pack) is byte-identical to opencode-a — only the workspace is git-initialized,
// which is harness-side provenance carried by config_id, not by model_config_id.
const OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER = {
  '16': 'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-prompt',
};

/**
 * The OpenCode (Config B) model_config_id for a given tier. Returns `undefined`
 * for the claw side (claw's production model_config_id varies per sampler sweep
 * and is always supplied explicitly via RUN_REGISTRY_MODEL_CONFIG_ID, so there
 * is nothing to auto-pick). Throws for an opencode request on an unknown tier
 * rather than emit a row against a non-existent manifest entry.
 *
 * @param {Object} o
 * @param {'claw-rig'|'opencode-a'|'opencode-a+git'|'opencode-a+prompt'} o.configId
 * @param {string|number} o.tier   Hardware tier (e.g. '64' | '16').
 * @returns {string|undefined}
 */
export function modelConfigIdFor({ configId, tier } = {}) {
  if (!isOpenCodeConfig(configId)) return undefined;
  const key = String(tier);
  const map = configId === 'opencode-a+prompt'
    ? OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER
    : OPENCODE_MODEL_CONFIG_ID_BY_TIER;
  const id = map[key];
  if (!id) {
    throw new Error(
      `No ${configId} model_config_id mapped for tier "${tier}"; known tiers: ` +
      `${Object.keys(map).join(', ')}.`,
    );
  }
  return id;
}
