# `run-config-ab.sh` phase-swap skeleton

**Type**: HITL

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

- [ ] Phase A runs the smoke tests under `CONFIG=claw-rig` against the claw `llama-server`
- [ ] Between phases, the claw instance is brought down and the OpenCode-dedicated instance up (one resident at a time)
- [ ] Phase B runs the smoke tests under `CONFIG=opencode-a` against the second server
- [ ] `trap` restores production state (claw launchd reloaded, OpenCode server stopped) on EXIT/INT/TERM, including on mid-run abort
- [ ] Rows from both phases carry the correct `config_id`

## Blocked by

- #012
