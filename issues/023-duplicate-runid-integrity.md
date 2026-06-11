# Duplicate run_id blindness: idempotent harvest + pairing-gate invariant + patch-all-matches

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), analysis-scripts findings 2, 3 (partial),
and 9. One concern across three scripts: nothing in the chain dedupes or
asserts on `run_id`, so duplicate rows silently inflate per-task N and
sail through every gate green.

## What to build

1. **Idempotent harvest.** `scripts/harvest-runs-to-registry.mjs`
   re-appends a row for every run on a re-run over the same
   `--runtime-root` — easy to trigger, since the script is not
   transactional and can exit 1 mid-stream after some rows already
   appended, inviting an operator retry. Read the target registry first
   and skip `run_id`s already present, reporting them as
   `skipped: already_in_registry`. Also: a non-numeric `--since` parses
   to NaN and silently disables the filter (harvests everything) —
   validate with `Number.isFinite` and exit 2.

2. **Duplicate-run_id invariant in the gate.**
   `scripts/config-ab-pairing-check.mjs` is the natural home for the
   invariant: a duplicated `run_id` within the (arm, baseline, tier)
   scope turns the check red, naming the run_id and line numbers.

3. **Patch all matches.** `scripts/patch-context-overflow.mjs` patches
   only the *last* line matching a `run_id`; if a duplicate ever exists,
   the earlier copy stays mis-typed as an eligible failure. Patch every
   matching line (the gate invariant makes duplicates loud, but the
   patcher should not depend on that).

Out of scope: locking the registry rewrite against concurrent emitters
(the driver is sequential; if multi-writer ever becomes real, file it
then — note it in the patch script's header as a single-writer
requirement).

## Acceptance criteria

- [x] Running harvest twice over the same runtime-root yields a registry with zero duplicate `run_id`s; second run reports the skips
- [x] Harvest with `--since notanumber` exits 2 with a message (does not harvest)
- [x] Pairing check over a fixture registry with a duplicated `run_id` exits non-zero naming it; over the committed canonical registries it stays green
- [x] Patch script over a fixture with two lines sharing a `run_id` rewrites both
- [x] New/extended tests under `__tests__/scripts/` cover all three behaviors; containerized suite green

## Blocked by

None - can start immediately
