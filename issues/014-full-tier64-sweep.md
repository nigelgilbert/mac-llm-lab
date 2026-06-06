# Full tier-64 sweep → dataset

**Type**: HITL

**Status:** ⏳ Blocked by #013

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

- [ ] All 35 Family A/B tasks run N=8 under each of `claw-rig` and `opencode-a` at tier-64
- [ ] Every run emits a registry row with correct `config_id` + `model_config_id`; missing/`harness_error` rows are accounted for, not silently dropped
- [ ] Frontier tasks are excluded (claw-wired; out of v1 scope)
- [ ] The dataset is complete enough to feed the #016 verdict (no cell materially under-sampled without explanation)

## Blocked by

- #013
