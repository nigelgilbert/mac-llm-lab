# Wizard: opencode serving steps (resident daemon + per-tier configs)

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.5, §3.3.

## What to build

Teach the wizard to provision the OpenCode serving layer the way #002 builds
it by hand: a step that installs/loads the launchd resident server for the
detected tier (corrected template, thinking-off, tier sampler from
models.conf) and verifies health, in the wizard's pure-bash, curl-only,
strictly idempotent check-then-act style ("✓ already done" on re-run; never
bootout a running service). The existing model-fetch and llama-server steps
stay; this step replaces the claw-server's role for new installs. Both
topologies (full-local / client-only) must keep working — client-only skips
serving entirely.

Do not remove the litellm/clawcode steps yet (that's #008's edit); this issue
only adds the opencode serving path so a fresh install can produce the new
stack's host half.

## Acceptance criteria

- [ ] `./wizard/wizard install` on this machine reaches a green opencode resident server step; second run prints the idempotent "already done" path (transcript in Result)
- [ ] `./wizard/wizard doctor` reports the opencode serving state read-only
- [ ] Tier slider override provisions the corresponding tier's config (verified for one non-default tier without leaving its server resident)
- [ ] client-only topology run skips serving with no error

## Blocked by

- #002
