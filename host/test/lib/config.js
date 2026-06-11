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
// (node built-ins only — fs/path/url for the #016 tier-table parser below.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // tier-32: same 9B as tier-16 at Q5_K_XL — adopted by extrapolation
  // (decision §2.7); rows are serving validation only, never a comparative
  // claim (§4). Wired for #011's functional smoke.
  '32': 'qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-a',
};

// `opencode-a+prompt` plants claw's system-prompt.md as a committed AGENTS.md —
// that is a *prompt-pack* change, so it gets its own serving fingerprint.
// `opencode-a+git` is deliberately ABSENT here and falls through to the tier's
// plain opencode-a fingerprint: its serving (server, template, sampler, prompt
// pack) is byte-identical to opencode-a — only the workspace is git-initialized,
// which is harness-side provenance carried by config_id, not by model_config_id.
const OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER = {
  '16': 'qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-prompt',
  '32': 'qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-prompt',
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

// ---------------------------------------------------------------------------
// #016 single tier table — host/llama-server/tiers.conf, parsed JS-side.
// ---------------------------------------------------------------------------
// The tier IDENTITY map (tier → port / opencode config json / launchd label /
// log tag) lives in ONE file: host/llama-server/tiers.conf. Every bash
// consumer (opencode-server, oc, run-config-ab.sh, wizard) sources it; the JS
// side parses the same file here so lib/opencode_server_timings.js
// defaultServerLogPath() derives from the same source instead of private
// per-tier literals (the tier-32 log-path bug class).
//
// HERMETICITY: the baked test image mounts only host/test/{lib,scripts,
// __tests__}, so the conf is NOT visible to the unit suite. Design (#016,
// recorded in the issue Result): `loadTierTable()` parses the conf when
// readable (host node, the path-matched eval-runner mount — i.e. every LIVE
// seat) and returns null otherwise; `tierTable()` then falls back to
// FALLBACK_TIER_TABLE, an embedded snapshot of the conf's identity rows. The
// "cannot disagree" property is enforced by (a) the tier-table contract test
// (__tests__/lib/tier-table.contract.test.js), which asserts parsed-conf ===
// FALLBACK_TIER_TABLE whenever the conf is readable, and (b)
// host/llama-server/scripts/check-tier-table.sh, which runs that comparison
// (plus every bash consumer) against the real conf on the host. Note the live
// sweep path doesn't even reach the fallback: the driver passes
// OPENCODE_LLAMA_LOG explicitly whenever OPENCODE_SERVER_TIMINGS=1.

/** Default on-disk location of the tier table, resolved relative to this
 *  module (host/test/lib → host/llama-server). Holds on the host and in any
 *  path-matched repo mount; intentionally absent in the baked test image. */
export const TIERS_CONF_DEFAULT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../llama-server/tiers.conf',
);

/**
 * Embedded snapshot of tiers.conf's identity rows — the LAST-RESORT fallback
 * for contexts where the conf file is not visible (the hermetic unit-test
 * image). MUST be updated in the same change as tiers.conf: the tier-table
 * contract test fails on any divergence wherever the conf is readable, and
 * scripts/check-tier-table.sh fails it on the host.
 */
export const FALLBACK_TIER_TABLE = Object.freeze({
  default: '64',
  log_base: '/tmp/opencode-llama-server',
  tiers: Object.freeze({
    '64': Object.freeze({
      port: 11436,
      opencode_config: 'opencode.json',
      launchd_label: 'com.mac-llm-lab.opencode-server',
      log_tag: '',
      alias: 'opencode',
      template: 'qwen36-corrected.jinja',
      log_path: '/tmp/opencode-llama-server.log',
    }),
    '16': Object.freeze({
      port: 11437,
      opencode_config: 'opencode.16.json',
      launchd_label: 'com.mac-llm-lab.opencode-server-16',
      log_tag: '-16',
      alias: 'opencode-16',
      template: 'qwen35-corrected.jinja',
      log_path: '/tmp/opencode-llama-server-16.log',
    }),
    '32': Object.freeze({
      port: 11438,
      opencode_config: 'opencode.32.json',
      launchd_label: '-', // "-" = no launchd path by design (on-demand only)
      log_tag: '-32',
      alias: 'opencode-32',
      template: 'qwen35-corrected.jinja',
      log_path: '/tmp/opencode-llama-server-32.log',
    }),
  }),
});

/**
 * Parse tiers.conf text into the tier table. Honors the conf's FORMAT
 * CONTRACT: only column-1 `KEY=VALUE` lines parse (one optional matching pair
 * of double quotes stripped; values are literals); comments, blank lines and
 * the indented tier_resolve() body are ignored. Throws on a structurally
 * broken table (no TIERS_ALL, or a listed tier missing its PORT) — fail loud,
 * never half-resolve.
 *
 * @param {string} text
 * @returns {{ default: string|null, log_base: string|null,
 *             tiers: Record<string, object> }}
 */
export function parseTiersConf(text) {
  const vars = {};
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/^([A-Z][A-Z0-9_]*)=(?:"([^"]*)"|([^\s#]*))\s*$/);
    if (m) vars[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  const tiersAll = (vars.TIERS_ALL ?? '').trim().split(/\s+/).filter(Boolean);
  if (tiersAll.length === 0) {
    throw new Error('tiers.conf: TIERS_ALL missing/empty — not a tier table');
  }
  const logBase = vars.OPENCODE_LOG_BASE ?? null;
  const tiers = {};
  for (const t of tiersAll) {
    const field = (name) => vars[`TIER_${t}_${name}`];
    if (field('PORT') === undefined) {
      throw new Error(`tiers.conf: tier ${t} is in TIERS_ALL but TIER_${t}_PORT is missing`);
    }
    const logTag = field('LOG_TAG') ?? '';
    tiers[t] = {
      port: Number(field('PORT')),
      opencode_config: field('OPENCODE_CONFIG') ?? null,
      launchd_label: field('LAUNCHD_LABEL') ?? null, // "-" kept verbatim
      log_tag: logTag,
      alias: field('ALIAS') ?? null,
      template: field('TEMPLATE') ?? null,
      log_path: logBase != null ? `${logBase}${logTag}.log` : null,
    };
  }
  return { default: vars.TIER_DEFAULT ?? null, log_base: logBase, tiers };
}

/**
 * Load + parse the tier table from disk. Injectable for tests/tools:
 * `text` wins outright; else `path`, else the OPENCODE_TIERS_CONF env
 * override, else TIERS_CONF_DEFAULT_PATH. Returns null when the file is
 * unreadable (the hermetic-image case) — callers fall back via tierTable().
 * Parse errors on a READABLE file still throw (a broken table must be loud).
 *
 * @param {{ path?: string, text?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function loadTierTable({ path: confPath, text, env = process.env } = {}) {
  if (text != null) return parseTiersConf(text);
  const p = confPath ?? env.OPENCODE_TIERS_CONF ?? TIERS_CONF_DEFAULT_PATH;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  return parseTiersConf(raw);
}

let cachedTierTable;
/**
 * The effective tier table: the parsed conf when readable, else the embedded
 * FALLBACK_TIER_TABLE snapshot (contract-tested against the conf). Cached for
 * the process lifetime — the table is static infrastructure identity.
 */
export function tierTable() {
  if (cachedTierTable === undefined) {
    cachedTierTable = loadTierTable() ?? FALLBACK_TIER_TABLE;
  }
  return cachedTierTable;
}
