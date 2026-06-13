# Retract & reframe the "prompt is the moat" thesis across the doc record

**Type**: HITL (the corrected mechanism conclusion is a scientific claim in
the lab owner's voice — the exact sentence a staff-scientist reviewer presses
on; wording needs sign-off before it lands)

**Status:** 🔲 Not started

## Parent

[OPENCODE-PROMPT-HALVES-VERDICT.md](../host/test/docs/OPENCODE-PROMPT-HALVES-VERDICT.md)
(2026-06-12, G1 FAILED) — the falsification that triggers this retraction.
Grill-resolved 2026-06-13 (lab owner). Supersedes and absorbs the still-valid
items of [#022](022-decision-doc-framing-errata.md).

## What to build

One consistent correction pass over the doc record so it no longer asserts
the falsified *"prompt is the moat / harness loop ≈ 0"* claim. The prompt-halves
sweep ([OPENCODE-PROMPT-HALVES-VERDICT.md](../host/test/docs/OPENCODE-PROMPT-HALVES-VERDICT.md))
showed the tier-16 prompt effect did not replicate (+0.1pp [−3.4, +3.9]); the
cross-sweep diagnosis points at the harness refactor, not the prompt.

The correction follows two rules fixed in the grill:

1. **Confidence (Q2):** assert only the **negative** — the prompt is inert on
   the current harness (measured, paired) — and state the **positive**
   (harness-engineering-substitutes-for-capability) as a **leading hypothesis
   with its evidence tier named** (cross-sweep, screen-tier, refactor not
   isolated by a controlled re-run, which was declined). Do **not** assert
   "the harness is the moat" as fact.
2. **Mechanics (Q3):** operative docs corrected **in place**; historical
   **evidence docs get a dated erratum banner only, never a rewrite**. The
   VERDICT amendment is the single cross-link target.

Surfaces:
- **VERDICT amendment** (do first — it's the cross-link target): the
  assert-negative / hypothesize-harness claim. The lab owner drafts + signs
  the exact wording here or directly in the VERDICT amendment (no pre-drafted
  text survives).
- **In-place corrections:** MIGRATION-DECISION §1 "mechanism conclusion";
  research-salvage-next-tranche §"What changed" / thread 1 (the framing that
  steers the next tranche).
- **Dated erratum banners (no rewrite):** OPENCODE-SIDECAR-PORT-HANDOFF.md,
  OPENCODE-AB-FINAL-REPORT.md §1.1/§5, both per-tier verdicts.
- **Absorb #022's still-valid items:** MIGRATION-DECISION override paragraph
  names both margins (1.4pp post-hoc oc+prompt arm / 8.1pp pre-registered
  bare-oc arm); TIER16-VERDICT win-count erratum 5→4. Do **not** execute
  #022's AC3/AC4 (they propagate the dead claim) — invert them to the
  corrected mechanism instead.

Out of scope: `system-prompt.md` keep/remove (parked → prompt-removal); the
claw-era housekeeping (#034); any registry/verdict-number change (numbers
re-derive bit-for-bit and are untouched).

## Acceptance criteria

- [ ] VERDICT carries a dated amendment stating the prompt is inert (+0.1pp [−3.4, +3.9], measured) and harness-as-substitute as an explicitly screen-tier hypothesis; lab owner has approved the wording
- [ ] MIGRATION-DECISION §1 no longer asserts "prompt is the moat" or "harness loop ≈ 0"; it records the withdrawal + the corrected claim, cross-linked to the VERDICT amendment
- [ ] `grep -rniE "prompt is the moat|harness loop . 0|the moat" host/test/docs research` returns only (a) historical-evidence docs carrying a dated erratum banner or (b) this issue / the parent plan — no live operative assertion survives
- [ ] research-salvage-next-tranche thread 1 + "What changed" reframed off "prompt = the moat"
- [ ] Sidecar handoff, FINAL-REPORT §1.1/§5, and both tier verdicts each carry a one-line dated erratum pointing to the VERDICT amendment; `git diff` shows only **added** banner lines in those files (no claim rewrite)
- [ ] MIGRATION-DECISION override paragraph names both margins (1.4pp / 8.1pp) and which was pre-registered; TIER16-VERDICT carries the dated 5→4 win-count erratum
- [ ] #022 deleted (surviving content now lives in this issue's edits + git history)
- [ ] `git diff` for this issue touches only `.md` files

## Blocked by

None - can start immediately (disjoint doc surface from #034; both supersede #022/the audit on non-overlapping files)
