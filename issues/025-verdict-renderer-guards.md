# Verdict renderer guards + golden-output tests for the published-number scripts

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

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

- [x] Fixture with zero numeric `iters_count` on one side renders "unavailable" (or equivalent), never `Infinity`
- [x] Fixture with a malformed timestamp renders finite duration stats (the bad row excluded), never `NaN`
- [x] Golden tests pin the headline render (delta, CI, verdict string) for verdict + pairing-check over fixtures; re-running on the committed canonical registries still reproduces the published numbers per docs/data/README.md
- [x] Containerized suite green at strictly higher counts

## Blocked by

None - can start immediately (coordinate with #021 for normalized-ci goldens, #026 for median population — neither blocks the guards)

## Result

Implemented 2026-06-11 (tranche T10, agent R3). Not committed (per task
instruction). #021 HAS landed, so the normalized-ci golden extension is in
scope and included. Surface:

- `host/test/scripts/config-ab-verdict.mjs` — the two render guards.
- `host/test/Dockerfile` — `COPY docs/data ./docs/data` (see deviation 1).
- `host/test/__tests__/scripts/config-ab-renderer-goldens.test.js` — new,
  22 tests (guards + fixture goldens + published-number goldens).
- `host/test/__tests__/scripts/fixtures/registry-{golden-small,no-treatment-iters,malformed-timestamps}.jsonl`
  — new committed fixtures (NOT canonical evidence; `docs/data/` untouched).

What was built:

1. **Iteration-parity n=0 guard** (mirrors #012's wall-clock treatment): a
   side with zero numeric `iters_count` rows now renders
   `iters_count unavailable (n=0 rows with numeric iters_count)` instead of
   `median null  min Infinity  max -Infinity  (n=0)`. The filter is
   `Number.isFinite(r.iters_count)` rather than `typeof === 'number'`, so a
   NaN-valued `iters_count` cannot poison the stats either (same degenerate
   class; a string value was already excluded and stays excluded).
2. **NaN-duration guard**: `durationS` returns NaN (not null) for a present
   but malformed timestamp; both wall-clock filters (`durAll`, `durElig`)
   changed from `(d) => d != null` to `Number.isFinite`. Bad ROWS are
   excluded from the duration stats; median/p90/max stay finite. Pre-fix the
   NaN even flipped Rule 0a.2 (`ratio NaN×  > 1.5×  →  NOT MET`).
   Out-of-scope boundary respected: which rows feed the Rule 0a.2 median
   (#026) is untouched — these guards only change how degenerate values
   render; pass-rate eligibility and population selection are unmodified.
3. **Golden-output tests** (exact-substring line pins, padding included, via
   the seeded bootstrap B=10000 / seed 0xc0ffee):
   - fixture goldens: verdict headline (per-task deltas, +16.7pp aggregate,
     CI [-16.7, 50.0]pp, margin NOT MET, ratio 0.50× MET, KEEP line) and
     pairing-check render (histogram, uniqueness, per-task deltas,
     `paired_bootstrap:` line, PASS line) over
     `registry-golden-small.jsonl`; degenerate goldens over the
     no-iters / malformed-timestamps fixtures (and the pre-existing
     no-timestamps fixtures keep covering the #012 case).
   - published-number goldens over the committed canonical registries (all
     six README numbers, incl. normalized-ci −5.47pp and +0.78pp with
     `--treatment opencode-a+prompt`). Tests READ `docs/data/`; nothing
     writes there.

Deviations, flagged loudly:

1. **Dockerfile touched** (not named in the issue, not on the out-of-scope
   list): the baked test image only copied `lib`/`scripts`/`__tests__`, so
   the published-number goldens could not see `docs/data/` inside the
   compose `test` service. Added `COPY docs/data ./docs/data` (~1.7 MB,
   read-only evidence baked alongside the scripts that re-derive from it).
   Alternative (skip-if-absent tests) rejected: it would silently hollow out
   the AC in exactly the environment the suite gates.
2. **Guard 1 slightly generalized**: the iteration-parity filter also drops
   NaN `iters_count` values (Number.isFinite), not just the empty-array
   case the issue names. Same degenerate-render class, zero behavior change
   on any row with a sane value.
3. New goldens use exact-substring assertions (`stdout.includes`) rather
   than the sibling files' escaped regexes — deliberate for goldens, so
   formatting drift (column padding) also reds the test.

Per-AC evidence (real command output, 2026-06-11; red shapes captured
pre-fix on the same fixtures, then fixed — red-then-green):

- [x] **AC1 (no Infinity)**: pre-fix
  `node scripts/config-ab-verdict.mjs __tests__/scripts/fixtures/registry-no-treatment-iters.jsonl --tier 64`
  rendered `opencode-a  median null  min Infinity  max -Infinity  (n=0)`.
  Post-fix: `opencode-a  iters_count unavailable (n=0 rows with numeric
  iters_count)`; baseline unchanged (`claw-rig    median 4.5  min 3  max 7
  (n=4)`); no `Infinity` anywhere in stdout; exit 0.
- [x] **AC2 (no NaN)**: pre-fix on `registry-malformed-timestamps.jsonl`:
  `claw-rig    median NaNs  p90 20.0s  max NaNs  (n=5 ...)`, `opencode-a
  median NaNs  p90 24.0s  max NaNs  (n=4 ...)`, `ratio ... NaN×  > 1.5×  →
  NOT MET`. Post-fix: `claw-rig    median 20.0s  p90 20.0s  max 20.0s
  (n=4; ...)` (bad start_time row excluded), `opencode-a  median 30.0s  p90
  30.0s  max 30.0s  (n=3; ...)` (bad end_time row excluded), `ratio
  (opencode-a median / claw-rig median): 1.50×  ≤ 1.5×  →  MET`; no `NaN`
  in stdout; exit 0.
- [x] **AC3 (goldens + published reproduction)**: 22/22 new tests green.
  All six README §"Re-deriving" commands re-run post-guards against the
  committed canonical registries — verbatim reproduction:
  - tier-64: `aggregate delta    : +3.1pp`, `90% paired-bootstrap CI: [0.8,
    6.3]pp`, `ratio ... 0.61×  ≤ 1.5×  →  MET`, `→ RETIRE the claw rig at
    this tier (opencode-a is superior on pass-rate AND faster)`
  - tier-16: `-7.7pp`, `[-13.1, -2.5]pp`, `0.96×`, `→ KEEP the claw rig at
    this tier`
  - tier-16 normalized: `canonical ... -7.74pp  90% CI [-13.06, -2.51]pp`,
    `normalized ... -5.47pp  90% CI [-10.94, 0.00]pp`
  - sidecar +prompt vs +git: `+6.6pp`, `[3.1, 10.2]pp`, SUPERIOR line
  - sidecar +prompt vs claw: `-1.5pp`, `[-6.4, 3.5]pp`, `0.85×`, KEEP
  - sidecar normalized: `+0.78pp  90% CI [-3.91, 5.86]pp`, `CI lower -3.9pp
    > −5pp  →  MET`
  Also re-derived from the BAKED image without a source mount (`docker run
  --rm -w /test --entrypoint node mac-llm-lab-test:local ...`) — identical,
  proving the docs/data COPY works.
- [x] **AC4 (suite strictly higher)**: `docker compose build test` (rebuilt
  from live sources first — the compose `test` service runs the BAKED
  image) then `docker compose run --rm test` →
  `tests 357 / suites 103 / pass 356 / fail 0 / cancelled 0 / skipped 1 /
  todo 0`, exit 0 — strictly above the 335/334/0-fail/1-skip floor (+22
  tests, all from this issue's file).

Registries under `docs/data/` byte-untouched (git status clean for that
path). No live servers used; docker only for the containerized suite.
