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
| `7e33fba9-1df6-46fb-a8a3-924dd5627d4c` | 64 | 2 | timeout | false | 4  | **1 246 691** | 21 min wall — same shape as the SSE-deadlock memo from c21 (`../../../../litellm/docs/bridge-sse-deadlock.md`); CLAW_TIMEOUT=285s did not enforce |
| (rep 3 t64) | 64 | 3 | — | — | — | — | **no registry row written** — harness lost it |

### Pattern

- **t16:** mean ~112 s wall, 12-17 iters per run, conventional pass/fail distribution. Indistinguishable from a normal difficulty-pack cell.
- **t64:** ~8 s ↔ 21 min bimodal. Three reps, three different infra failure modes (fast error, SSE deadlock, missing row). Zero of three look like the model worked the problem.

The t64 pattern matches the same SSE-deadlock class documented in [bridge-sse-deadlock.md](../../../../litellm/docs/bridge-sse-deadlock.md): the 21-min run almost certainly waited indefinitely on a streamed response that never completed. The 8.6s error suggests the t64 plist failed at request-routing or model-load on this specific workload (the cell's 30-file workspace produces a larger initial prompt than most other cells).

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

1. **When the bridge SSE deadlock and harness row-loss issues are resolved** (see [bridge-sse-deadlock.md](../../../../litellm/docs/bridge-sse-deadlock.md)), re-run `needle-haystack` v4 at N=3 against both tiers under the fixed runtime. If t64 reliably passes ≥80% AND t16 still floors / errors at ≥66%, the cell can re-enter the difficulty-pack with the inversion explained as runtime artifact. Document the new evidence; do not just point at the old c11 single-rep result.
2. **Independent of needle:** investigate why the t64 plist's 8.6 s error path exists at all. A model that aborts in 8.6 s on a 30-file workspace prompt either (a) isn't loaded yet, (b) has a routing bug for that workload size, or (c) is hitting some pre-flight check that fails. Whatever it is, it is invisible to operators today and will keep contaminating other long-prompt cells.
3. **Telemetry.** When a sweep loses a registry row entirely (the t64 rep 3 case here), the harness should surface that — today the only way to notice is to count rows manually against `expected-attempts.csv`.

## Artifacts

- Run summaries and iteration traces under `host/test/.claw-runtime/<run_id>/` for each run_id listed above.
- `host/test/docs/difficulty-pack/explore/c21/summary.md` — full c21 evidence (`needle-haystack` row).
- `host/test/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl` — registry rows.

## Related

- [bridge-sse-deadlock.md](../../../../litellm/docs/bridge-sse-deadlock.md) — same class of t16 / t64 stall observed on `word-search` v2.1 in the same sweep.
- [grep-search-claw-runtime-leak.md](grep-search-claw-runtime-leak.md) — sibling usability-pack finding (U1).

---

## Addendum 2026-06-11 — post-migration re-base: inversion GONE; infra explanation CONFIRMED (T10/R2)

The claw stack (LiteLLM bridge + grammar + Anthropic tool path) was retired
2026-06-10 (tag `claw-stack-final`); the suggested-next-step §1 re-run is now
possible and was executed on the OpenCode stack.

### What ran

- **Port:** the v4 test was recovered from git (`df50d21~1` — the `frontier/`
  directory itself was deleted wholesale by migration issue #010, so the file
  no longer existed at HEAD) and minimally ported to the post-#5 `runAgent`
  convention. The spec region — `VERSION_SEED`, all 30 generated files, PROMPT,
  VERIFY_JS — is **byte-identical** to the claw-era file (verified by diff
  against `git show df50d21~1:…`); only harness wiring changed (runAgent
  prelude; nested fixtures written by a pluggable-runner shim because
  `seedFiles` is flat-only; pass oracle is the central #001 workspace oracle,
  so the claw-era `exit==0` gate is telemetry now, lab-wide). Ported file:
  `host/test/__tests__/tier-eval/needle-haystack.test.js` (flat dir — the
  #010 driver and expected-attempts plan cannot address `frontier/`).
- **Vehicle:** `run-config-ab.sh` (#010 driver), `SMOKE_TESTS=needle-haystack`,
  resident :11436 used as found under `/tmp/oc-resident.lock.d`,
  `OPENCODE_SERVER_TIMINGS=1` (#002 overflow re-typing + #007 timing slices
  active; all t64 rows joined `server_timings_join_status=ok`).
- **Arm choice:** tier-64 ran **`opencode-a`**, NOT `opencode-a+prompt`. The
  tranche brief suggested `+prompt` as "the adopted production stack", but (a)
  the tier-64 adoption verdict ([OPENCODE-AB-TIER64-VERDICT.md](../../OPENCODE-AB-TIER64-VERDICT.md))
  retired the discipline prompt at t64 — vanilla `opencode-a` IS the adopted
  t64 production bundle; (b) `opencode-a+prompt × 64` has no
  `model_config_id` mapping in `lib/config.js` (it is a tier-16 sidecar-port
  arm) and the driver's #006 preflight refuses it. Tier-16 ran
  **`opencode-a+prompt`** — the adopted t16 analog of the claw-era
  prompt-bearing bundle.

### Run-by-run (tier-64, `opencode-a`, N=5, sweep `config-ab-20260611-140627-21950`, `retried_cells=0`)

| run_id | tier | rep | terminal_status | passed | iters | wall (ms) | observation |
|---|---|---|---|---|---|---|---|
| `07460b87-ee4e-42d1-a00f-dab39cf32ae1` | 64 | 1 | done | true | 13 | 97 168 | normal pass |
| `80e9192a-46e7-45f4-aa05-9441cff4e25a` | 64 | 2 | done | true | 6  | 14 586 | normal pass |
| `5164416a-29e4-409a-8600-c8bfb81ddf76` | 64 | 3 | done | true | 6  | 35 667 | normal pass |
| `6ac593ff-d796-40e1-af95-f6437865a00e` | 64 | 4 | done | true | 7  | 53 015 | normal pass |
| `6c12f943-d4cb-4913-b891-7171baf5a1ef` | 64 | 5 | done | true | 3  | 95 262 | normal pass |

**t64: 5/5 pass (Wilson 95% CI [56.6%, 100%]); zero 8s-class instant errors,
zero SSE-deadlock-shape stalls (max wall 97 s vs the c21 21-min stall), zero
lost rows (expected-attempts audit exact: 5 planned / 5 observed), zero #019
mount-flake retries.** Every failure mode in the c21 table is absent. No
context overflow (`context_overflow=false` on all rows; max input 6 345 tok).

### Run-by-run (tier-16, `opencode-a+prompt`, N=3)

| run_id | tier | rep | terminal_status | passed | iters | wall (ms) | observation |
|---|---|---|---|---|---|---|---|
| `7216872a-193d-4bf4-bce2-19bb79d9cb24` | 16 | 1 | done    | true | 20 | 96 601  | normal pass |
| `8ea0a69b-6f9b-4289-8888-a0f10624cc3e` | 16 | 2 | done    | true | 7  | 35 413  | normal pass |
| `56124607-91e3-4f28-8054-4aa4edb5aaa3` | 16 | 3 | timeout | true | 63 | 277 241 | iter-storm (63 iters, 65 tool calls); workspace already correct when the runner's 277 s ceiling fired — oracle pass. NOTE the ceiling ENFORCED, unlike the claw-era 21-min unenforced CLAW_TIMEOUT |

**#019 mount-flake observations (DATA, not hidden):** the t16 side burned two
extra driver invocations. Arm summary `retried_cells`: first t16 sweep = **2**
(rep lost anyway — both attempts of one cell died with the instant
seed-ENOENT signature, so the planned 3rd row was missing and that sweep
exited 2-red); first top-up = **1** (cell double-flaked again, no row); second
top-up = **0** (clean, row landed). t64 sweep = **0**. Net: 5 flake events
across 8 t16 cell attempts vs 0/5 at t64 — consistent with the #019
share-degradation record. All flake kills were pre-agent (seed phase); no
agent run was lost.

### Decision (per this memo's own §next-steps-1 rule)

- **The inversion is GONE → it was infra.** t64 passes 100% ≥ 80% with
  normal-shape runs. The 8.6 s routing error, the SSE-deadlock stall, and the
  silent row loss all died with the claw bridge (row loss is now actively
  audited by the driver's #003 expected-attempts diff, which demonstrably
  catches it — it flagged the t16 flake-lost rep).
- **The memo's FULL re-entry condition is only half-met.** The rule wanted
  "t16 still floors / errors at ≥66%". It does not: t16 oracle-passed 3/3
  (one rep only via the timeout-grazing pass). The cell re-enters the pack
  (file restored to `__tests__/tier-eval/`, row restored in
  [good-tests.md](../../difficulty-pack/good-tests.md)) **as a weak/ceilinged
  cell, not a tier discriminator**: its remaining signal is wall-clock/iter
  shape (t16 1/3 at the ceiling vs t64 all ≤97 s), and its own
  `keep_drop_rule` ("drop if t16 ≥85% across two consecutive confirmatory
  sweeps") is now live — one confirmatory N≥5 sweep already counts toward it.
- **Caveats carried:** the original inversion was claw-rig N=2–3; this re-base
  is a different harness bundle (OpenCode runner, #001 oracle, different
  serving path) at N=5/3. The comparison **dissolves the INFRA explanation
  question**; it is NOT a paired model comparison, and the t16 arm
  additionally carries the ported discipline prompt (`opencode-a+prompt`),
  which the claw-era t16 bundle had in different wrapping. Small-N Wilson
  intervals above are wide; EVAL-DESIGN rule 2 (n≥5) is met at t64 only.

### Artifacts

- Registries: `host/test/.claw-runtime/run_registry.needle-rebase-t64-20260611.jsonl`
  (5 rows), `host/test/.claw-runtime/run_registry.needle-rebase-t16-20260611.jsonl`
  (3 rows, assembled via REUSE_ROWS top-up after the flake-lost rep).
- Per-run sidecars (iterations.jsonl, run_summary.json, server-log.slice):
  `client/opencode/.opencode-runtime/<run_id>/`.
- Tool-selection note for the sibling memo: **all five t64 runs reached for
  OpenCode's `grep` tool** (3–6 calls each) on this cell — see the 2026-06-11
  addendum in [grep-search-claw-runtime-leak.md](grep-search-claw-runtime-leak.md)
  for the post-migration self-poisoning audit that piggybacked on this re-base.
