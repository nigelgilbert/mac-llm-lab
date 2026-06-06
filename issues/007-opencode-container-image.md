# OpenCode container image

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.1

## What to build

A `client/opencode/` Dockerfile mirroring `client/claw-code/Dockerfile` but simpler —
OpenCode ships prebuilt binaries, so there's no Rust build stage. Pin the OpenCode
version via a build arg. Scope is just a buildable image with a working `opencode`
binary; wiring to a model and workspace happens in #008.

## Acceptance criteria

- [ ] `client/opencode/Dockerfile` builds an image with the `opencode` binary on PATH
- [ ] OpenCode version pinned via build arg
- [ ] `opencode --version` runs inside the container and reports the pinned version
- [ ] Image layering mirrors the claw-code container conventions (base, node/git as needed)

## Blocked by

None - can start immediately
