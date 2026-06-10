# `oc` wrapper CLI: one command from any repo to the agent

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.10, §3.2.

## What to build

A small wrapper command (`oc`) that makes the containerized OpenCode feel
native:

- asserts the resident tier-64 server is green (starts it via the launchd
  service if not), then
- runs the OpenCode container with `$PWD` mounted at `/workspace`, the
  tier-matched opencode config, and the prompt-delivery mechanism chosen by
  #001 — interactive TUI by default, `oc run "<prompt>"` for headless,
- selects tier via flag/env (`oc -t 16 …` boots the on-demand tier first),
- **fails loud if prompt injection preconditions are missing** (e.g. not in a
  git repo when the per-repo mechanism is in play) — injection failure is
  silent in OpenCode, so the wrapper owns the assertion.

Container-first is architectural (decision 4): the wrapper hides the
container, it does not replace it. The sandbox walls protect everything
outside the mounted workspace; the workspace itself is the agent's to edit.

## Acceptance criteria

- [ ] From an arbitrary git repo: `oc run "create hello.txt containing hi"` produces the file, with the resident server, in one command with no manual setup
- [ ] TUI session opens via bare `oc` and tool calls operate on `$PWD`
- [ ] Prompt injection verified end-to-end once via the PROOF oracle through the wrapper itself
- [ ] `oc -t 16` boots the tier-16 server on demand and runs against it; server stopped after (or documented as left up)
- [ ] Running outside the preconditions (per #001's mechanism) exits non-zero with an explanatory message

## Blocked by

- #001
- #002
