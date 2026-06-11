# Tool-call telemetry threshold review (post-sprint N=8)

**Type**: HITL (threshold/exclusion rule changes sweep eligibility — lab owner reads the data and legislates, or closes as not-needed)

**Status:** 🔲 Not started

## Parent

Deferred half of the #010 decision (2026-06-10): instrument first,
legislate after data exists. See issues/010-layer-a-toolcall-gate.md
§Decision, point 3.

## What to build

Nothing until the data exists. After #010's instrumentation lands and the
first post-sprint sweep at N≥8 completes (any tier, ≥8 cells per arm),
evaluate the opencode-era tool-call parse-error telemetry now carried on
registry rows:

- tally the parse-specific row telemetry #010 adds — the naked-XML
  **leak counter** and `unmapped_tool_call_count` — across the sweep's
  rows (and any other sweeps accumulated since #010), split by tier,
  task, and arm. (`error_tool_call_count` is *execution* errors — normal
  agent behavior, 18.3% of calls historically — and is NOT a gate input;
  see #010's decision record.)
- context for scale: claw-era bridge-parse errors were 1.7% of calls /
  9% of runs; the opencode-era record (1,300 runs / 13,569 calls as of
  2026-06-10) shows zero unmapped calls but had no leak instrumentation
  — this issue evaluates the first data that can actually see leaks,
- decide one of:
  - **parse errors ≈ 0** → no run-time gate needed; record the finding,
    keep the counters as a monitored invariant, close,
  - **parse errors > 0** → set the threshold/exclusion rule in the
    verdict/pairing scripts from the observed distribution (file the
    implementation as a follow-up AFK issue), and decide whether affected
    historical oc rows need a doc note.

## Acceptance criteria

- [ ] ≥1 post-#010 sweep at N≥8 tallied; per-tier/per-arm parse-error table recorded in this issue
- [ ] Explicit decision recorded: no-gate (with rationale) OR threshold chosen (with the observed distribution that justifies it)
- [ ] If threshold chosen: follow-up implementation issue filed and linked here
- [ ] Decision doc's Layer-A section updated with the outcome (one status line)

## Blocked by

- #010 (instrumentation must land first)
- First post-sprint N≥8 sweep (any planned A/B counts; do not run a sweep solely for this)
