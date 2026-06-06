# Guide — OpenCode + Qwen3.6-35B-A3B local setup (Config B reference)

Companion to [OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md). The
**§2 decision is now locked to (a) / apples-to-apples** (same GGUF both sides), so
this is the source-of-truth serving + tool-use recipe for **Config B**. Output of a
spike — community-sourced, **not yet validated on our hardware** (the three fixes
below are the tier-64 acceptance criteria).

## Context

- Target model: `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` — the tuned **tier-64** GGUF, same
  weights claw serves. (Tier-16 uses `Qwen3.5-9B IQ4_XS`; it needs its own validation
  pass — the three 35B-A3B fixes below may not all apply to the 9B.)
- Host: Apple Silicon Mac, 64 GB tier. **vLLM is not viable** (no practical Metal
  serving for a 35B) → llama.cpp is the engine, same as claw. Ollama is the other
  native option OpenCode supports.

## TL;DR recommendation

Run a **second, OpenCode-dedicated `llama-server`** (separate port from the claw
launchd instance), **without** `claw.gbnf`, so the model emits native `<tool_call>`
that llama.cpp parses into OpenAI `tool_calls`. Three fixes below are **required to
make tool calling work at all** on this model+OS — they are not performance tuning,
so they don't compromise the "vanilla" framing.

## Required-to-function fixes (→ ticket acceptance criteria)

1. **Corrected chat template + `--jinja`.** Stock Qwen3.5/3.6 template returns
   **HTTP 500** when OpenCode sends a request whose system message isn't strictly
   first. Patched Jinja template required. [aayushgarg], [njannasch]
2. **Thinking OFF** (`--chat-template-kwargs '{"enable_thinking":false}'`). The
   35B-A3B `peg-native` parser is `root ::= tool-call`; any prose before
   `<tool_call>` fails to parse → the "naked-XML freeze." Thinking-off sidesteps it.
   [llama.cpp#20260], [opencode#24316]
   **Confirmed parity (tier-64):** claw also runs thinking OFF here — the
   `claw-llama` LiteLLM route forces `extra_body.chat_template_kwargs.enable_thinking
   = false` (`host/litellm/litellm-config.yaml`; `model_configs.json:475` "thinking
   suppressed via litellm route"), overriding the server's launch-time `true`. So
   thinking-off is **apples-to-apples at tier-64, not a B-only handicap.**
   **Tier-16 RESOLVED (issue #017 → [TIER16-THINKING-PARITY-DECISION.md](TIER16-THINKING-PARITY-DECISION.md)):
   both OFF.** claw-16 runs thinking-off under the harness — the `claw-llama` route's
   `enable_thinking:false` wins over the server's launch-time `true` (verified live on
   `Qwen3.5-9B-IQ4_XS` + build `b1-5594d13`); the manifest "forced true" note refers to
   the launch flag, not the effective per-request setting. OpenCode-16 matches with
   `--chat-template-kwargs '{"enable_thinking":false}'` — and because OpenCode has **no
   `claw.gbnf` backstop**, #018 must assert the closed-`<think></think>` prefill via
   `/apply-template` (the launch-flag syntax is deprecated on this build but still
   functions; fall back to `--reasoning off` if a future build ignores it). *Skew:*
   production claw-16 (`anthropic/claw` route) is thinking-on; the A/B measures the
   harness off-mode.
3. **No `claw.gbnf`** on this instance — OpenCode needs native tool-call emission,
   not claw's constrained wrapper.

Caveat to verify on our build: post-autoparser, some llama.cpp builds return
`tool_calls[].function.arguments` as a JSON **object** not a **string**, breaking
strict OpenAI compat. [llama.cpp#20198]

## Serving recipe (llama.cpp)

```bash
llama-server \
  --model "$HOME/.ollama/gguf/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" \
  --jinja \
  --chat-template-file host/llama-server/templates/qwen36-corrected.jinja \
  --chat-template-kwargs '{"enable_thinking":false}' \
  --host 127.0.0.1 --port 8080 \
  --ctx-size 65536 --batch-size 4096 --flash-attn on \
  --temp 0.7 --top-p 0.8 --top-k 20 --repeat-penalty 1.0 --presence-penalty 1.5 \
  -n 8192
```

- Sampler mirrors tier-64 vendor-non-thinking values in `models.conf`. `-n 8192`
  prevents tool-call arg truncation (a common "tools broken" cause).
- Ollama alternative (also OpenCode-native): set `num_ctx` ≥ 16k (default 4096
  breaks agentic loops), ship a tool-capable template, expose `:11434/v1`.

## opencode.json

```json
{
  "provider": {
    "llama-local": {
      "name": "Qwen3.6-35B-A3B (llama.cpp)",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:8080/v1" },
      "models": { "qwen3.6-35b-a3b": { "name": "Qwen3.6 35B-A3B Q4_K_XL" } }
    }
  }
}
```

## Open questions to resolve in the ticket

- ~~Source/pin a known-good corrected Qwen3.6 Jinja template; vendor it in-repo.~~
  **DONE (#004):** vendored at `host/llama-server/templates/qwen36-corrected.jinja`
  with provenance + exact fix + an on-hardware verifier — see that dir's
  [README](../../llama-server/templates/README.md). On our build the stock failure
  mode is a silently-**dropped** system message (HTTP 200), not the HTTP 500 the
  community sources reported on the upstream variant; the corrected template fixes
  both.
- ~~Confirm our llama.cpp build honors `enable_thinking` kwargs and does not hit the
  [#20198] args-type regression.~~ **RESOLVED (#006):** build `b1-5594d13` honors the
  per-request kwarg AND does **not** hit #20198 (`arguments` is a STRING). Live
  validation: [../../llama-server/docs/TOOL-CALL-VALIDATION.md](../../llama-server/docs/TOOL-CALL-VALIDATION.md).
  That validation also found the `#20260` "naked-XML freeze" did **not** reproduce on
  this build even with thinking ON — so fix #2's "required-to-function" framing above
  is stronger than `b1-5594d13` requires (thinking-off still kept for **claw-parity**,
  not freeze-avoidance). Left as-is pending human review — see the doc's Finding 2.
- Thinking-off costs reasoning quality but buys tool reliability — flag as a
  one-flag A/B sub-variant if we want to measure it.
- Docker: reach host `llama-server`/Ollama via `host.docker.internal` (per plan §4.1).

## Sources

- [aayushgarg] Local LLM in OpenCode with llama.cpp — https://aayushgarg.dev/posts/2026-03-29-local-llm-opencode/
- [njannasch] OpenCode + llama.cpp (Qwen 3.6) snippet — https://njannasch.dev/snippets/opencode-llamacpp-config/
- [llama.cpp#20260] 35B-A3B peg-native parser fails on prefix text — https://github.com/ggml-org/llama.cpp/issues/20260
- [llama.cpp#20198] tool_calls arguments type regression — https://github.com/ggml-org/llama.cpp/issues/20198
- [opencode#24316] naked tool call (35B-A3B + llama.cpp + macOS) — https://github.com/anomalyco/opencode/issues/24316
- vLLM Qwen3.5/3.6 recipe (tool-call-parser, for non-Mac hosts) — https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html
- Unsloth — Qwen3-Coder llama.cpp tool-calling fixes — https://unsloth.ai/docs/models/tutorials/qwen3-coder-how-to-run-locally
- Qwen3.6 tool-calling issues + fixes (HF discussion) — https://huggingface.co/Qwen/Qwen3.6-27B/discussions/13
