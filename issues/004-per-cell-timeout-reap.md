# Per-cell timeout: reap the cell's container, truthful logging, sweep-scoped trap

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), finding 3/15 and cut-C22 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

When the driver's per-cell cap fires (`timeout --signal=TERM ... node --test`),
three things go wrong (verified empirically in the runner image):

1. The `oc-run-*` sibling container survives the kill (no SIGTERM handler in
   the node chain, `t.signal` never aborts, so `onAbort`'s `docker rm -f`
   never runs) and keeps generating against the tier's single llama-server
   slot, degrading every subsequent cell until the end-of-sweep trap.
2. The driver logs "(row still emitted; continuing)" — false for this path:
   the reporter's flush never runs, so the cell's row is silently absent
   (visibility handled by #003; the message is fixed here).
3. The end-of-sweep cleanup trap force-removes **all** containers matching
   `name=oc-run-` — container names are `oc-run-<uuid>` with no sweep
   component, so the filter cannot be scoped to this sweep.

Build: per-cell reaping (kill containers belonging to the just-killed cell —
e.g. label the container with a sweep id + cell stem at `docker compose run`
time, or have the driver snapshot `docker ps` before/after the cell), make
the timeout log message state what actually happened, and scope both the
per-cell and end-of-sweep reaps to this sweep's label/prefix so concurrent
or stray containers from other contexts are left alone.

## Acceptance criteria

- [ ] Forcing a cell to exceed PER_TEST_TIMEOUT (e.g. a tiny cap against a slow tier) leaves zero `oc-run-*` containers running within seconds of the kill, not at sweep end (`docker ps --filter name=oc-run-` empty)
- [ ] The driver's timeout log line no longer claims a row was emitted; it names the killed cell and the reaped container
- [ ] The cleanup trap's filter matches only containers carrying this sweep's label/id (verify: a manually-started decoy `oc-run-decoy` container survives the sweep's trap)
- [ ] A clean smoke sweep still exits 0 and reaps nothing mid-run

## Blocked by

None - can start immediately (coordinate with #003 — same file)

## Result

Implemented in `host/test/run-config-ab.sh` + `client/opencode/docker-compose.yml`
(2026-06-10, tranche 2). Label contract:

- The driver generates `OC_SWEEP_ID=config-ab-<stamp>-<pid>` per sweep and
  forwards it via `-e OC_SWEEP_ID` into the eval-runner; runOpenCode's
  `docker compose run` spawn inherits `process.env`, and the compose service
  label `mac-llm-lab.sweep=${OC_SWEEP_ID:-}` stamps it onto every `oc-run-*`
  sibling. Verified empirically: a `docker compose run` container carries the
  label, `docker ps --filter label=mac-llm-lab.sweep=<id>` matches it, a
  different id matches nothing, and an unset env interpolates to an empty
  label (no compose warning) that a non-empty filter never matches.
- Per-cell reap: when the cap exits 124 (TERM) or 137 (`--kill-after` KILL),
  the arm loop `docker rm -f`s everything matching this sweep's label
  immediately (only one cell is in flight, so sweep scope == cell scope).
- The end-of-sweep trap's orphan filter switched from `name=oc-run-` to the
  same sweep label.

Per-AC evidence (real command output, 2026-06-10):

- [x] **Zero this-sweep containers within seconds of the kill**:
  `PER_TEST_TIMEOUT=10 SMOKE_TESTS=wordy ...` (wordy needs ~20 s) — the reap
  line printed inside the arm loop right after the 10 s kill, and
  `docker ps -a --filter name=oc-run-` immediately after the sweep listed
  ONLY the decoy.
- [x] **Truthful log line**: `>>> cell wordy KILLED by per-cell cap (rc=124):
  NO row emitted (reporter flush never ran); reaped sweep container(s):
  oc-run-ffb32d6d-1606-4eb0-a896-d0c437f7c30c`. The non-timeout failure
  branch now says a row was emitted *iff* runAgent reached the reporter
  flush, with the #003 audit as arbiter — never the old unconditional "(row
  still emitted)".
- [x] **Decoy survives**: a manually-started unlabeled `oc-run-decoy`
  remained Up through the per-cell reap AND the exit trap (no
  `[cleanup] reaping` line fired); removed manually afterwards.
- [x] **Clean smoke reaps nothing mid-run**: the 2-cell clean smoke
  (`deep-equal wordy`) exited 0 with no reap lines.
