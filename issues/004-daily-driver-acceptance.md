# Daily-driver acceptance: do a real piece of work with `oc`

**Type**: HITL (only the user can perform and judge real work — this is the tracer bullet's exit criterion)

**Status:** ✅ Passed (GO — 2026-06-10)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.1, §3.2.

## What to build

Nothing — use it. Complete at least one genuine task in a real repo through
`oc` (a bugfix, a script, a refactor: work you would otherwise have done
another way). Note frictions as they occur; file follow-up issues for
anything that blocks the "I reach for this" bar. This issue is the gate on
the gut (#008): claw stays bootable until this passes.

## Acceptance criteria

- [x] One real task completed end-to-end via `oc` (link the resulting commit/diff/artifact)
- [x] Friction list captured (may be empty) and follow-up issues filed for any blocker-grade items
- [x] Explicit go/no-go recorded for proceeding to #008

## Result — GO (2026-06-10)

Manual HITL session (user hands-on-keyboard); full step-by-step in
[004-acceptance-log.md](004-acceptance-log.md).

Four daily-driver exercises from a throwaway git repo (`~/Desktop/bench/oc-toy`),
tier 64 / resident `:11436` daemon, both invocation paths:

- **`oc run` greenfield** — wrote `hello.py`, self-corrected `python`→`python3`,
  verified output. Runs on host.
- **`oc` TUI** — `is_prime` + `unittest` conversationally; user verdict
  **"works well"**; 4/4 tests green on host.
- **`oc run` bugfix** (the canonical real-work loop) — planted an unreachable
  FizzBuzz `% 15` branch; agent read both files, ran tests (red), gave the
  **correct** root cause, applied a most-specific-first reorder (not a paper-over),
  re-ran → 4/4 green.
- **Artifact:** `oc-toy` commit **`8d58ca8`** — agent-authored fix + tasks.

**Friction:** no blocker-grade items, so no follow-up issues filed. Nits only:
container has `python3` but no `python` alias (agent routed around it every time —
optional Dockerfile polish); `__pycache__` committed in the toy repo (no
`.gitignore`, not an `oc` concern). Wins: preflight `oc status` surfaced
server+prompt health; workspace mount round-trips both ways; host artifacts owned
`nigel:staff` (no root-owned files despite root-in-container).

**Decision:** **GO** — `oc` clears the "I reach for this" bar. claw is no longer
needed on life support; **#008 (gut claw) is unblocked.**

## Blocked by

- #003 ✅
