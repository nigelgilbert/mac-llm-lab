# OpenCode compose + provider config

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.1 ·
[OPENCODE-QWEN36-SETUP-GUIDE.md](../host/test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md)

## What to build

A `docker-compose.yml` for the OpenCode container plus the `opencode.json` provider
config. Mount `${WORKSPACE}:/workspace`. Point OpenCode at the **second
`llama-server`** via `host.docker.internal:<port>/v1` using the
`@ai-sdk/openai-compatible` provider — no `ANTHROPIC_BASE_URL`, no LiteLLM. The
`opencode.json` is baked into the image or mounted.

## Acceptance criteria

- [ ] `client/opencode/docker-compose.yml` mounts `${WORKSPACE}:/workspace`
- [ ] `opencode.json` defines an `openai-compatible` provider with `baseURL` → `host.docker.internal:<port>/v1` and the model id
- [ ] From inside the container, OpenCode can reach the host's second `llama-server` (connectivity verified)
- [ ] No `ANTHROPIC_BASE_URL` / bridge plumbing on this side

## Blocked by

- #007
- #005
