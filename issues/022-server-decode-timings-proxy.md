# Server-decode `timings` proxy for Config B (optional)

**Type**: AFK

**Status:** 🟢 Ready — blocker #005 met (optional / post-v1)

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4, §4.7

## What to build

Capture the second `llama-server`'s `timings.prompt_ms` / `timings.predicted_ms` for
Config B so the server prompt/decode split is renderable on **both** sides (it's not
lost just because OpenCode bypasses LiteLLM — same llama.cpp engine emits the same
timings). Either parse the server's own logs or interpose a thin logging proxy on the
OpenCode→server hop. Optional / post-v1 secondary metric.

## Acceptance criteria

- [ ] Per-iteration `server_prompt_eval_ms` / `server_decode_ms` captured for Config-B runs
- [ ] Values join to the corresponding runs (keyed compatibly with the iteration records)
- [ ] The report can render server prompt/decode split for both configs when this is enabled
- [ ] When disabled, the report omits the metric (no implied parity) — no hard dependency for v1

## Blocked by

- #005
