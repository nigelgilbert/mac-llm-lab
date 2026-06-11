# Driver row accountability: fold ARMS_RC into the exit code, rewire the expected-attempts diff

**Type**: AFK

**Status:** 🔲 Not started

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
