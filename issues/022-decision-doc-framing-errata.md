# Evidence-doc errata: override framing (1.4pp vs 8.1pp), tier-16 win count, grammar attribution

**Type**: HITL (the override paragraph is a scientific claim in the lab owner's voice — wording needs their sign-off, and it is the sentence a staff-scientist reviewer will press on)

**Status:** 🔲 Not started

## Parent

PR #6 review (2026-06-11), docs/data-consistency findings 1–3. All
published numbers reproduce bit-for-bit from the committed registries;
these are framing/staleness defects in the prose, not data problems.

## What to build

Three corrections, all prose-only, no data or code changes:

1. **Override framing (the important one).**
   `host/test/docs/OPENCODE-MIGRATION-DECISION.md` (~line 34) and the PR
   body say the "pre-registered §0a.1 rule was narrowly NOT MET (by
   1.4pp)". The 1.4pp miss belongs to `opencode-a+prompt` — an arm
   designed *after* the tier-16 verdict (the handoff pre-registered the
   opposite expectation for it). The pre-registered comparison (bare
   `opencode-a`) missed the margin by 8.1pp. Both numbers are in the
   decision table, so nothing is hidden — but the override paragraph read
   alone implies the original pre-registered test nearly passed. Add one
   clause along the lines of: "the §0a.1 rule, applied to the post-hoc
   oc+prompt arm, was narrowly NOT MET (by 1.4pp); the pre-registered
   bare-oc arm failed it decisively (by 8.1pp)." Mirror the fix in the PR
   body §4.

2. **Stale win count.** `OPENCODE-AB-TIER16-VERDICT.md` (~line 133) says
   "improved on 5"; the registry and the doc's own table show 4.
   FINAL-REPORT §4.2 already corrects this; the verdict doc needs an
   in-place dated erratum (precedent: the #002 semantics-change callout
   later in the same doc).

3. **Superseded grammar attribution.** `OPENCODE-AB-FINAL-REPORT.md`
   §1.1/§5 still attributes the tier-16 regression to "grammar +
   system-prompt" jointly. The handoff's native-tools-grammar finding and
   the sidecar decomposition supersede this (grammar null; prompt is the
   moat) — the DECISION doc has the corrected mechanism, the report does
   not. Feed the corrected wording back per the handoff's own instruction.
   While there: one-line "retired arm" notes in the docstrings of
   `opencode-grammar-active-probe.py` / `opencode-toolcall-probe.py`
   (both exist solely for the retired grammar arm).

Do not touch the committed registries, verdict numbers, or the
pre-registration (PLAN) doc.

## Acceptance criteria

- [ ] DECISION doc override paragraph names both margins (1.4pp post-hoc arm, 8.1pp pre-registered arm) and which one was pre-registered; lab owner has approved the wording
- [ ] PR #6 body §4 updated to match
- [ ] TIER16-VERDICT carries a dated erratum correcting 5→4 wins
- [ ] FINAL-REPORT §1.1/§5 grammar attribution matches the DECISION doc's mechanism conclusion
- [ ] Both probe scripts carry the retired-arm docstring note
- [ ] `git diff` for this issue touches only .md files and the two .py docstrings

## Blocked by

None - can start immediately
