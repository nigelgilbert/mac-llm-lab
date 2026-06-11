# Layer-A tool-call health gate, opencode-native

**Type**: HITL → decision recorded 2026-06-10 (below); implementation is now AFK

**Status:** ✅ Complete (implemented 2026-06-11, T4 — see §Result; row-telemetry
shape follows the final decision restatement in issues/WORKLOG.md §Plan, see
§Result "Decision as implemented")

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
- [x] Decision recorded in the decision doc (close its §"no OpenCode counterpart yet" gap with a status line) — OPENCODE-MIGRATION-DECISION.md §4, dated 2026-06-11
- [x] The probe battery runs automatically in `opencode-server probe` (and therefore install / wizard step 51 / driver preflight) — demonstrable by running probe and seeing the tool-call verdict line (§Result AC3)
- [x] A simulated parse-collapse (pointing the gate at a server with the wrong template) turns the probe red (§Result AC4: prose AND leak stub shapes, exit 1)
- [x] The healthy tier-64 resident and tier-16/32 configs pass the gate as-is (§Result AC5: 6/6 each)
- [x] ~~Row telemetry: the naked-XML leak counter exists in the transcript normalizer with a fixture test (doctored leak fixture → count > 0), and leak + `unmapped_tool_call_count` appear on registry rows in a smoke sweep (zero on healthy serving)~~ **AMENDED by the final decision restatement (WORKLOG §Plan)**: row telemetry = pure promotion of the already-computed `tool_call_count` / `error_tool_call_count` / `truncated_tool_call_count` from the run_summary sidecar (nullable, no threshold); naked-XML leak detection is wire-level in the probe battery, not a normalizer counter (§Result "Decision as implemented" + AC6)

## Blocked by

None - can start immediately (decision recorded 2026-06-10 — straight to implementation; #018 consumes the telemetry this lands)

## Result (2026-06-11, T4)

### Decision as implemented

The implementation follows the **final decision restatement** recorded in
issues/WORKLOG.md §Plan ("#010 → measurement-first: probe battery in
`opencode-server probe` as the admission gate;
`error_tool_call_count`/`tool_call_count` promoted to registry rows with no
threshold; threshold deferred to #018") plus the #017 carry-forward
(`truncated_tool_call_count` promoted alongside — the censoring-aware
truncated≠error split is exactly what drift telemetry needs on censored runs).

Delta vs this file's §Decision point 2 (the earlier, more elaborate draft):
NO normalizer leak counter was added and `unmapped_tool_call_count` was NOT
promoted — naked-XML leak detection lives **wire-level in the probe battery**
(where a leak is actually observable per-response), and
lib/opencode_transcript.js was deliberately untouched this tranche. If #018's
first real data argues for row-level leak/unmapped telemetry, that promotion
is a follow-up scoped there. `error_tool_call_count` lands on rows as
**behavioral telemetry with no threshold and no gate role** — §Decision's
point about it counting execution errors (18.3% of calls historically) stands
and is restated in the schema field description.

### The gate as built

- **Mechanism**: `opencode-server probe` check 4 — live tool-call battery via
  `validate-tool-calls.sh` (#013 engine, contract intact: `REPEATS=1
  BASE=$BASE MODEL=$ALIAS`, final `RESULT:` line parsed unconditionally).
- **N = 6, pinned**: 3 tool-demanding prompts × REPEATS=1 × 2 modes
  (non-stream + stream — stream is the path OpenCode actually uses). Every
  distinct request shape exactly once. Rationale: the catastrophic case is a
  *deterministic* template/build regression; 6 shapes catch it, and the
  bridge-era N=10 bought flake-resistance the deterministic case doesn't
  need. `OPENCODE_PROBE_TOOLCALL_REPEATS` (validated ≥1, never 0) raises N
  for a driver preflight. **No skip knob by design** (no precedent in the
  launcher; this IS the admission gate).
- **Pass criterion**: N/N responses carry a parsed `tool_calls[]` with
  valid-JSON args, zero `<tool_call>`/`<function=` content leaks, both modes.
- **Verdict line**: `probe: tool-call battery 6/6 parsed, 0 leaks — PASS`
  (FAIL variant prints per-case diagnostics + keeps the battery log under
  /tmp/opencode-probe-battery.*).
- **Measured runtime** (idle server, 2026-06-11): 4.2 s (tier-64 resident),
  4.2 s (tier-16), 4.7 s (tier-32) per battery — tool-call emissions are
  short generations.
- **Seats**: `probe` (direct + driver preflight) · `install` (cmd_install now
  ends with the canonical probe — previously a bare install was unprobed;
  this makes the §Decision "inherits the install seat" claim true) · wizard
  step 51 (delegates to `opencode-server probe` since #011 — inheritance is
  automatic, no wizard edit). Known benign redundancy: a wizard install now
  runs the battery twice (once inside install, once in step 51's own probe
  call); ~5 s each. Flagged to #016 (owns the wizard call sites).

### Row telemetry as built

`run_row.js assembleRow` promotes from the run_summary sidecar (null when the
sidecar is absent or carries no counters — historical claw-rig rows,
outcome-only/degraded runs; 0 is preserved as 0):
`tool_call_count`, `error_tool_call_count`, `truncated_tool_call_count` —
all `["integer","null"], minimum 0`, **not required**, in
run_registry.schema.json. No exclusion rule, no verdict-script change
(#012's exported `isEligible` ignores them — contract-tested). W4 packet
builder consumes `truncated_tool_call_count` (the #017 carry-forward
one-liner, scripts/analysis/build-w4-packet.py).

### Per-AC evidence

- **AC2 (decision doc)**: OPENCODE-MIGRATION-DECISION.md §4 tool-discipline
  bullet now carries the dated CLOSED status pointing here and to #018.
- **AC3 (gate runs automatically)**: `OPENCODE_TIER=64 opencode-server probe`
  against the resident (:11436, under /tmp/oc-resident.lock.d) → 3 template
  PASSes + `probe: tool-call battery 6/6 parsed, 0 leaks — PASS`, exit 0,
  4.2 s; resident pid 31147 unchanged before/after.
- **AC4 (parse-collapse → red)**: stub server (#013 methodology,
  BaseHTTPRequestHandler on 127.0.0.1:18099, MODE env) satisfying probe
  checks 1-3 so the battery alone decides. MODE=prose → `0/6 parsed, 0 leaks
  — FAIL`, exit 1. MODE=leak (naked `<tool_call>/<function=` in content) →
  `0/6 parsed, 6 leaks — FAIL`, exit 1, per-case "XML LEAK" diagnostics.
  MODE=happy control → `6/6 parsed, 0 leaks — PASS`, exit 0.
- **AC5 (healthy tiers pass)**: tier-64 resident 6/6 (AC3); tier-16 booted
  on-demand → probe 6/6 PASS → stopped, :11437 quiet; tier-32 booted →
  probe 6/6 PASS → stopped, :11438 quiet (sequential; lab left as found —
  resident-only).
- **AC6 (row promotion)**: __tests__/lib/run-row-toolcall-telemetry.test.js
  (9 tests) pins: counters verbatim on a transcript-telemetry fixture (0
  preserved); censored truncated≠error split; pathological error count
  changes NOTHING (no threshold; `isEligible` true); null on outcome-only +
  claw-rig-shaped (no-sidecar) fixtures; historical row shape (keys absent)
  validates; explicit nulls validate; junk values rejected by schema, nulled
  by assembly. Suite: **290 tests / 289 pass / 1 skip / 0 fail** (T3 baseline
  281/280/1/0; +9 all here). Canonical registries under host/test/docs/data/
  re-validated under the extended schema: **2,048 rows, 0 invalid**.
- **Wizard step 51 inheritance**: wizard/steps/51-opencode-server.sh
  `step_51_probe()` runs `OPENCODE_TIER=$tier opencode-server probe`
  (both its already-healthy and post-install branches) — the battery rides
  in with no wizard change; the AC3 resident probe run is the
  step-51-equivalent live evidence. NOT re-verified via a full wizard
  install (would reinstall the resident). Stale wizard comment ("no tokens
  are generated") now inaccurate for the probe → flagged to #016.

Cross-reference: threshold evaluation on the first post-sprint N≥8 sweep's
row telemetry → issues/018-toolcall-telemetry-threshold-review.md.
