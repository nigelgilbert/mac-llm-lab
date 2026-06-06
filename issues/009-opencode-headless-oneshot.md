# Headless `opencode run` one-shot

**Type**: HITL

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.1, §5

## What to build

Confirm OpenCode runs headlessly in the container as a one-shot: `opencode run
"<prompt>"` mutates the mounted `/workspace`, exits, and does **not** orphan its
client-server process. Document the observed **exit-code semantics** (what `opencode
run` returns on success vs. failure vs. partial) — this feeds the "crashed before
finishing" telemetry from #001 and the `runOpenCode` contract in #010.

HITL because exit-code and process-cleanup behavior are empirically unknown and need
human observation before they're trusted in automation.

## Acceptance criteria

- [ ] `opencode run "<prompt>"` against the wired container edits a mounted `/workspace` file end-to-end
- [ ] The process exits cleanly with no orphaned client/server process left in the container
- [ ] Exit-code semantics documented (success / failure / partial) for use by `runOpenCode`
- [ ] A reproducible one-shot invocation (prompt + expected workspace mutation) is recorded

## Blocked by

- #008
- #006
