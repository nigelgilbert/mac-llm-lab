# Runner injection selector (`CONFIG` env)

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.3

## What to build

A process-level selector so `runAgent`'s `defaultRunner` resolves to `runClaw` or
`runOpenCode` based on an env var (e.g. `CONFIG=claw-rig` | `CONFIG=opencode-a`).
Test files stay byte-identical — they keep calling `runAgent` with the default
runner; only the resolved runner changes. This is the corrected injection mechanism
(not per-test-file `CONFIG` branching).

## Acceptance criteria

- [ ] `defaultRunner` resolves to `runClaw` or `runOpenCode` from a single env selector
- [ ] Default (unset) preserves current behavior (claw)
- [ ] No tier-eval test file is modified to switch configs
- [ ] The selected `config_id` is threaded into run context so rows are labeled (feeds #002)

## Blocked by

- #010
