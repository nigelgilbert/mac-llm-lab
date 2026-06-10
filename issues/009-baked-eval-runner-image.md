# Baked eval-runner image (kill apk-add-per-sweep)

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.8, §3.5.

## What to build

A small dedicated runner image (node + git + docker CLI/compose preinstalled)
to replace the stock `docker:cli` + `apk add --no-cache nodejs
docker-cli-compose coreutils git` incantation that the A/B driver currently
performs on **every sweep**. Point the driver's OpenCode phase at the baked
image; keep the path-matched repo mount + live-sources contract and the
`/workspace` bind exactly as today (the mount-contract failure modes are
documented in the driver's comments — preserve the fail-fast checks).

Independently valuable and unblocked: it speeds every future sweep and is a
prerequisite cleanup for the harness rewrite (#010).

## Acceptance criteria

- [ ] Runner image builds reproducibly (compose or Makefile target documented in the driver header)
- [ ] One-cell tier-16 sweep (`SMOKE_TESTS=deep-equal`, reuse-registry mode) completes green with the new image and the sweep log contains zero `apk` lines
- [ ] Phase startup time (container start → first cell line) measured before/after, recorded in Result
- [ ] Driver preflight fails loud with a build hint when the runner image is missing

## Blocked by

None - can start immediately
