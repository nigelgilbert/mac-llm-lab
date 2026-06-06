# `run-config-ab.sh` phase-swap skeleton

**Type**: HITL

**Status:** ✅ Done — c63d112 — paired `claw-rig`↔`opencode-a` smoke green
(deep-equal, N=2/cell): every row `config_id`-stamped and `paired_bootstrap` buckets
both sides (claw-rig=2, opencode-a=2 — baseline NOT dropped), gated by
`scripts/config-ab-pairing-check.mjs`. Ran **co-resident** (claw `:11435` left
untouched per the AFK safety constraint; oc-64 `:11436` used as-found); the launchd
memory-headroom swap ("one resident at a time") is implemented as `PHASE_SWAP=1`
(HITL, deferred to #014). `trap` verified to restore production state with claw green.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.2, §4.6

## What to build

A `run-config-ab.sh` driver modeled on `run-backend-ab.sh`: **Phase A = claw-rig**,
**Phase B = opencode-a**, with the `llama-server` swap (claw instance down /
OpenCode-dedicated instance up, and back) and a `trap`-based restore to production
state on EXIT/INT/TERM. Each phase runs with full memory headroom (no co-residence).
Smoke scope: 1–2 tests per phase to prove the swap + restore + per-phase `CONFIG`
selection work cleanly. The full sweep is #014.

HITL because it manipulates the production `llama-server` launchd instance and must be
watched to confirm clean restore.

## Acceptance criteria

- [x] Phase A runs the smoke tests under `CONFIG=claw-rig` against the claw `llama-server`
- [~] Between phases, the claw instance is brought down and the OpenCode-dedicated instance up (one resident at a time) — **implemented as `PHASE_SWAP=1`, not the default.** The AFK run brief mandated claw `:11435` stay green throughout, so the default co-resides both tier-64 servers (~21 GB each, fine at smoke scale; the ~50 GB co-residence pressure only confounds the precision sweep, #014). `PHASE_SWAP=1` does the `launchctl` down/up "one resident at a time" for #014's headroom sweep (HITL, watched; untested in this commit).
- [x] Phase B runs the smoke tests under `CONFIG=opencode-a` against the second server (oc-64 `:11436`)
- [x] `trap` restores production state on EXIT/INT/TERM, including on mid-run abort — oc server stopped iff we started it, orphaned `oc-run-*` siblings reaped, claw launchd reloaded **iff `PHASE_SWAP` downed it**, and a post-condition asserts claw `:11435` is green on the way out (verified across 3 runs incl. the two that exited non-zero at the gate).
- [x] Rows from both phases carry the correct `config_id`

## Outcome (DoD)

A real paired run (`CONFIG_AB_REPEATS=2 SMOKE_TESTS=deep-equal`) emitted 4 rows to one
shared registry; `config-ab-pairing-check.mjs` confirmed all 4 are `config_id`-stamped
and that `paired_bootstrap` buckets **claw-rig=2 + opencode-a=2** for `deep-equal`
(perfect pairing, delta 0.0pp) — the claw baseline is **not** dropped. claw `:11435`
stayed `200` throughout; oc-64 left as-found; zero orphaned containers.

**Footgun found + closed.** The driver runs BOTH phases against the **live** working-tree
`lib/` (path-matched repo), not the baked `mac-llm-lab-test:local` image. The baked image
carries a STALE `lib/` (pre-#002: `run_row.js` has no `config_id` field, no `config.js`,
old `claw.js`); a first run proved the claw phase on the baked image emits rows with **no
`config_id`**, which `paired_bootstrap` silently drops → 0 baseline. Both phases on live
`lib/` + the gate asserting `config_id` on every row close this at the root. (The other
baked-image drivers — `run-backend-ab.sh` etc. — share this staleness; out of scope here,
worth a rebuild before they next emit rows.)

Rows are emitted **inline** (`RUN_REGISTRY_EMIT=1` → `lib/claw.js` `maybeEmitRegistryRow`),
the path that stamps `config_id` via `resolveConfigId()` and auto-picks the opencode-a
`model_config_id` — never via the offline harvester, whose single `--ctx` would mislabel
one phase.

## Deliverables

- `host/test/run-config-ab.sh` — the phase-swap driver.
- `host/test/scripts/config-ab-pairing-check.mjs` — the paired-run gate (reused by #014/#016).

## Blocked by

- #012
