# tier-16 OpenCode serving (9B) + tool-call validation

**Type**: HITL

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0, §4.2

## What to build

Stand up the second `llama-server` for tier-16 serving the `Qwen3.5-9B IQ4_XS` GGUF
with OpenCode's config and the thinking-parity policy from #017, then validate native
tool-calls the same way as tier-64 (#006). The three 35B-A3B fixes may not all apply
to the 9B — determine which are needed (template, thinking flag, `-n`) and validate
empirically rather than assuming the tier-64 recipe transfers.

## Acceptance criteria

- [ ] Second `llama-server` serves the tier-16 GGUF on its own port, green `/health`, sampler mirroring tier-16
- [ ] Thinking mode set to match the #017 parity decision
- [ ] A raw request returns parsed `tool_calls[]` on the 9B (naked-XML freeze absent or mitigated)
- [ ] Which of the tier-64 fixes are/aren't needed for the 9B is documented

## Blocked by

- #017
- #006
