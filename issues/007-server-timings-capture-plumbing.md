# Server-timings capture plumbing: right log per tier, reachable from the runner, fail-loud

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 xhigh review (2026-06-10), findings 8/15 and 10/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

The server-timings capture (old-suite #022; doc:
OPENCODE-SERVER-TIMINGS.md) cannot produce correct data in any shipped
configuration:

1. **Wrong log for tier 32.** `defaultServerLogPath` special-cases only tier
   16; tier 32 falls through to the resident tier-64 log
   (`/tmp/opencode-llama-server.log` instead of `-32.log`), so a TIER=32 run
   brackets the wrong daemon's log and can ordinally join foreign timings
   with `join_status: 'ok'`. Add the 32 case — or better, accept the log
   path from the environment (`OPENCODE_LLAMA_LOG`, today honored only by
   the bash launcher) so the JS harness and launcher share one convention.

2. **Unreachable from the canonical topology.** In the shipped sweep the
   cursor code runs inside the eval-runner container: host /tmp is never
   mounted and the driver's `-e` list doesn't forward
   `OPENCODE_SERVER_TIMINGS` — a host-set flag silently lands
   `join_status: 'disabled'`, and even forwarded it would read the
   container's empty /tmp and land `'no_server_timings'`. Forward the env
   and bind-mount the per-tier log path (read-only) in the driver when the
   flag is on.

3. **Silent degrade.** `fileSizeOrZero`'s catch and the existsSync-empty
   path make every misconfiguration indistinguishable from a quiet server.
   When the flag is on and the log path does not exist at cursor-open time,
   fail loudly (throw or stderr + distinct join_status) instead.

## Acceptance criteria

- [ ] Unit tests: `defaultServerLogPath('32')` (or the env-passthrough equivalent) resolves to the `-32` log; tier 16/64 unchanged
- [ ] `OPENCODE_SERVER_TIMINGS=1` smoke sweep on a live tier produces rows with `join_status` ≠ `disabled`/`no_server_timings` and non-null `server_*` fields in `server.timings.jsonl` — from inside the eval-runner container, via run-config-ab.sh, not a host-direct invocation
- [ ] With the flag on and a bogus log path, the run surfaces an explicit error/join_status (`log_unreadable` or similar), not `no_server_timings`
- [ ] With the flag off, behavior is unchanged (no mount, no env, `disabled`)

## Blocked by

None - can start immediately (schedule early: #002's overflow detection
reads the capture window this builds, and #016 consolidates these call
sites afterward)
