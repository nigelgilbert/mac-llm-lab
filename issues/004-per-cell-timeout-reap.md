# Per-cell timeout: reap the cell's container, truthful logging, sweep-scoped trap

**Type**: AFK

**Status:** 🔲 Not started

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
