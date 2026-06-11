# Layer-A tool-call health gate, opencode-native

**Type**: HITL → decision recorded 2026-06-10 (below); implementation is now AFK

**Status:** 🔲 Not started (unblocked — decision made)

## Decision (2026-06-10, lab owner)

**Measurement-first, designed fresh for opencode** (not a resurrection of
the bridge-era wrap-rate/`error_tool_call_count` shape):

1. **Admission gate = probe battery (wire-shape).** Extend
   `opencode-server probe` with N tool-demanding canned requests; pass =
   N/N responses carry structured `tool_calls`, zero naked-XML/content
   leaks. The probe is already the Layer-A admission instrument
   (system-not-first, closed think block) and already runs in `install`,
   wizard step 51, and is invocable as a driver preflight — so the gate
   inherits those seats for free. Catches the deterministic
   template/build regression (the catastrophic case) before compute.
2. **Row telemetry, NO threshold yet — parse-specific signals only.**
   Add a **naked-XML leak counter** to the transcript normalizer
   (tool-call syntax appearing in assistant *text* content — the parse
   failure mode invisible to all existing counters, since a leaked call
   never becomes a tool row), and promote it plus the existing
   `unmapped_tool_call_count` into the registry row. Do **NOT** promote
   `error_tool_call_count` as parse telemetry: per
   lib/opencode_transcript.js:283 it counts *execution* errors
   (status ≠ completed, bash exit ≠ 0) — failing tests/builds, i.e.
   normal agent behavior (18.3% of calls across the historical record).
   It stays in the sidecar as behavioral data.
3. **Threshold decision deferred to #018** — evaluated after the first
   N=8 post-sprint sweep generates leak/unmapped data.

Empirical basis (2026-06-10 audit of persisted sidecars):
- claw-era (host/test/.claw-runtime): 1,296 runs, 12,350 calls, 1.7%
  bridge-parse errors, 9% of runs — the failure class the old gate
  watched; not transferable to native tool_calls.
- opencode-era (client/opencode/.opencode-runtime): 1,300 runs,
  13,569 calls, **unmapped_tool_call_count = 0 across all of it** —
  no parse anomaly in any recorded sweep. But naked-XML leaks are
  invisible to these counters, so the record is reassuring, not
  conclusive → instrument the leak signal before legislating any
  threshold.

## Parent

PR #6 xhigh review (2026-06-10), finding 12/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

The migration deleted the "Never drop — Layer-A grammar-health gate"
(tool-discipline.test.js: wrap_rate ≥ 0.9 over 10 streamed calls, the
precondition for a model/config entering the core grid) along with bridge.js,
`wrapRateThreshold`, and claw.gbnf. What remains is manual-only
(validate-tool-calls.sh, opencode-toolcall-probe.py — invoked from nothing
but docs) plus `error_tool_call_count`, which stays in the run_summary
sidecar (absent from registry rows, thresholded nowhere).
OPENCODE-MIGRATION-DECISION.md §"no OpenCode counterpart yet" admits the gap.
Until it's closed, a template regression that breaks tool-call parsing ~30%
of the time surfaces only as a depressed pass rate, indistinguishable from
capability failure — the ambiguity Layer-A existed to prevent.

~~Decision required first~~ **Resolved — measurement-first variant of A+B;
see §Decision above** (probe battery as admission gate; parse-specific row
telemetry with the threshold deferred to #018). Original options kept for
the record:

- **Option A — serving-side battery as gate.** Wire validate-tool-calls.sh
  (or a trimmed N-call subset) into the places a serving config gets
  admitted: `opencode-server probe`/`install`, wizard step 51, and/or a
  driver preflight. Pass criterion: N/N parsed tool_calls, zero naked-XML
  leaks. Closest in spirit to the old wrap-rate probe.
- **Option B — registry-side threshold.** Promote `error_tool_call_count` /
  total tool calls into the registry row and have the verdict/pairing
  scripts flag (or exclude) sweeps whose parse-error rate crosses a
  threshold. Catches in-sweep regressions but only after the compute is
  spent.
- **A+B** is defensible: A as admission gate, B as drift telemetry.

Then implement the chosen gate with a pinned threshold and a place in the
standard workflow (not docs-only).

## Acceptance criteria

- [x] Decision (mechanism + where it runs; threshold explicitly deferred to #018) recorded in this issue (2026-06-10, §Decision)
- [ ] Decision recorded in the decision doc (close its §"no OpenCode counterpart yet" gap with a status line)
- [ ] The probe battery runs automatically in `opencode-server probe` (and therefore install / wizard step 51 / driver preflight) — demonstrable by running probe and seeing the tool-call verdict line
- [ ] A simulated parse-collapse (pointing the gate at a server with the wrong template) turns the probe red
- [ ] The healthy tier-64 resident and tier-16/32 configs pass the gate as-is
- [ ] Row telemetry: the naked-XML leak counter exists in the transcript normalizer with a fixture test (doctored leak fixture → count > 0), and leak + `unmapped_tool_call_count` appear on registry rows in a smoke sweep (zero on healthy serving)

## Blocked by

None - can start immediately (decision recorded 2026-06-10 — straight to implementation; #018 consumes the telemetry this lands)
