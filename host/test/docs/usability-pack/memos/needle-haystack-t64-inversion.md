# Usability — `needle-haystack` v4 surfaces t64 runtime instability, not difficulty

**Filed:** 2026-05-04
**Severity:** medium (cell silently mis-classified as difficulty signal; relocated)
**Sweep:** explore-c21-20260503-2013, N=3 reps × tier 16/64

## TL;DR

`needle-haystack` v4 was authored as a t16 ctx-overflow probe (see Sprint 1.21 c11 evidence: 14 iters, 39.7k tokens > 32k ctx — clean R9-A) and entered the difficulty-pack on the strength of that single-rep signal. Under c21's N=3 confirmatory sweep the cell **inverted**:

| tier | passed / runs | terminal_status counts | notable |
|---|---|---|---|
| t16 | **2 / 3** | 2× done, 1× error | normal-shape distribution |
| t64 | **0 / 2** (3rd rep missing) | 1× error (8.6 s wall, 3 iters), 1× timeout (21 min wall, 4 iters) | every t64 attempt hit infra |

t64 — the *higher-capability* tier — failed every recorded attempt, while t16 passed 2/3. That is not a model-capability signal. A test cell that fails *worse* at the higher tier is, by construction, not telling us about model skill — it is telling us something about how the t64 plist (model + sampler + bridge + tooling) handles this particular workload.

This cell has been moved out of the difficulty-pack into `__tests__/tier-eval/frontier/` and dropped from the `NEW_TESTS` allowlist in `explore-cycle.sh`. It is preserved as a future probe — if a later t64 plist no longer shows the inversion, the cell may re-enter the pack with fresh evidence.

## Smoking-gun evidence

### Run-by-run breakdown

| run_id | tier | rep | terminal_status | passed | iters | wall (ms) | observation |
|---|---|---|---|---|---|---|---|
| `180d1c61-57f8-42a7-a35e-c220859b4777` | 16 | 1 | done    | true  | 17 | 80 027   | normal pass |
| `52cffe27-ddb5-4135-8085-fac4b9a8fe1b` | 16 | 2 | error   | false | 14 | 204 869  | normal-shape failure |
| `7ab77f12-9884-490e-b8cb-d917ad788783` | 16 | 3 | done    | true  | 12 | 51 553   | normal pass |
| `9809dfab-fe87-48c1-867b-8445658d8e91` | 64 | 1 | error   | false | 3  | **8 613** | 8.6 s end-to-end — model never engaged with the task |
| `7e33fba9-1df6-46fb-a8a3-924dd5627d4c` | 64 | 2 | timeout | false | 4  | **1 246 691** | 21 min wall — same shape as the SSE-deadlock memo from c21 (`bridge-sse-deadlock.md`); CLAW_TIMEOUT=285s did not enforce |
| (rep 3 t64) | 64 | 3 | — | — | — | — | **no registry row written** — harness lost it |

### Pattern

- **t16:** mean ~112 s wall, 12-17 iters per run, conventional pass/fail distribution. Indistinguishable from a normal difficulty-pack cell.
- **t64:** ~8 s ↔ 21 min bimodal. Three reps, three different infra failure modes (fast error, SSE deadlock, missing row). Zero of three look like the model worked the problem.

The t64 pattern matches the same SSE-deadlock class documented in [bridge-sse-deadlock.md](bridge-sse-deadlock.md): the 21-min run almost certainly waited indefinitely on a streamed response that never completed. The 8.6s error suggests the t64 plist failed at request-routing or model-load on this specific workload (the cell's 30-file workspace produces a larger initial prompt than most other cells).

## Why move to usability rather than redesign

A redesign would need to defeat a saturation strategy at the *model* level. The c21 evidence shows the cell **doesn't saturate** — it *destabilizes the runtime*. That's a different problem class with a different fix:

1. The bridge SSE deadlock has its own memo and audit trail; needle's t64 timeout is one more datapoint there, not a separate problem.
2. The 8.6s error and missing-row failures are the runtime/harness's responsibility, not the test author's.
3. Until the bridge stalls and harness row-loss are resolved, no amount of test redesign produces a clean tier-discrimination signal on this cell.

## What's been changed

- `host/test/__tests__/tier-eval/needle-haystack.test.js` → `host/test/__tests__/tier-eval/frontier/needle-haystack.test.js` (preserved, not deleted; activates again only when explicitly filtered in)
- `host/test/scripts/explore-cycle.sh` `NEW_TESTS` allowlist no longer includes `needle-haystack` — default screening sweeps skip it
- `host/test/docs/difficulty-pack/good-tests.md` — cell removed from the main 5-row table; one-line pointer to this memo

## Suggested next steps

1. **When the bridge SSE deadlock and harness row-loss issues are resolved** (see [bridge-sse-deadlock.md](bridge-sse-deadlock.md)), re-run `needle-haystack` v4 at N=3 against both tiers under the fixed runtime. If t64 reliably passes ≥80% AND t16 still floors / errors at ≥66%, the cell can re-enter the difficulty-pack with the inversion explained as runtime artifact. Document the new evidence; do not just point at the old c11 single-rep result.
2. **Independent of needle:** investigate why the t64 plist's 8.6 s error path exists at all. A model that aborts in 8.6 s on a 30-file workspace prompt either (a) isn't loaded yet, (b) has a routing bug for that workload size, or (c) is hitting some pre-flight check that fails. Whatever it is, it is invisible to operators today and will keep contaminating other long-prompt cells.
3. **Telemetry.** When a sweep loses a registry row entirely (the t64 rep 3 case here), the harness should surface that — today the only way to notice is to count rows manually against `expected-attempts.csv`.

## Artifacts

- Run summaries and iteration traces under `host/test/.claw-runtime/<run_id>/` for each run_id listed above.
- `host/test/docs/difficulty-pack/explore/c21/summary.md` — full c21 evidence (`needle-haystack` row).
- `host/test/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl` — registry rows.

## Related

- [bridge-sse-deadlock.md](bridge-sse-deadlock.md) — same class of t16 / t64 stall observed on `word-search` v2.1 in the same sweep.
- [grep-search-claw-runtime-leak.md](grep-search-claw-runtime-leak.md) — sibling usability-pack finding (U1).
