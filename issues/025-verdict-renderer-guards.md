# Verdict renderer guards + golden-output tests for the published-number scripts

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 review (2026-06-11), analysis-scripts findings 5, 7 and the
test-coverage soft spot: the scripts that render published numbers
(`config-ab-verdict.mjs`, `config-ab-pairing-check.mjs`) have no
golden-output coverage, and two formatting holes can land garbage
verbatim in committed verdict docs.

## What to build

1. **Empty-array guard parity.** The iteration-parity section of
   `config-ab-verdict.mjs` misses the guard the wall-clock section got
   in #012: a side with no numeric `iters_count` rows prints
   `Infinity`/`-Infinity` from `Math.min/max(...[])` and `null` medians.
   Apply the same n=0 → "unavailable" treatment.

2. **NaN durations.** `durationS` returns NaN (not null) for malformed
   timestamps and the `!= null` filter admits it, poisoning
   median/p90/max. Filter with `Number.isFinite`.

3. **Golden-output tests.** Add tests that run the verdict and
   pairing-check renderers over small committed fixture registries and
   assert the rendered output (or its parsed key numbers: delta, CI
   bounds, verdict line, gate result) exactly. Include degenerate
   fixtures: a side with no timestamps (existing fixtures cover some of
   this), a side with no iters_count, malformed timestamps. The seeded
   bootstrap makes exact assertions safe. If #021 has landed, extend the
   golden coverage to `config-ab-normalized-ci.mjs`'s renderer too;
   if not, skip it there (don't pre-encode the asymmetric semantics in
   a golden file).

Out of scope: which population the Rule 0a.2 wall-clock median is
computed over — that is legislated in #026; this issue must not change
which rows feed the medians, only how degenerate values render.

## Acceptance criteria

- [ ] Fixture with zero numeric `iters_count` on one side renders "unavailable" (or equivalent), never `Infinity`
- [ ] Fixture with a malformed timestamp renders finite duration stats (the bad row excluded), never `NaN`
- [ ] Golden tests pin the headline render (delta, CI, verdict string) for verdict + pairing-check over fixtures; re-running on the committed canonical registries still reproduces the published numbers per docs/data/README.md
- [ ] Containerized suite green at strictly higher counts

## Blocked by

None - can start immediately (coordinate with #021 for normalized-ci goldens, #026 for median population — neither blocks the guards)
