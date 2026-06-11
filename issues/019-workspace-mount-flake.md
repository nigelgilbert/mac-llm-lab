# Workspace mount flake: write-probe canary + signature-gated cell retry

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

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

- [x] A deliberately broken workspace mount (e.g. bogus HOST_WORKSPACE) fails the arm in preflight with the canary's message — no cell starts, no deep ENOENT
- [x] Injected flake-signature failure on a cell: the driver retries once with the loud marker, the retry succeeds, the sweep exits 0, the audit shows no missing/duplicate cells, and the arm summary reports the retry count
- [x] A forced genuine cell failure (failing assertion) is NOT retried (no retry marker; sweep red as today)
- [x] A clean smoke sweep is byte-identical in behavior (no canary noise, zero retries reported)
- [x] Soak evidence: ≥5 consecutive default sweeps under the resident lock complete without a manual re-run (retries permitted and counted), or the observed flake-rate window is documented if the flake never fires
- [x] Runner-image suite green at current counts or higher

## Blocked by

None - can start immediately (touches only run-config-ab.sh's runner
preflight + cell loop; coordinate with nothing — campaign complete)

## Result

Implemented in `host/test/run-config-ab.sh` only (2026-06-11). Not committed
(per task instruction).

- **Write-probe canary** (runner preflight, inside the eval-runner `sh -c`):
  the bare `[ -d /workspace ]` is now touch + read-back + rm of
  `/workspace/.oc-ws-canary` through the mount, 3 tries with a 2s settle
  between them (~4s bound). Failure aborts the ARM with the canary's FATAL
  message and the same `exit 4` the old check used — pre-cell, never deep
  inside a cell.
- **Signature-gated cell retry** (cell loop): each attempt is tee-captured
  (streaming preserved; attempt rc rides an aux fd — busybox ash has no
  PIPESTATUS). Retry fires ONCE per cell iff ALL of: nonzero rc that is not
  the per-cell cap (124/137 never retried), death ≤ 20s after cell start
  (seed ENOENT is instant; the slimmest real cell runs an agent loop for
  minutes), output carries an `ENOENT ... /workspace` line, AND the attempt
  appended no registry row (`wc -l` of `RUN_REGISTRY_PATH` before/after —
  this closes the duplicate-emission window, so a successful retry yields
  exactly one row and the #003 audit stays exact; a flake-shaped failure
  that DID emit a row is loudly NOT retried). Marker:
  `>>> cell <stem> RETRY (workspace mount flake)`. The in-runner counter
  crosses back via a per-sweep handoff file
  (`.claw-runtime/.retry-count.<sweep-id>`, container-written/host-read —
  the safe direction under the OrbStack freeze) and is surfaced as
  `retried_cells=N` on the arm summary line.
- **Injection hooks** (TEST-ONLY env knobs, documented in the driver
  header): `OC_WS_FAULT_RO=1` binds /workspace read-only (canary
  demonstration); `OC_FLAKE_INJECT=<stem>` replaces the first attempt of
  the named cell (once per arm) with a REAL node ENOENT under /workspace;
  `OC_FLAKE_INJECT_GENUINE=<stem>` replaces the cell with a fast
  non-signature failure.

Spec deviations, flagged loudly:

1. **AC1 breakage shape**: the AC's example is "bogus HOST_WORKSPACE", but
   the mount source `H` is hardcoded by design (mount contract) and docker
   auto-creates a missing bind source, so a bogus path cannot express a
   broken mount. The injection binds /workspace **read-only** instead —
   exactly the present-but-unwritable shape the old `-d` check passed on.
   The canary demonstrably catches it.
2. **AC3 "failing assertion"**: tier-eval cells run a live model agent, so
   a deterministic real assertion failure isn't constructable; the genuine
   failure is injected (assertion-shaped output, no flake signature, no
   row). Consequence: the demo sweep reddens via the #003 audit naming the
   missing cell (a real assertion failure would emit a `passed=false` row
   and redden via arm rc instead). The demonstrated property — no retry
   marker, `retried_cells=0`, red sweep — is the AC's.
3. **Cell stderr is merged into stdout for the capture** (`2>&1` on the
   attempt) so the flake signature is caught on either stream. Byte
   CONTENT of cell output is unchanged; stream identity of rare node
   stderr lines (warnings) changes. The clean-sweep delta beyond that is
   exactly the spec-required reporting: `retried_cells=0` on the arm
   summary line and one `>>> arm <config>: retried_cells=0` line.

Per-AC evidence (real command output, 2026-06-11, resident lock held via
`mkdir /tmp/oc-resident.lock.d`, `OC_ROTATE_HOLDING_LOCK=1`, resident
:11436 used as found and verified green after):

- [x] **Broken mount dies in preflight (AC1)**: `OC_WS_FAULT_RO=1
  host/test/run-config-ab.sh` → 3× `>>> /workspace write-probe canary
  attempt N failed — settling 2s and retrying (#019)` then `FATAL:
  /workspace write-probe canary failed after 3 attempts (...) aborting the
  arm before any cell false-fails with a deep seed ENOENT (#019).`, `==>
  arm opencode-a exit rc=4 retried_cells=0`, **EXIT=1**. Zero `>>> ...
  cell:` lines (no cell started); the only "ENOENT" occurrence in the log
  is the canary message's own text.
- [x] **Retry branch (AC2)**: `OC_FLAKE_INJECT=deep-equal
  host/test/run-config-ab.sh` → first attempt dies with `Error: ENOENT: no
  such file or directory, open '/workspace/__oc-flake-inject__/seed-file'`;
  `>>> cell deep-equal RETRY (workspace mount flake): rc=1 after 0s with
  seed-phase ENOENT under /workspace and no row emitted — re-running ONCE
  (#019)`; retry ran the real cell → `=== deep-equal (tier-64) === PASS`;
  audit `expected: 1 cells / observed: 1 rows / missing: 0 cells` (no
  duplicate); `==> arm opencode-a exit rc=0 retried_cells=1`; gate PASS;
  **EXIT=0**.
- [x] **No-retry branch (AC3)**: `OC_FLAKE_INJECT_GENUINE=deep-equal
  host/test/run-config-ab.sh` → `>>> cell deep-equal rc=1 (cell failed;
  ...); continuing`, zero `RETRY (workspace mount flake)` lines
  (`grep -c` = 0), `==> arm opencode-a exit rc=1 retried_cells=0`, audit
  `missing: 1 cells`, **EXIT=1** — sweep red as today.
- [x] **Clean sweep unchanged (AC4)**: soak sweep 1 (default knobs) →
  `grep -c 'INJECT\|canary'` = 0, `retried_cells=0`, `(arms rc=0, audit
  rc=0, overflow rc=0, gate rc=0)`, **EXIT=0**. Only deltas vs pre-#019
  output are the two spec-required retry-count report lines (deviation 3).
- [x] **Soak (AC5)**: 5 consecutive default sweeps under the held resident
  lock, 11:31:44–11:33:08 (2026-06-11): all 5 **EXIT=0**, `missing: 0
  cells` and `retried_cells=0` in each — no manual re-run needed. The
  flake itself never fired in this window (it is load-dependent;
  campaign-time observations were under co-resident sweep load, these ran
  on an otherwise idle lab), so per the AC the observed window is
  documented here: 0 canary settles, 0 retries, 5/5 green in ~84s
  wall-clock. The deterministic exercises of both retry branches are AC2/
  AC3 above.
- [x] **Suite (AC6)**: `docker compose build test` (baked image rebuilt
  from live sources first — the compose `test` service runs the BAKED
  image) then `docker compose run --rm test` → `tests 335 / suites 98 /
  pass 334 / fail 0 / cancelled 0 / skipped 1 / todo 0`, **EXIT=0** —
  exactly the required ≥335/334/0-fail/1-skip floor.

Lab left as found: lock released (`rmdir /tmp/oc-resident.lock.d`),
resident :11436 never restarted and green after (`/health` → 200), no
stale `.retry-count.*` handoff files in the runtime root.
