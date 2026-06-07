# Full tier-64 sweep → dataset

**Type**: HITL

**Status:** ✅ Done — tier-64 paired sweep green (2026-06-06). Registry
`host/test/.claw-runtime/run_registry.config-ab-20260606-165548.jsonl` (gitignored);
gate PASS; `paired_bootstrap` nTasks=32 aggregateDelta=+3.1pp 90% CI [0.8, 6.3]pp.
See **Result** below. Harness commit at run time: `3d474f5`.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.6, §6

## What to build

Run the full tier-64 A/B via the phase-swap driver: the **35 Family A/B tasks ×
N=8** under both `claw-rig` and `opencode-a`, producing the complete registry dataset
(2 cells × 35 × 8 ≈ 560 rows) for the tier-64 verdict. Watch for harness errors,
timeouts, or server instability across the long run; the claw side is re-measured
fresh here (per #001), not reused from history.

HITL because it's a long unattended run that needs monitoring for harness/serving
issues that would invalidate cells.

## Acceptance criteria

- [x] All **32** `runAgent`-based Family A/B tasks run N=8 under each of `claw-rig` and
  `opencode-a` at tier-64. **Correction:** the "35" here over-counted — 3 of the 35
  tier-eval top-level tests (`latency`, `prose-quality`, `tool-discipline`) are
  **claw-bridge probe diagnostics**, not `runAgent` tasks: they hit the LiteLLM bridge /
  claw renderer directly (TTFT, markdown render, tool-call wrap rate), never call
  `runAgent`, so they emit **no registry row** and are not A/B-eligible (and
  `prose-quality`/`tool-discipline` are explicitly claw-wired). The true A/B set is **32**.
  All 32 paired 8×8 (a few cells lost to attrition, below).
- [x] Every run emits a registry row with correct `config_id` + `model_config_id`;
  missing/`harness_error` rows accounted for. 512 rows (256/256), every row
  `config_id`-stamped (gate invariant 1). Attrition (all claw-side; oc 256/256 `done`):
  `deep-equal` ×1 `error` (eligible fail), `expression-eval` ×2 `harness_error` (ineligible)
  + ×1 `timeout` — none silently dropped; expression-eval still N=6 eligible claw runs.
- [x] Frontier tasks excluded (the 4 `frontier/` claw-wired tasks; out of v1 scope).
- [x] Dataset complete for the #016 verdict: 32 paired tasks, no cell materially
  under-sampled. Pre-registered criteria both met by this data (for #016 to render):
  rule 0a.1 pass-rate CI lower bound +0.8pp > −5pp; rule 0a.2 oc median 13.2s vs claw
  21.9s = **0.60×** ≤ 1.5×.

## Result (2026-06-06 sweep)

- **Registry (gitignored):** `host/test/.claw-runtime/run_registry.config-ab-20260606-165548.jsonl`
- **Driver:** `host/test/run-config-ab.sh`, `PHASE_SWAP=1 TIER=64 CONFIG_AB_REPEATS=8`,
  per-cell cap 600s, `OPENCODE_SERVER_TIMINGS` OFF (server-timing render deferred to #016
  per the known count_mismatch). Image rebuilt before the run (stale-baked-lib footgun).
- **Gate (`config-ab-pairing-check.mjs`):** PASS — 512 rows, claw-rig 256 / opencode-a 256,
  every row `config_id`-stamped, 32 paired / 0 unpaired, claw baseline NOT dropped
  (claw-rig=254 eligible, opencode-a=256).
- **`paired_bootstrap`:** nTasks=32, aggregateDelta=**+3.1pp**, 90% CI **[0.8, 6.3]pp**.
  Per-task deltas ≥0 on every task (oc matched or beat claw); largest = `expression-eval`
  +50pp (claw 3/6 vs oc 8/8).
- **Wall-clock:** claw median 21.9s / p90 77s / max 352s; oc median 13.2s / p90 41s /
  max 267s. Sweep span 4.36h, watched; production claw `:11435` brought down for Phase B
  and **restored green** by the EXIT trap (verified 200).
- **Caveat (op note):** the driver's Phase A hardcodes its in-container registry path from
  the auto `REGNAME`, ignoring a `REGISTRY_OUT` override — set `REGISTRY_OUT` and the two
  phases write to different files (claw → REGNAME, oc → REGISTRY_OUT) and the gate sees
  claw=0. This sweep used **default naming** (no override) so both phases share one file.
  Worth fixing in the driver before anyone reaches for `REGISTRY_OUT`.

## Blocked by

- #013 (done)
