# OpenCode transcript adapter

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4

## What to build

Normalize OpenCode's session log (format from #020) into the existing iteration
schema so iteration/token counts become cross-config comparable. Include a tool-name →
workspace-mutation map for OpenCode's tool set (the analog of claw's
`WORKSPACE_CHANGED_BY_TOOL`). Post-v1: the outcome-only pipeline already produces
pass-rate/wall-clock without this; the adapter adds the secondary parity metrics.

## Acceptance criteria

- [ ] Adapter reads an OpenCode session log and emits records in the existing iteration schema
- [ ] Iteration count and token counts (if reported) are populated per run
- [ ] A tool→workspace-mutation map covers OpenCode's tool set (mirrors `WORKSPACE_CHANGED_BY_TOOL`)
- [ ] Unmapped/unknown tools degrade gracefully (recorded, not crashing) and are flagged

## Blocked by

- #020
