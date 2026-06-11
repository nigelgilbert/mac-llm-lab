# Harness-error accounting: assertion-write failure must not yield a silent passed:null row; spawnSync failure shapes

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), harness-core findings 2 and 5. Both are
"best-effort never throws" seams in `host/test/lib/` where a swallowed
failure silently shrinks the analysis denominator — the same failure
class the #006 remediation hardened on the emit side.

## What to build

1. **Assertion-write failure (`lib/registry_emit.js`).** When the
   `assertion_result.json` sidecar write fails, the catch logs and
   proceeds; `pickPassed` then falls back to the always-null sidecar
   value and the row lands as `terminal_status:'done', passed:null` —
   schema-valid, satisfies the #003 expected-attempts audit, and is then
   silently dropped by `isEligible`. The cell's wall-clock is burned and
   the denominator shrinks with only a stderr line as evidence. Fix
   both ends: set `process.exitCode = 1` in the catch (consistent with
   the #006 comment), and stamp the row `harness_error:
   'assertion_emit_failed'` when terminal status is done/error/timeout
   but no assertion verdict exists — the schema description at
   `run_registry.schema.json` (~line 162) already names that category.

2. **spawnSync failure shapes (`lib/runAgent.js`).** When `spawnSync`
   fails at the spawn level it returns `{error, status:null, stdout:null,
   stderr:null}`:
   - post-script path: `post.stderr.slice(...)` throws TypeError before
     the `post_result` diagnostic and the `runAgent_done` sentinel; the
     run is then flushed as a plain `passed:false` model failure instead
     of a harness error. Guard with `?? ''` and treat `status === null`
     as a harness error, not a fail.
   - precondition gate: the "must fail before the fix" check asserts
     `pre.status !== 0`, which a spawn failure or precondition-timeout
     kill (`status:null`) PASSES — a broken precondition setup
     masquerades as satisfied. Assert `pre.error == null && pre.status
     !== null` before the not-equal check.

## Acceptance criteria

- [x] Test: simulated assertion-sidecar write failure on a done run → process exit code 1 AND the emitted row carries `harness_error:'assertion_emit_failed'` (row is excluded from pass-rate by the existing eligibility predicate, but now visibly)
- [x] Test: post-script spawn-level failure (nonexistent interpreter or equivalent) → no TypeError; row recorded as harness error, not `passed:false`
- [x] Test: precondition spawn-level failure / timeout kill → run aborts as harness error (gate not satisfied), not treated as a passing precondition
- [x] Existing `registry-emit-failure.test.js` and `runAgent.test.js` suites extended, containerized suite green at strictly higher counts
- [x] Committed canonical registries unaffected (no rewrite)

## Blocked by

None - can start immediately
