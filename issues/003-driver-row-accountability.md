# Driver row accountability: fold ARMS_RC into the exit code, rewire the expected-attempts diff

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), findings 4/15 and 5/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

Two coupled gaps make `run-config-ab.sh` able to lie green after losing work:

1. **Exit code.** The driver records arm sub-phase failures in `ARMS_RC` but
   finishes with `exit "$GATE_RC"` alone. Under `REUSE_ROWS=1` the pairing
   gate passes on pre-existing rows (it reads the whole registry with no
   fresh-row watermark), so a sweep whose arms all wedged still exits 0 with
   only an `(arms rc=1)` log parenthetical. Fold ARMS_RC into the exit
   status: nonzero arms → nonzero exit, gate result second.

2. **Observed-vs-planned audit.** The old `run-overnight-screen.sh` wrote an
   expected-attempts manifest and ran `scripts/expected-attempts.mjs diff`
   after every sweep; the generalized driver (migration-suite #010 rewrite —
   not this suite's #010) never invokes it (the script survives
   with zero callers), while comments in registry-reporter.js, runAgent.js,
   and opencode.js still cite that diff as the backstop for their known
   row-loss windows (reporter SIGTERM window, missing runDir, sidecar
   hiccup). Re-wire the plan/diff into the driver's gate phase: write the
   plan (TASKS × REPEATS × ARMS) before the arms phase, diff observed rows
   after, and make a shortfall turn the sweep red (or, under REUSE_ROWS,
   diff only the fresh rows — e.g. registry line-count watermark taken at
   start).

## Acceptance criteria

- [ ] A sweep whose arm sub-phase exits nonzero (e.g. forced toolchain-assert failure) exits nonzero even when the pairing gate passes on reused rows
- [ ] A sweep that loses k rows of one arm (simulate by deleting a row before the gate, or a forced emit failure) exits nonzero and names the missing (task, config, rep) cells
- [ ] The stale comments in registry-reporter.js / runAgent.js / opencode.js citing the dead backstop are updated to point at the live mechanism
- [ ] A clean smoke sweep (e.g. `SMOKE_TESTS="deep-equal wordy" CONFIG_AB_REPEATS=1`) still exits 0

## Blocked by

None - can start immediately (coordinate with #004 — same file)

## Result

Implemented in `host/test/run-config-ab.sh` + `host/test/scripts/expected-attempts.mjs`
(2026-06-10, tranche 2).

- **Exit code.** The driver now ends with explicit precedence instead of
  `exit $GATE_RC`: arms failure → exit 1, row shortfall (expected-attempts
  diff) → exit 2, gate failure → exit 3, else 0. The gate's
  empty-registry case no longer `err()`s mid-script (it would have masked the
  arms/audit verdicts); it sets GATE_RC=1 and falls through to the combined
  exit.
- **Audit wiring.** `expected-attempts.mjs` gained the config (arm) dimension
  — 4-column CSV `test_id,hardware_tier,config_id,rep_index`, `plan
  --configs`, diff keyed on the full tuple — and `diff --since-line <n>` (the
  REUSE_ROWS fresh-row watermark). The driver writes the plan
  (TASKS × REPEATS × ARMS) in preflight (before any server/arm), snapshots
  the registry line count, and diffs post-gate with `--since-line
  $REG_WATERMARK`, so under REUSE_ROWS only this sweep's fresh rows are
  audited. The plan write doubles as a stem preflight (unknown / Family C
  stems die pre-server).

Per-AC evidence (real command output, 2026-06-10):

- [x] **Arms-failure under REUSE_ROWS=1 with passing gate → nonzero**:
  `REUSE_ROWS=1 REGISTRY_OUT=<prior smoke registry> SMOKE_TESTS=wordy
  PER_TEST_TIMEOUT=10 ./run-config-ab.sh` → log tail
  `(arms rc=1, audit rc=1, gate rc=0)`, **EXIT=1** (gate passed on the
  pre-existing rows; pre-fix this exited 0).
- [x] **Lost rows named**: same run printed `missing: 1 cells` /
  `wordy config=opencode-a tier=64 rep=1`. Deleted-row variant: removing one
  line from a complete 2-row registry and running the driver's exact diff
  command → **EXIT=1**, `deep-equal config=opencode-a tier=64 rep=1`.
- [x] **Stale comments updated** to cite the live driver-wired audit:
  `lib/registry-reporter.js` (SIGTERM-window tradeoff note),
  `lib/runAgent.js` (reporter-unwired backstop note + missing-runDir note),
  `lib/opencode.js` (writeSidecar docstring).
- [x] **Clean smoke exits 0**: `SMOKE_TESTS="deep-equal wordy"
  CONFIG_AB_REPEATS=1 ./run-config-ab.sh` → `expected: 2 cells / observed:
  2 rows / missing: 0`, `(arms rc=0, audit rc=0, gate rc=0)`, **EXIT=0**.

Unit coverage: `__tests__/scripts/expected-attempts.test.js` pins the
4-column plan, missing-cell naming, per-config scoping (a missing arm cannot
be half-credited from the present arm's rows), the `--since-line` watermark
(and that REUSE_ROWS *without* it over-counts), and missing-registry =
all-missing.
