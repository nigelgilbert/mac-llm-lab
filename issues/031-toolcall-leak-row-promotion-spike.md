# Spike: can tool-call leaks be detected per-run, for row-level promotion?

**Type**: AFK (a time-boxed investigation that ends in a written
feasibility verdict + a sized follow-up recommendation; no human decision
needed to *run* it — though a "wire-capture required" outcome escalates to
a HITL design call, which is out of scope here)

**Status:** 🔲 Not started

## Parent

The **visibility** half of the former #018 (tool-call telemetry threshold
review). #018 **closed no-gate 2026-06-12** (lab owner; ticket deleted per
the housekeeping convention — decision + tally in git history at `00b9587`
/ `aecb9aa`, recorded in
[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md)
§4). That closure settled the *gating* question — the
`tool_call_count` / `error_tool_call_count` / `truncated_tool_call_count`
counters stay observational, never an eligibility input. It is **orthogonal
to this ticket**: a no-gate posture is fully compatible with wanting to
*see* leaks, and right now we can't.

Today leaks are observed **only** in the `opencode-server` probe battery
(~6 synthetic calls at install/probe/wizard-51 seats); a naked-XML leak
inside a real sweep cell is invisible at the row level, and
`unmapped_tool_call_count` is computed but sidecar-only. The 2026-06-12
prompt-halves sweep pushed ~13.5k real tool calls under co-resident load
against those 6 idle-box probe calls — that traffic, not the probe, is
where a regression would actually surface. This spike resolves whether
closing that visibility gap is **cheap** (a nullable-field copy-up on the
#010 pattern) or **heavy** (new per-run capture) BEFORE any implementation
ticket is written. Promotion-pattern precedent: #010 (the three existing
nullable, non-gating row counters).

## Decisions (grill 2026-06-12, lab owner)

- **D1 — characterize BOTH leak definitions, don't pre-decide.** (a)
  *Persisted* leaks: naked-XML (`<tool_call>` / `<function=`) that reached
  the FINAL assistant content in the session DB — a malformed call that
  actually surfaced as text. (b) *Transient/streamed* leaks: naked-XML
  emitted mid-stream even if the model self-corrected before persistence.
  The spike characterizes each and recommends; it does not assume the
  persisted-only definition.
- **D2 — half-day (~4h) ceiling, persisted-first, report regardless.**
  Characterize the persisted-only path FIRST (the likely cheap answer),
  then spend the remaining budget on the transient/streamed path. At the
  ceiling, report out even if the transient half is inconclusive — so a
  truncated spike still delivers the actionable persisted-only verdict +
  recommendation, with the transient half recorded as an explicit open
  item.
- **D3 — `unmapped_tool_call_count` rides along as a free rider.** Confirm
  it is a trivial sidecar copy-up only (no research budget spent on it);
  the eventual schema bump promotes both parse-side counters together for
  symmetric telemetry.

## What to build

A written feasibility verdict answering, **for each of the two leak
definitions in D1**: can the per-run normalization path detect naked-XML
tool-call leaks (a `<tool_call>` / `<function=` that did NOT parse into
`tool_calls[]`) on real sweep traffic — and if so, by what mechanism?

The load-bearing question for the *persisted* definition is whether
OpenCode's per-run session DB (as consumed by the transcript adapter,
`lib/opencode_transcript.js`) retains the **raw assistant text** a leak
detector needs to grep, or whether the assistant turn is already normalized
into parsed parts with the raw text discarded. The probe's existing
naked-XML detector (in the tool-call validator) is the reference for *what*
to detect; the spike is about *where* that detection can live per-run.

For the *transient/streamed* definition, **first check whether any existing
per-run capture already retains stream content** — e.g. the #002
`server-log.slice` or the `OPENCODE_SERVER_TIMINGS` capture window — before
concluding new wire-capture plumbing is required. (The llama-server log
carries timings/overflow lines, not chat bodies, so it likely does not
help — but verify rather than assume; a cheap reuse would collapse the
heavy branch.)

Investigate against a **real preserved artifact** — at minimum the
leak-probe session DB R2 retained at
`client/opencode/.opencode-runtime/grep-probe-20260611/opencode.db`
(`OPENCODE_KEEP_DATA=1`); capture a fresh `OPENCODE_KEEP_DATA=1` cell if a
cleaner case is needed (#015 prunes opencode-data after successful
normalization, so default runDirs from the halves sweep are gone). A
contrived session DB containing a known naked `<tool_call>` that did not
parse is fair game to prove the detector fires.

Deliver a recommendation that **sizes the promotion follow-up per
definition**:

1. **Persisted → cheap copy-up (AFK):** if the per-run transcript already
   exposes the raw text, a small nullable-field schema bump on the #010
   pattern (one PR) promotes a per-row leak count; `unmapped` rides the
   same bump (D3). File and link that implementation issue.
2. **Transient → per-run wire capture (likely HITL design):** if no
   existing capture retains stream content, a row-level transient-leak
   count needs new plumbing — a heavier design decision, NOT a "simple
   fix". Name it, do NOT author it.

State the **telemetry-only contract** the eventual promotion must honor, up
front: any promoted field is a **nullable integer, additive, NOT in
`isEligible`, NOT a gate input** — every committed registry re-validates and
every published CI re-derives byte-identical (the #010/#024 contract, and
consistent with #018's no-gate close). This spike changes nothing in the
schema or scripts; it only produces the verdict + recommendation.

## Acceptance criteria

- [ ] Verdict (in this issue or a linked memo) covers BOTH D1 definitions; the persisted-only path is characterized FIRST and is reportable standalone; the transient/streamed path is characterized within the ~half-day box OR recorded as an explicit open item if the ceiling hits first
- [ ] For persisted: states whether the per-run session DB exposes raw assistant text sufficient to detect naked-XML, naming the concrete artifact field/table inspected as evidence
- [ ] Detector demonstrated against ≥1 real session DB: a command/script that, pointed at a runDir's persisted artifact, reports a leak count — shown firing on a known/contrived persisted-leak case AND returning 0 on a clean run
- [ ] For transient: states whether any EXISTING per-run capture (#002 `server-log.slice` / `OPENCODE_SERVER_TIMINGS` window) retains stream content, before recommending new wire-capture plumbing
- [ ] `unmapped_tool_call_count` confirmed sidecar-available (a trivial copy-up that rides the same schema bump) or noted otherwise, with evidence
- [ ] Follow-up classified per definition — persisted → cheap copy-up (AFK, next issue filed + linked); transient → per-run wire capture (HITL design, named NOT authored) — each with the telemetry-only (nullable / isEligible-neutral) contract stated
- [ ] No production change: schema, verdict/pairing scripts, and committed registries untouched (diff is the issue/memo + any throwaway probe artifacts under gitignored runtime roots)

## Blocked by

None - can start immediately (read-only against existing/preserved run
artifacts; at most one cheap `OPENCODE_KEEP_DATA=1` probe cell, resident
:11436 read-only under the lock per the standing protocol).
