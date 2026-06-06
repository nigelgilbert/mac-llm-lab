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

- [x] Documented determination of what claw-16 runs (thinking on/off) under the test harness, with the decisive evidence cited
- [x] A recorded parity decision for tier-16 (both-off vs both-on) with rationale
- [x] The required OpenCode-16 thinking flag to match is specified (consumed by #018)
- [x] If claw-16's production vs harness mode differ, that skew is noted

## Resolution (2026-06-06)

**Decision record:** [host/test/docs/TIER16-THINKING-PARITY-DECISION.md](../host/test/docs/TIER16-THINKING-PARITY-DECISION.md).

- **Determination:** claw-16 runs **thinking OFF** under the harness. The route
  `anthropic/claw-llama` forces `enable_thinking:false`, and a **live `/apply-template`
  probe** on the tier-16 GGUF (`Qwen3.5-9B-IQ4_XS`) + pinned build `b1-5594d13` confirms
  the per-request override **wins** over the server's launch-time `true` (closed
  `<think></think>` prefill). The manifest "enable_thinking forced true" note describes
  the *server launch flag*; no real contradiction. (Resolved an adversarial objection that
  the precedence was unproven on Qwen3.5 — it is now verified on this build.)
- **Parity decision:** **both OFF** (pre-registered default; also functionally required
  for OpenCode, which has no `claw.gbnf` backstop against the naked-XML freeze).
- **OpenCode-16 flag (→ #018):** `--chat-template-kwargs '{"enable_thinking":false}'`,
  with a mandatory `/apply-template` closed-think-prefill assertion on OpenCode's server.
- **Skew:** production claw-16 (`anthropic/claw` route, no override) is thinking-**ON**;
  the A/B characterizes the harness off-mode. Manifest tier-16 notes annotated to flag
  that the recorded N=8 numbers are thinking-off runs.

Plan §0/§5 and the OpenCode setup guide updated to mark this gating criterion closed.

## Blocked by

None - can start immediately
