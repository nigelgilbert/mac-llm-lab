# Tool-call telemetry threshold review (post-sprint N=8)

**Type**: HITL (threshold/exclusion rule changes sweep eligibility — lab owner reads the data and legislates, or closes as not-needed)

**Status:** 🔲 Not started

## Parent

Deferred half of the #010 decision (2026-06-10): instrument first,
legislate after data exists. See issues/010-layer-a-toolcall-gate.md
§Decision, point 3.

> **2026-06-11 — #010 landed; telemetry shape differs from the draft below.**
> Per the final decision restatement (issues/WORKLOG.md §Plan) registry rows
> now carry `tool_call_count` / `error_tool_call_count` /
> `truncated_tool_call_count` (nullable, promoted verbatim from the
> run_summary sidecar; no threshold anywhere). The naked-XML **leak counter**
> and `unmapped_tool_call_count` were NOT promoted to rows: leak detection is
> wire-level in the `opencode-server probe` battery (the admission gate,
> N=6/probe — every probe/install/wizard-51 seat now produces a leak
> observation), and unmapped stays sidecar-only. This review should therefore
> tally the three landed row fields (+ probe battery history for leaks); if
> the data argues for row-level leak/unmapped telemetry, file that promotion
> as the follow-up implementation issue this review already anticipates.
> `error_tool_call_count` on rows remains behavioral data, not a gate input —
> the caveat below stands.

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

- ~~#010 (instrumentation must land first)~~ ✅ landed 2026-06-11 (see note above for the landed field set)
- ~~First post-sprint N≥8 sweep~~ ✅ landed 2026-06-12 (prompt-halves sweep, tally below)

## Data — first post-#010 N≥8 sweep tally (2026-06-12, orchestrator)

Source: the prompt-halves sweep, 1024 rows = 4 arms × 32 tasks × N=8 at
tier-16, committed at
`host/test/docs/data/run_registry.prompt-halves-20260611.jsonl`
(harness `927b7d0`, `OPENCODE_SERVER_TIMINGS=1`). The three landed row
fields, tallied per arm (tier is 16 throughout; per-task split below):

| arm | rows | tool_call_count Σ | error_tool_call_count Σ | truncated Σ | rows w/ ≥1 error | error rate |
|---|---|---|---|---|---|---|
| opencode-a+git | 256 | 3720 | 667 | 27 | 148 | 17.9% |
| opencode-a+prompt | 256 | 3348 | 619 | 29 | 141 | 18.5% |
| opencode-a+prompt-h1 | 256 | 3805 | 746 | 27 | 138 | 19.6% |
| opencode-a+prompt-h2 | 256 | 3988 | 734 | 32 | 137 | 18.4% |

- **Zero rows with null telemetry** (1024/1024 carry all three fields —
  the #010 promotion is fully flowing on opencode arms).
- **Per-task concentration** (error Σ across arms / task call volume):
  expression-eval 320 (28.3% of 1130), book-store 255 (28.8%), csv-parser
  238 (35.9%), wordy 223 (22.8%), two-bucket 205 (24.6%) — the same hard
  long-horizon tasks that dominate timeouts; easy tasks sit far lower.
- **Context for the decision:** `error_tool_call_count` is *execution*
  errors (historical norm ~18.3% of calls) — all four arms sit at
  17.9–19.6%, i.e. AT the historical norm, arm-independent. These are NOT
  parse errors. The parse-specific signals stayed where #010 put them:
  leak detection is wire-level in the probe battery (every
  probe/install/wizard-51 seat since T4 has been 6/6 parsed, 0 leaks), and
  unmapped remains sidecar-only (the 2026-06-10 record was 0 unmapped over
  13,569 calls).
- Truncated counts (27–32/arm) track censored/timeout runs, as designed.

**Decision: PENDING — lab owner (HITL).** The data shape matches the
issue's "parse errors ≈ 0" branch (no run-time gate needed; keep the
counters as a monitored invariant; close), but per the issue type that
call is legislated by the lab owner, not the orchestrator.
