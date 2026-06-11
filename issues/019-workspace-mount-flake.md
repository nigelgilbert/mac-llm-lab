# Workspace mount flake: write-probe canary + signature-gated cell retry

**Type**: AFK

**Status:** 🔲 Not started

## Parent

Discovered during the PR #6 remediation campaign (2026-06-10/11) — not a
review finding. Evidence: issues/WORKLOG.md (T2 boundary "virtiofs saga" +
carry-forwards; T3/T5 boundary smokes), the #003 driver agent's observation
(2 of 6 live sweeps), and the orchestrator's boundary runs (~3 of 10).
Same OrbStack share-degradation family as the virtiofs log freeze
(memory: orbstack-virtiofs-freeze; docs/OPENCODE-SERVER-TIMINGS.md
"capture ladder" section) — the log side is fully mitigated; this is the
remaining unmitigated manifestation.

## What to build

Under co-resident load, ~30-50% of sweeps lose a cell to an instant
`Error: ENOENT ... open '/workspace/<seed-file>'` during workspace seeding
(runAgent reset/seed inside the eval-runner), despite the runner
preflight's `[ -d /workspace ]` passing — OrbStack's file-share serves a
stale handle for the bind. The driver already avoids churning H's inode
(emptied in place, run-config-ab.sh ~"shared workspace H" comment), and
since #003 the row audit names the lost cell and reddens the sweep — loud,
but recovery is a manual re-run of the whole sweep.

Two-layer mitigation in `host/test/run-config-ab.sh` (runner preflight +
cell loop; both run inside the eval-runner's `sh -c`):

1. **Write-probe canary.** Strengthen the `/workspace` preflight from a
   bare `-d` test to touch + read-back + rm of a sentinel file through the
   mount, with a short bounded settle-and-retry (a few seconds) before
   declaring the mount dead. A dead mount fails the arm fast with the
   canary's message — never deep inside a cell.

2. **Signature-gated cell retry.** When a cell fails with the flake
   signature — seed-phase ENOENT under `/workspace` within seconds of cell
   start (define the detection conservatively; the cell's node output
   carries the `ENOENT ... /workspace/` line and the cell dies far below
   normal runtime) — re-run that cell ONCE, behind a loud
   `>>> cell <stem> RETRY (workspace mount flake)` marker. Genuine test
   failures (assertion failures, timeouts, nonzero cells without the
   signature) are NEVER retried. Surface a retried-cell count in the arm
   summary line. The #003 expected-attempts audit must stay exact: a
   successful retry yields exactly one row (verify no duplicate-emission
   window; the failed attempt emits nothing by definition of the flake).

The flake is nondeterministic, so the retry path needs a deterministic
exercise: an injection hook (e.g. an env knob that makes the first seed
attempt of a named cell fail with the same ENOENT shape, or a doctored
HOST_WORKSPACE that a helper un-breaks between attempts) — implementer's
choice, but the retry and the no-retry-on-real-failure branches must both
be demonstrated, not just code-read.

## Acceptance criteria

- [ ] A deliberately broken workspace mount (e.g. bogus HOST_WORKSPACE) fails the arm in preflight with the canary's message — no cell starts, no deep ENOENT
- [ ] Injected flake-signature failure on a cell: the driver retries once with the loud marker, the retry succeeds, the sweep exits 0, the audit shows no missing/duplicate cells, and the arm summary reports the retry count
- [ ] A forced genuine cell failure (failing assertion) is NOT retried (no retry marker; sweep red as today)
- [ ] A clean smoke sweep is byte-identical in behavior (no canary noise, zero retries reported)
- [ ] Soak evidence: ≥5 consecutive default sweeps under the resident lock complete without a manual re-run (retries permitted and counted), or the observed flake-rate window is documented if the flake never fires
- [ ] Runner-image suite green at current counts or higher

## Blocked by

None - can start immediately (touches only run-config-ab.sh's runner
preflight + cell loop; coordinate with nothing — campaign complete)
