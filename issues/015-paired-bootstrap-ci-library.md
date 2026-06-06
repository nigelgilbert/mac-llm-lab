# Paired-bootstrap non-inferiority CI library

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0a

## What to build

A small, unit-tested library that computes the pre-registered non-inferiority
statistic: the **90% paired-bootstrap CI** on `(opencode-a − claw-rig)` aggregate
pass-rate, **paired by task** and bootstrapped over the 35 tasks (resampling tasks,
using each task's N=8 pass-probability) — not pooled Bernoulli trials. It also reports
the per-task pass-rate deltas. Pure function over registry rows grouped by
`config_id`; can be built and unit-tested against synthetic rows before #014 lands.

## Acceptance criteria

- [ ] Given per-task per-config pass counts, returns the aggregate `(B − claw)` delta and 90% paired-bootstrap CI lower bound
- [ ] Resamples over the 35 tasks (paired), not over pooled individual runs
- [ ] Returns per-task deltas alongside the aggregate
- [ ] Unit tests cover known synthetic cases (clear non-inferior, clear inferior, borderline) with deterministic seeding
- [ ] Operates on registry rows grouped by `config_id` (and tier)

## Blocked by

- #002
