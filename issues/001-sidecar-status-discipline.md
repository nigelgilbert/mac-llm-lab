# runOpenCode sidecar status discipline: no close-handler overwrite, honest abort labels

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), findings 1/15 and cut-C15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

Two fixes to `runOpenCode`'s terminal-status labeling, both in the
spawn/close/abort handler cluster of `host/test/lib/opencode.js`:

1. **Stop the close-handler overwrite.** On a spawn-level failure (missing
   `docker`, ENOENT on the compose cwd) Node emits `'error'` then `'close'`
   with code `-2` (verified on node 22/24). The `'error'` handler writes the
   `run_summary.json` sidecar with `terminal_status: 'harness_error'` +
   `spawn_error`; the unguarded `'close'` handler then re-runs `writeSidecar`
   with `spawnError=null` and rewrites it as `terminal_status: 'error'`.
   Since `registry_emit` builds the row entirely from the on-disk sidecar,
   the run enters `paired_bootstrap.isEligible` as an eligible model failure.
   The existing `settled` flag guards only the promise — extend the same
   once-only discipline to the sidecar write.

2. **Distinguish caller aborts from the internal hard-timeout.** The caller
   signal and `AbortSignal.timeout(timeoutMs)` are merged via
   `AbortSignal.any` with no source tag, so every abort is labeled
   `terminal_status: 'timeout'` and `'interrupted'` is unreachable for
   opencode rows (run_row's `signal` check is dead — registry_emit hardcodes
   `signal: null`). Inspect which input fired (e.g. check the caller signal's
   `aborted` flag at close time) and label caller-initiated aborts
   `'interrupted'` so isEligible excludes them.

## Acceptance criteria

- [x] A unit test in `host/test/__tests__/lib/` simulates the `'error'` → `'close'`(code -2) sequence and asserts the on-disk `run_summary.json` retains `terminal_status: 'harness_error'` and non-null `spawn_error`
- [x] A unit test aborts via the caller signal (not the internal timer) and asserts the sidecar says `terminal_status: 'interrupted'`; the internal-timeout path still says `'timeout'`
- [x] `run_registry.schema.json`'s terminal_status enum already covers `interrupted` — confirm no schema change needed, or extend it
- [x] Runner-image suite green: lib + scripts tests pass at current counts or higher

## Blocked by

None - can start immediately

## Result

Implemented 2026-06-10 in `host/test/lib/opencode.js`; tests in
`host/test/__tests__/lib/opencode-sidecar-status.test.js` (new) +
`host/test/__tests__/lib/opencode.contract.test.js` (3 stale caller-abort
assertions updated to the new honest label).

**Fix 1 (close-handler overwrite):** added a `sidecarWritten` flag +
`writeSidecarOnce` wrapper next to `finish`/`settled` — the `'error'` handler
and the close handler's outcome-only fallback both go through it, so whichever
fires first owns the sidecar. The close handler also skips the transcript
build when `settled` is already true at entry (spawn failed → no container →
no DB).

**Fix 2 (abort provenance):** `onAbort` samples the caller signal's `.aborted`
at kill time (`callerAborted`) — at that instant either the caller fired
(`'interrupted'`) or the internal `AbortSignal.timeout` ceiling did
(`'timeout'`). Sidecar fields for interrupted runs: `terminal_status:
'interrupted'`, `timeout: false`, `exit_code: null`, `censored: true`,
`passed: null`. The resolved RunnerResult mirrors the sidecar
(`terminal_status: 'interrupted'`, `timeout: false`). Caller-aborted runs on
the real docker path degrade to the outcome-only sidecar (transcript builder
can only label timeout/done/error; a hard-killed run's DB is partial/absent
anyway, #020 §6).

### Per-AC evidence

Red run first (pre-fix), same command as below: 3/5 new tests failed —
`'close'` relabeled the spawn-failure sidecar, and both caller-abort tests read
`'timeout'` — confirming the tests reproduce both bugs.

**AC1 — error→close(-2) retains harness_error + spawn_error**

```
cd host/test && docker compose run --rm -v "$PWD/lib:/test/lib" \
  -v "$PWD/scripts:/test/scripts" -v "$PWD/__tests__:/test/__tests__" \
  test node --test --test-concurrency=1 __tests__/lib/opencode-sidecar-status.test.js
✔ retains terminal_status 'harness_error' + spawn_error after 'close'(-2) fires
```

The test spawns a missing binary via the `exec` seam (`'error'` then
`'close'`(-2) observed in the runner image's node), waits 400 ms past
resolution for `'close'` to land, then asserts the on-disk sidecar still says
`terminal_status: 'harness_error'` with `spawn_error` matching `/ENOENT/`.

**AC2 — caller abort → 'interrupted'; internal timer → 'timeout'**

```
✔ caller-initiated abort → sidecar terminal_status 'interrupted'
✔ already-aborted caller signal → 'interrupted' (kill before the child runs)
✔ internal hard-timeout with a (silent) caller signal present → still 'timeout'
✔ internal hard-timeout with no caller signal at all → 'timeout'
```

Caller-abort cases assert the sidecar (`terminal_status: 'interrupted'`,
`timeout: false`, `censored: true`, `passed: null`); the timeout cases include
one with a silent caller signal attached, pinning that mere presence of a
caller signal does not flip the label.

**AC3 — schema:** `host/test/lib/schemas/run_registry.schema.json`
`terminal_status` enum already lists `"interrupted"` (alongside done / error /
timeout / harness_error). No schema change made.

**AC4 — suite green (runner image, live mounts):**

```
node --test --test-concurrency=1 __tests__/lib/*.test.js __tests__/scripts/*.test.js
ℹ tests 176  ℹ pass 175  ℹ fail 0  ℹ skipped 1
```

Above the 143-test pre-work baseline (other issue agents were adding tests
concurrently); zero failures.
