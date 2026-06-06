# Second `llama-server` launch config (tier-64)

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.2 ·
[OPENCODE-QWEN36-SETUP-GUIDE.md](../host/test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md)

## What to build

A launch configuration for a second, OpenCode-dedicated `llama-server` on its **own
port** for tier-64, serving the same GGUF as claw but with OpenCode's serving config:
the vendored corrected template + `--jinja`, **no** `claw.gbnf`, thinking-off
(`enable_thinking:false`), sampler mirroring the tier-64 values, and a generous `-n`
to avoid tool-call arg truncation. It must coexist with (not disturb) the claw
launchd instance, and is brought up/down by the phase-swap driver (#013).

Scope is the serving process itself — booting cleanly and answering health. Tool-call
correctness is validated separately in #006.

## Acceptance criteria

- [ ] Second `llama-server` starts on a distinct port from the claw instance and reports a green `/health`
- [ ] Launched with corrected template + `--jinja`, no grammar, `enable_thinking:false`, tier-64 sampler, generous `-n`
- [ ] Bringing it up does not disturb or require stopping the claw launchd instance to validate health
- [ ] Start/stop is scriptable (no interactive steps) for later use by the phase-swap driver

## Blocked by

- #004
