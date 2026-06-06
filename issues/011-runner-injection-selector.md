# Runner injection selector (`CONFIG` env)

**Type**: AFK

**Status:** ✅ Done — selector + cross-container `/workspace` sharing landed; full
lib suite green (103/103) + live cross-container round-trip passes against oc-64.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.3

## What to build

A process-level selector so `runAgent`'s `defaultRunner` resolves to `runClaw` or
`runOpenCode` based on an env var (e.g. `CONFIG=claw-rig` | `CONFIG=opencode-a`).
Test files stay byte-identical — they keep calling `runAgent` with the default
runner; only the resolved runner changes. This is the corrected injection mechanism
(not per-test-file `CONFIG` branching).

## Acceptance criteria

- [x] `defaultRunner` resolves to `runClaw` or `runOpenCode` from a single env selector
  — `CONFIG` env via [`selectRunner`](../host/test/lib/runAgent.js) + [`lib/config.js`](../host/test/lib/config.js).
- [x] Default (unset) preserves current behavior (claw-rig) — `resolveConfigId` defaults
  to `claw-rig`; verified the emit path still labels `claw-rig` and still skips when
  `RUN_REGISTRY_MODEL_CONFIG_ID` is absent.
- [x] No tier-eval test file is modified to switch configs — selection is process-level;
  test files stay byte-identical (zero `__tests__/tier-eval/` files touched).
- [x] The selected `config_id` is threaded into run context so rows are labeled (feeds #002)
  — `maybeEmitRegistryRow` ([lib/claw.js](../host/test/lib/claw.js)) stamps
  `config_id = resolveConfigId()` and auto-picks the tier's opencode-a `model_config_id`
  from the manifest (t64 / t16). Proven end-to-end: an opencode-a emit lands
  `config_id=opencode-a` + `model_config_id=…-opencode-a`.
- [x] **(workspace)** A harness-seeded file is visible to the opencode sibling and an
  agent-written file is visible to the post-script oracle — proven by a live
  cross-container round-trip ([scripts/opencode-workspace-roundtrip.mjs](../host/test/scripts/opencode-workspace-roundtrip.mjs)),
  not by inspection. The mount contract #013 must honor is in
  [OPENCODE-WORKSPACE-CONTRACT.md](../host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md).

## Implementation

- **Selector** ([lib/config.js](../host/test/lib/config.js)): one env `CONFIG`
  (`claw-rig` | `opencode-a`, unset = `claw-rig`) is the single source of truth for both
  the runner AND the registry `config_id` — the value *is* the `config_id`, so a row can
  never disagree with the runner that produced it. `selectRunner` ([lib/runAgent.js](../host/test/lib/runAgent.js))
  resolves `defaultRunner` → `runClaw` vs `runOpenCode`.
- **`/workspace` sharing**: with `CONFIG=opencode-a`, `selectRunner` reads `HOST_WORKSPACE`
  (the host path backing the test container's `/workspace`) and passes it to
  `runOpenCode({ workspaceDir })`, so the sibling bind-mounts the **same host dir**.
  reset/seed/post-script keep using the container path `/workspace`. Unset `HOST_WORKSPACE`
  under opencode-a **throws** (no silent false-fail). Contract for #013:
  [OPENCODE-WORKSPACE-CONTRACT.md](../host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md).

## Evidence

- Unit: [config-selector.test.js](../host/test/__tests__/lib/config-selector.test.js)
  (resolveConfigId mapping, per-tier model_config_id + manifest drift guard, selectRunner
  routing/throw). Full lib suite 103/103 green (was 89; +14).
- Live: cross-container round-trip PASS against oc-64 (:11436), zero orphaned containers,
  claw :11435 untouched.

## Blocked by

- #010 (met)

## Out of scope (deferred)

- The phase-swap driver `run-config-ab.sh` — #013 (this ticket only *defines* the mount contract).
- Server-timings wiring — reassigned to #021. Transcript adapter — #021.
