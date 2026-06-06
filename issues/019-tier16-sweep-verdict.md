# tier-16 sweep + verdict

**Type**: AFK

**Status:** ⏳ Blocked by #014, #016 (#018 met)

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0a, §6

## What to build

Run the established tier-64 pipeline at tier-16: phase-swap driver (#013) over the 35
tasks × N=8 under both configs at `TIER=16`, then feed the dataset through the report
(#016) to produce the tier-16 verdict. Reuse all the machinery; the only new inputs
are the tier-16 second server (#018) and the tier-16 model resolution.

Remember the standing caveat: tier-16 on this 64 GB box is a **capability proxy** — it
does not reproduce 16 GB memory pressure. Label the verdict accordingly.

## Acceptance criteria

- [ ] 35 tasks × N=8 run under both configs at `TIER=16` via the phase-swap driver
- [ ] Rows carry tier-16 `config_id` + Config-B `model_config_id`
- [ ] The report renders the tier-16 verdict via the same 5 pp / 1.5× rule, evaluated independently from tier-64
- [ ] The report marks the tier-16 result as a capability proxy (not a 16 GB pressure verdict)

## Blocked by

- #018
- #014
- #016
