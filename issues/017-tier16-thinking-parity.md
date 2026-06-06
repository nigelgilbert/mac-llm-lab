# Resolve tier-16 thinking parity

**Type**: HITL

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0, §5

## What to build

Settle, with evidence, whether the **claw rig actually runs tier-16 with thinking ON
or OFF under the harness**. `clawModel` defaults to the single `anthropic/claw-llama`
LiteLLM route, which forces `enable_thinking:false` for all tiers — contradicting the
manifest's tier-16 "enable_thinking forced true" note. Determine the ground truth,
then decide and record the parity policy for the tier-16 A/B (default: **both OFF**),
so OpenCode-16 can be configured to match. This is a gating prerequisite for trusting
any tier-16 numbers.

HITL because it's an investigation + a judgment call about which mode is "correct" for
the tier-16 comparison.

## Acceptance criteria

- [ ] Documented determination of what claw-16 runs (thinking on/off) under the test harness, with the decisive evidence cited
- [ ] A recorded parity decision for tier-16 (both-off vs both-on) with rationale
- [ ] The required OpenCode-16 thinking flag to match is specified (consumed by #018)
- [ ] If claw-16's production vs harness mode differ, that skew is noted

## Blocked by

None - can start immediately
