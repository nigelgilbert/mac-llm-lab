# Harness opencode-native: delete the claw half, generic config-vs-config driver

**Type**: AFK

**Status:** ✅ Done (2026-06-10)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.8, §3.5.

## What to build

Make the eval harness opencode-native now that the production claw stack is
gone (#008):

- delete `lib/claw.js` and every claw branch in `runAgent`/`config`/
  reporters/entrypoint (the claw-rig config_id stays valid in the registry
  *schema* — historical rows in the preserved registries must keep
  validating — but is no longer runnable),
- generalize the phase-swap driver from its claw-vs-opencode shape into a
  config-vs-config driver: N arms from a list, any arm pairable as
  `--treatment`/`--baseline` (the analysis scripts already accept these
  flags), reuse-existing-rows mode kept,
- keep untouched: the 32-task panel, `runAgent`'s workspace pass oracle,
  registry/reporter, paired bootstrap,
- prune claw-only knobs (PHASE_SWAP launchd headroom dance, bridge health
  preflights) and their doc references.

Future A/Bs this enables, for the record: prompt variants, samplers, models,
thinking on/off — all as opencode arms.

## Acceptance criteria

- [x] `grep -ri 'runClaw\|claw\.js' host/test/lib host/test/scripts` returns nothing; unit tests green after deletion
- [x] A two-arm demo sweep (e.g. `opencode-a+git` vs `opencode-a+prompt`, 1 cell each) runs through the generalized driver and gates with explicit `--treatment/--baseline`
- [x] Committed historical registries still pass schema validation / verdict re-derivation (claw-rig rows readable, not runnable)
- [x] Driver header documents the new arm/baseline interface; stale claw references removed from harness docs

## Blocked by

- #008
- #009

## Result

### Deleted (git rm, 31 files)

- **lib:** `claw.js` (runner + telemetry joiner), `bridge.js`, `backend.js`,
  `model.js` (LiteLLM-bridge routing — bridge died in #008). `tier.js` slimmed
  to `TIER`/`TIER_LABEL` (the panel's only import from it).
- **claw-bridge suites + probes:** `__tests__/backend-ab/`, `__tests__/model-ab/`,
  `__tests__/settings-ab/`, tier-eval claw-bridge probes
  (`latency`/`prose-quality`/`tool-discipline` — emit no registry rows, decision
  doc §4) and `__tests__/tier-eval/frontier/` (direct `runClaw` callers).
  The **32-task runAgent panel is untouched** (32 files, byte-identical).
- **drivers:** `run-backend-ab.sh`, `run-model-ab.sh`, `run-model-settings-ab.sh`,
  `scripts/run-overnight-screen.sh` + `scripts/explore-cycle.sh` (both wrap the
  #008-deleted `llama-server/scripts/install` plist swap + bridge preflight).
- **`run-tier-eval.sh`: DELETED** (the "document the call" judgment): it was a
  sequential claw-tier sweep — installs claw llama-server plists via the deleted
  `scripts/install`, preflights the deleted :4000 bridge, runs suites through the
  claw entrypoint. Its job (per-tier panel runs) is now
  `TIER=<t> ARMS=... run-config-ab.sh`; nothing rewritable remained.
- **`entrypoint.sh`: DELETED**: its claw alias-table (`/root/.claw/settings.json`)
  and BACKEND branch were claw-only; its per-cell timeout loop lives on inline in
  the driver (unchanged incantation). The test image now has a plain
  unit-suite CMD.

### Moved / modified

- **`lib/registry_emit.js` (new):** `writeAssertionResult` + `maybeEmitRegistryRow`
  extracted verbatim from claw.js — they are the runner-agnostic emit path the
  reporter and all arms use. Importers updated (`registry-reporter.js`,
  `scripts/opencode-smoke.mjs`). Row schema, sidecar fields (incl. historical
  `claw_exit` key) byte-identical.
- **`lib/runAgent.js`:** `runClaw` import + claw routing removed; `selectRunner`
  now throws for any non-opencode config ("claw-rig is historical … tag
  claw-stack-final"). Workspace pass oracle, slack math, diagnostics contract,
  `clawTimeoutMs` param name (panel API) untouched.
- **`lib/config.js`:** `claw-rig` kept in `VALID_CONFIGS` (registry schema enum
  unchanged — historical rows validate) but documented historical-only;
  `OPENCODE_CONFIGS` = the runnable set. `resolveConfigId` unchanged (unset →
  'claw-rig' label resolution; execution of it fails loud in selectRunner).
- **`Dockerfile`:** `COPY --from=claw-code:local` removed — decided the image
  stays as a **plain node toolchain** (`mac-llm-lab-test:local`): unit tests +
  the docs/data re-derivation incantation depend on it; nothing else replaces
  the claw binary. The `claw-code:local` docker image itself was NOT deleted
  from the daemon (backs the archive tag).
- **`docker-compose.yml`:** test service stripped of `env_file: ../litellm/.env`
  (deleted in #008 — compose would no longer even parse), bridge/ANTHROPIC env,
  BACKEND/TEST_SUITE. `runner` build service (#009) untouched.
- **`run-pattern.sh`:** litellm env-file requirement + entrypoint notes dropped.
- **`scripts/config-ab-pairing-check.mjs`:** claw-specific wording genericized
  (baseline is a parameter); logic untouched.
- **`lib/opencode.js`:** one functional fix — the docker-free `exec` test seam no
  longer derives spawn `cwd` from the (possibly non-existent) compose dir; the
  production compose path is unchanged. Found because the contract tests ENOENT'd
  in the rebuilt repo-mount-less test image.
- comment-level claw.js references scrubbed across lib/ + scripts/.

### Driver rewrite (`run-config-ab.sh`) — the #011 interface

`ARMS="<id> <id> …"` (runnable opencode CONFIG ids, default `opencode-a`) ×
`BASELINE=<config_id>` (default: first arm; may be any VALID config incl.
historical) + `TIER=64|16|32` (→ :11436 resident / :11437 / :11438 on-demand,
`opencode(.16|.32).json`), `SMOKE_TESTS`, `CONFIG_AB_REPEATS`,
`PER_TEST_TIMEOUT`, `REUSE_ROWS=1`+`REGISTRY_OUT` (append-to-existing mode,
replaces SKIP_PHASE_A), `RUNNER_IMAGE`. Gate runs per non-baseline arm with
explicit `--treatment <arm> --baseline $BASELINE`. ARMS/BASELINE validated
preflight against lib/config.js (single source of truth). Pruned: PHASE_SWAP
launchd dance, claw/bridge health preflights, `CLAW_MODEL_CONFIG_ID`,
`TEST_IMAGE` (gate now runs in the runner image), claw-restore EXIT-trap
semantics (cleanup = orphan reap + stop-oc-iff-started only; resident :11436
never touched). Fresh mode refuses a pre-existing REGISTRY_OUT (the old
split-file footgun is structurally dead — all arms + gate address one absolute
host path — but sweeps must not mix silently).

### Evidence

- **AC grep:** `grep -ri 'runClaw\|claw\.js' host/test/lib host/test/scripts` → rc=1 (no matches).
- **Unit tests:** 143 tests — runner image (live sources): 143 pass / 0 fail;
  rebuilt `mac-llm-lab-test:local` default CMD: 142 pass / 0 fail / 1 skip
  (pre-existing conditional skip: gitignored ws020 evidence DB absent in image).
  +2 new tests pin selectRunner's claw-rig/unset-CONFIG throw.
- **Demo sweep (tier-16):** `TIER=16 ARMS="opencode-a+git opencode-a+prompt"
  BASELINE=opencode-a+git SMOKE_TESTS=deep-equal run-config-ab.sh` → driver
  started :11437 itself, both arms PASS (+git workspace: `.git` only; +prompt:
  `.git`+`AGENTS.md` — arm seeding correct), 2 rows with correct per-arm
  `model_config_id` fingerprints (`…-opencode-a` / `…-opencode-prompt`), gate
  `treatment=opencode-a+prompt vs baseline=opencode-a+git` PASS (1 paired task,
  both sides bucketed), exit 0, cleanup stopped :11437 (post: :11437=000,
  :11436=200, no orphan containers). Registry:
  `.claw-runtime/run_registry.config-ab-20260610-182148.jsonl`.
- **Historical registries re-derived** (committed docs/data copies, rebuilt
  claw-free image, README commands verbatim): tier-64 final → RETIRE, +3.1pp
  [0.8, 6.3], wall 0.61×, claw-rig 256 rows bucketed (254 eligible, 2
  context_overflow drops — historical handling intact); sidecar-port canonical
  → −1.5pp [−6.4, 3.5], wall 0.85×. Both match the published numbers verbatim.
- **Docs:** README.md rewritten (opencode-native architecture, arm interface,
  analysis commands); driver header documents the full interface incl. #011
  tier-32 example. Remaining "claw" mentions in README/driver are
  historical/archive-tag references and the `.claw-runtime/` dir name
  (kept — it is the mount/registry path contract; labeled historical).

### Deviations / judgment calls

1. Scope: also deleted the claw-bridge suites + their three drivers and the two
   plist-swap sweep wrappers (not just the four files the ticket names) — they
   all execute the deleted claw/bridge/install stack and would have been broken
   checked-in code. `aggregate-results.sh`/`classify-failures.sh`/
   `harvest-runs-to-registry.mjs`/`explore-summarize.mjs` kept (offline parsers
   of preserved artifacts).
2. `lib/opencode.js` exec-seam cwd fix (above) — minimal, unit-suite-forced.
3. Inert `__tests__/tier-eval/*.test.js.skip` files still mention the old module
   in comments; left as-is (never executed, outside the AC grep scope).
4. `node --test <dir>` positional-dir args turned out unsupported in node 24
   (silent CJS-load failure) — Dockerfile CMD / package.json use explicit globs.
5. Not committed (per instructions) — all changes staged.
