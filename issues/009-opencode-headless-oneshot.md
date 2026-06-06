# Headless `opencode run` one-shot

**Type**: HITL

**Status:** ✅ Done — 2a4a886

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

- [x] `opencode run "<prompt>"` against the wired container edits a mounted `/workspace` file end-to-end
- [x] The process exits cleanly with no orphaned client/server process left in the container
- [x] Exit-code semantics documented (success / failure / partial) for use by `runOpenCode`
- [x] A reproducible one-shot invocation (prompt + expected workspace mutation) is recorded

**Done — see [`client/opencode/docs/HEADLESS-ONESHOT.md`](../client/opencode/docs/HEADLESS-ONESHOT.md).**
Headline: the one-shot works, exits 0, orphans nothing — but bootstrap's un-timed
**models.dev catalog fetch wedges `opencode run` silently at `format init`** until
black-holed (fix committed to `docker-compose.yml`). Exit codes are coarse (`0` ok /
`1` any pre-flight error / `130`,`143` on signal) and **absent on hang** (dead endpoint
mid-stream also hangs) → `runOpenCode` must use the workspace-only oracle + its own
`timeoutMs` kill.

## Blocked by

- #008
- #006
