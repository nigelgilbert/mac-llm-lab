# config-ab-normalized-ci.mjs: overflow reclassification must be symmetric (or assert it can be one-sided)

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), analysis-scripts finding 1 (medium) + the
untested-published-number finding. This script renders two published
numbers (the −5.47pp normalized CI and the +0.78pp symmetric
non-inferiority call that partly justifies the tier-16 override).

## What to build

The script's "symmetric overflow scoring" reclassifies context-overflow
`harness_error` rows as eligible fails **only when
`r.config_id === BASELINE`**. That is correct for the frozen tier-16
dataset it was written against (OpenCode overflows there surfaced as
eligible `timeout`s — 0 oc `harness_error`, per the tier-16 verdict doc).
But post-#002 sweeps re-type *OpenCode* overflows to `harness_error` too
(that is what `patch-context-overflow.mjs` does), and the verdict doc's
2026-06-10 semantics-change note designates this script as the tool that
makes those sweeps comparable. Run on any such registry — including
oc-vs-oc mechanism comparisons — it converts only the baseline side's
overflows to fails while silently dropping the treatment side's, biasing
the "symmetric" sensitivity estimate toward the treatment.

Fix: reclassify overflow `harness_error` rows on **both** sides
(drop the config_id condition), or — if one-sided is ever intentionally
wanted — keep it only behind an explicit flag and otherwise assert the
treatment side has zero overflow `harness_error` rows, exiting non-zero
with a message naming the count when it doesn't.

While in the file, bring it to parity with its sibling renderers
(`config-ab-verdict.mjs` / `config-ab-pairing-check.mjs`): validate
`--treatment`/`--baseline` against VALID_CONFIGS, require
treatment ≠ baseline, and catch PairedBootstrapError into a structured
FAIL instead of a raw stack trace.

The script currently has no tests. Add a test file under
`__tests__/scripts/` with small fixture registries covering: (a) the
frozen-dataset shape (baseline-side overflow `harness_error` only) —
must keep reproducing the committed −5.47pp behavior class, (b) a
post-#002 shape with overflow `harness_error` on BOTH sides — both must
enter the denominators as fails, (c) the arg-validation failures.

## Acceptance criteria

- [x] On the committed tier-16 registries, the script's output is numerically unchanged (still −5.47pp [−10.94, +0.00] per docs/data/README.md repro command)
- [x] Fixture registry with treatment-side overflow `harness_error` rows: those rows enter the treatment denominator as fails (or, if the assert route was chosen, the script exits non-zero naming them)
- [x] Typo'd `--treatment` exits non-zero with the VALID_CONFIGS message, not a stack trace
- [x] New `__tests__/scripts/config-ab-normalized-ci.test.js` green in the containerized suite; suite total strictly increases

## Blocked by

None - can start immediately
