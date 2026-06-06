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

- [x] A raw `/v1/chat/completions` request with a tool spec returns a parsed `tool_calls[]` (not raw XML in content)
- [x] No prose-before-`<tool_call>` parse failure (thinking-off confirmed effective)
- [x] `arguments` type behavior documented per `#20198`; shim applied or confirmed unnecessary
- [x] A short validation transcript / command is recorded so the result is reproducible

## Result (2026-06-06, build `b1-5594d13`)

✅ **PASS — 39/39 live generations.** Native `tool_calls[]` parse cleanly (streaming
+ non-streaming); `arguments` is a **STRING** (OpenAI-strict) so **no #20198 shim** is
needed. The `#20260` "naked-XML freeze" **did not reproduce** on this build even with
thinking ON / prose-before-call — so thinking-off is kept for **claw-parity**, not as a
freeze-workaround (flagged for human review). Full write-up, transcripts, and caveats:
[host/llama-server/docs/TOOL-CALL-VALIDATION.md](../host/llama-server/docs/TOOL-CALL-VALIDATION.md).
Re-runnable: [host/llama-server/scripts/validate-tool-calls.sh](../host/llama-server/scripts/validate-tool-calls.sh).

## Blocked by

- #005
