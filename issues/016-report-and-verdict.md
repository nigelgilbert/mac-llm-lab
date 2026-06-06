# Report + non-inferiority verdict

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0a, §4.7

## What to build

A report that consumes the #015 statistics over the #014 dataset and renders the
pre-registered decision. Headline pass-rate, then wall-clock; apply the **retire
rule** per tier: non-inferior iff the 90% paired-bootstrap CI lower bound on
`(B − claw)` is `> −5 pp` **and** OpenCode median wall-clock `≤ 1.5×` claw's. Show
per-task deltas so a single regressed task is visible, and emit a provenance line per
side (model + serving config + prompt). Evaluate tier-64 independently.

## Acceptance criteria

- [ ] Report renders per-tier: aggregate pass-rates, the `(B − claw)` delta + 90% CI lower bound, and median wall-clock ratio
- [ ] The retire/keep verdict is computed from the two-condition rule (5 pp margin AND 1.5× wall-clock)
- [ ] Per-task deltas are listed; regressions are not averaged away
- [ ] A provenance line per side states model + serving config + prompt
- [ ] Server-decode timing is omitted unless built (not implied); tier-64 verdict stands alone

## Blocked by

- #015
- #014
