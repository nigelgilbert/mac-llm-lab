# Pin the Rule 0a.2 wall-clock median population (eligible-only vs all-rows)

**Type**: HITL (legislates which row population bears a pre-registered rule — lab owner reads the conventions and decides; cf. #018)

**Status:** 🔲 Not started

## Parent

PR #6 review (2026-06-11), analysis-scripts finding 4 (medium).

## What to build

`config-ab-verdict.mjs` computes the Rule 0a.2 decision ratio
(`treatMedian/baseMedian ≤ 1.5×`) over **all rows with timestamps**,
including `harness_error`/`interrupted` rows that the pass-rate limb
excludes — an asymmetry between the two limbs of the same rule. The plan
doc (OPENCODE-HARNESS-AB-PLAN.md §0a, "median wall-clock ≤ 1.5×") never
pins the population, and overflow `harness_error` rows are plausibly
near-budget long runs, so the two conventions can genuinely flip the
verdict — tier-16 claw had 17 such rows. The eligible-only median is
already computed and printed but is not rule-bearing.

Decide one of:

- **all-rows is rule-bearing** (wall-clock is an operational cost
  measure; harness errors still burn the clock), or
- **eligible-only is rule-bearing** (both limbs of 0a.2 should share a
  denominator population).

Then: record the decision as a dated amendment in the PLAN doc (it is a
clarification of an ambiguous pre-registration, not a retroactive rule
change — say so explicitly), make the verdict script's output label
which printed median bears the rule, and add one sensitivity line to the
tier-16 verdict doc if the chosen convention changes any committed
ratio (spot-check: the published 0.96×/0.85× figures).

Implementation is small enough to live in this issue once the decision
is made; no separate follow-up needed.

## Acceptance criteria

- [ ] Explicit decision recorded in this issue and as a dated amendment in OPENCODE-HARNESS-AB-PLAN.md §0a
- [ ] Verdict script output labels the rule-bearing median; the other population is printed as sensitivity
- [ ] Committed tier-16/64 ratios re-derived under the chosen convention; verdict docs annotated if any published ratio shifts, or a no-change note recorded here
- [ ] Containerized suite green (extend the verdict test if the output format changed)

## Blocked by

None - can start immediately (coordinate with #025: that issue must not change median populations; this one legislates them)
