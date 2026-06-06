# Native tool-call validation (tier-64)

**Type**: HITL

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §5 ·
[OPENCODE-QWEN36-SETUP-GUIDE.md](../host/test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md)

## What to build

Validate — with a raw OpenAI-compatible request against the #005 server — that the
35B-A3B model emits a **parsed `tool_calls[]`** (native emission, no "naked-XML
freeze") with thinking suppressed. Confirm the `#20198` arguments-type behavior
(`tool_calls[].function.arguments` as string vs object) on the local llama.cpp build,
and note/apply any shim needed for strict OpenAI compatibility.

This is the single biggest empirical risk in the whole effort — prove tool-calls fire
end-to-end on this model+OS **before** any container or runner work depends on it.

## Acceptance criteria

- [ ] A raw `/v1/chat/completions` request with a tool spec returns a parsed `tool_calls[]` (not raw XML in content)
- [ ] No prose-before-`<tool_call>` parse failure (thinking-off confirmed effective)
- [ ] `arguments` type behavior documented per `#20198`; shim applied or confirmed unnecessary
- [ ] A short validation transcript / command is recorded so the result is reproducible

## Blocked by

- #005
