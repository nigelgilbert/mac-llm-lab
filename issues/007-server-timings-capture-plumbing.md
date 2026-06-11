# Server-timings capture plumbing: right log per tier, reachable from the runner, fail-loud

**Type**: AFK

**Status:** ✅ Complete (JS side — `run-config-ab.sh` forwarding/bind-mount is the driver agent's half; the live flag-on smoke sweep (AC 2) runs at the tranche boundary once both halves are in)

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

## Result

JS side implemented in `host/test/lib/opencode_server_timings.js`; tests in
`host/test/__tests__/lib/opencode-server-timings.test.js`; doc updated in
`host/test/docs/OPENCODE-SERVER-TIMINGS.md`. No importer (`opencode.js`,
`opencode_transcript.js`) touched — all public signatures extended
backward-compatibly (`defaultServerLogPath` gained an optional `env`
parameter defaulting to `process.env`, which is exactly what the runner's
existing `defaultServerLogPath(process.env.TIER ?? '64')` call needs).

Per-AC evidence (suite: 204 tests / 201 pass / 1 skip; the only 2 failures
are pre-existing baseline failures in `opencode.contract.test.js`
(`dockerComposeArgv` `--` separator) owned by a parallel agent this tranche
— present before this change, byte-identical after):

- **`defaultServerLogPath('32')` → `-32` log; 16/64 unchanged** — PASS.
  `'32'`/`32` resolve to `/tmp/opencode-llama-server-32.log` (matching the
  launcher's `TAG="-32"` convention in `llama-server/scripts/opencode-server`);
  tiers 16/64/undefined pinned unchanged. Tests: "tier 32 resolves to the
  -32 log, NOT the resident tier-64 log (#007)" + "maps tier-64 and tier-16…".
- **`OPENCODE_LLAMA_LOG` used verbatim (env injection)** — PASS. Set →
  returned verbatim for every tier (`/var/log/opencode-llama-server.log`
  fixture, the run-config-ab.sh bind-mount contract); empty string ignored;
  `process.env` default-parameter path pinned by set/restore test. Tests:
  "OPENCODE_LLAMA_LOG is used VERBATIM…", "an empty OPENCODE_LLAMA_LOG is
  ignored…", "reads process.env by default…".
- **Flag on + bogus path → explicit error, not `no_server_timings`** — PASS.
  `openServerLogCursor` now checks readability at open: on failure it writes
  one explicit stderr line (`[opencode_server_timings] server log unreadable
  at cursor-open: <path> …`) and marks the cursor; `captureServerTimings`
  propagates a `{ join_error: 'log_unreadable' }` marker record (the
  serverTimings array is the only channel into the transcript-side join);
  `joinServerTimings` emits `join_status: 'log_unreadable'` with all
  `server_*` fields null and the marker excluded from `n_timings`. Tests:
  "openServerLogCursor on a missing log FAILS LOUD…" + "flag on + bogus log
  path → join_status log_unreadable, NOT no_server_timings".
- **Flag off unchanged (`disabled`)** — PASS. `serverTimingsEnabled` gate
  untouched; the runner never opens a cursor when off; `joinServerTimings`
  short-circuits to `'disabled'` even if handed a marker. Tests: "disabled:
  adds no server fields…", "flag off short-circuits before the marker…".
- **Live `OPENCODE_SERVER_TIMINGS=1` smoke sweep from inside the
  eval-runner** — NOT RUN HERE by design: orchestrator runs it at the
  tranche boundary once this half and the run-config-ab.sh driver half
  (parallel agent) are both in.

### Final AC closed: live smoke via host-slice repair (2026-06-10, T2 boundary)

**The freeze (diagnosed by the orchestrator, evidence in `issues/WORKLOG.md`
T2 section):** on this host (macOS + OrbStack), under sweep load, virtiofs
serves a FROZEN view of the host-appended llama-server log to ALL containers —
stat AND reads, file- and dir-mounts, existing AND freshly-started containers —
pinned at ~sweep-start state, recovering only at idle. The in-container cursor
closes with `byteEnd == byteStart`, and even the fresh-mount relay reads 0
bytes mid-freeze. The defensive layers in `lib/opencode_server_timings.js`
(`readEofSize` read-truth EOF, `relayReadSliceViaDocker` fallback) are KEPT —
they win on healthy platforms — but cannot beat the freeze.

**Repair architecture (this fix):** host processes always see truth.
1. *Driver* (`run-config-ab.sh`): with the flag on, a host-side ticker
   appends `<epoch_ms> <host_log_size>` lines every ~3 s to
   `.claw-runtime/server-log-index.<sweep>.txt` while each arm runs (killed
   post-arm + in the cleanup trap; bash-3.2-safe). Post-arm, every fresh
   runDir (`run_summary.json` newer than the arm-start stamp under
   `client/opencode/.opencode-runtime/<runId>/`) with the freeze signature
   (`server_timings_join_status: 'no_server_timings'`) is repaired:
   wall-clock window (`run_started_ms`/`run_finished_ms`) → host-log byte
   window via the index (floor to tick at-or-before start / ceil to tick
   at-or-after end, pad one tick each side; leading pad catches the title
   request), slice extracted HOST-SIDE (`tail -c +N | head -c M`) into
   **`<runDir>/server-log.slice`** (RETAINED — #002's overflow detection
   greps the same file), then repair runs in the runner image (no node on
   the host). Best-effort: a failed repair leaves the honest
   `no_server_timings` artifacts and never reddens the sweep.
2. *Repair script* (`scripts/repair-server-timings.mjs`, new): `window`
   subcommand = the index→byte-window mapping (single source of truth,
   unit-tested); `repair` subcommand re-runs the SAME
   `parseServerLogTimings` + `joinServerTimings` the original writer used,
   rewrites `server.timings.jsonl`, and patches `run_summary.json` in the
   exact `buildOpenCodeArtifacts` shapes (status field + mechanical
   `server_timings_join_<status>` caveat, replaced not stacked) plus
   provenance: `server_timings_repaired_via: 'host_slice'` + a
   `server_timings_repaired_via_host_slice: …` caveat. Idempotent; never
   touches `iterations.jsonl`, `assertion_result.json`, or the registry.

**Live evidence (resident tier-64, under the resident lock):**
- Flag-ON sweep `config-ab-20260610-232525` (defaults, 1 cell): the freeze
  HIT live — in-place slice empty at close (`byteStart=byteEnd=611462`) and
  the relay returned 0 bytes — while the host ticker recorded the log
  growing 611462→626484 across the run. The repair pass fired: slice
  `[611462,630154)` = 18 692 bytes → runDir
  `f8e3aeb3-58ed-4152-94d6-08226e9055e0` repaired to
  `server_timings_join_status: 'ok'`, `join_keying: 'token'`, 8 blocks over
  7 iterations, `n_matched 7`, sidecar 7 rows ALL with non-null
  `server_decode_ms` (372.05…3378.28 ms). Sweep exit 0 (arms/audit/gate all
  0); no orphan ticker; arm stamp removed.
- Flag-OFF sweep `config-ab-20260610-232630` (defaults): exit 0; newest
  runDir has NO `server.timings.jsonl`, NO `server-log.slice`, NO
  `server_timings_join_status`/`server_timings_repaired_via` fields; no
  ticker/index file created — flag-off behavior byte-equal to before.
- Suite after the change: **234 tests / 233 pass / 1 skip / 0 fail**
  (baseline 213/212/1/0; +21, all `__tests__/scripts/repair-server-timings.test.js`).
- Cleanup included: the orchestrator's TEMP-DEBUG-T2 stderr line removed
  from `lib/opencode.js`; capture-ladder docs updated in
  `docs/OPENCODE-SERVER-TIMINGS.md` (in-place read → readEofSize → relay
  (best-effort) → host-slice repair (authoritative under freeze)).

This closes the second AC ("smoke sweep … produces rows with `join_status`
≠ `disabled`/`no_server_timings` and non-null `server_*` fields … via
run-config-ab.sh"): join_status lands in `{ok, count_mismatch}` via the
in-place path on a healthy run, or via the host-slice repair when the
freeze hits.
