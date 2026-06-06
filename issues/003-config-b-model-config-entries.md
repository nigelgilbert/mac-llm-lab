# Config-B `model_config_id` manifest entries

**Type**: AFK

**Status:** ✅ Done — 0382e82

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.5

## What to build

Add two new `model_config` manifest entries — one per tier — describing how OpenCode
(Config B) serves the model. The weights and sampler are identical to the claw tier
configs, so `model_id`, `quantization`, `context_limit`, and `sampler_config_id` are
reused; what differs is the **serving provenance**, which the note must capture:
corrected Jinja template, no `claw.gbnf` grammar, native `<tool_call>` emission,
thinking-off via `chat-template-kwargs` (not via a LiteLLM route).

Rationale: `model_config_id` is the serving fingerprint. Reusing claw's id would
stamp Config-B rows with claw's litellm/grammar note (false). Keeping a distinct id
makes every row self-documenting.

## Acceptance criteria

- [x] Two new manifest entries exist (tier-64 B, tier-16 B), each validating against the manifest schema
- [x] Each reuses the tier's `model_id` / `quantization` / `context_limit` / `sampler_config_id`
- [x] Each note describes B's serving: corrected Jinja, no grammar, native tool-call, thinking-off via `chat-template-kwargs`
- [x] The new `model_config_id`s are referenceable by run context (resolvable like existing ids)

## Blocked by

None - can start immediately
