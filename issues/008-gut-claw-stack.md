# The gut: tag `claw-stack-final`, delete the claw production stack

**Type**: AFK (pre-decided and tag-reversible; note it stops the old production service `:11435`)

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.2, §3.4.

## What to build

The demolition, in order:

1. Tag the pre-gut commit `claw-stack-final` (the archive; reproducing the
   baseline = checkout the tag).
2. Stop and unload the claw llama-server launchd service (`:11435`) and the
   LiteLLM bridge.
3. Delete from the working tree: `client/claw-code`, `host/litellm`, the
   claw grammar(s), claw llama-server plists, and the wizard's
   litellm/clawcode steps (48/49) plus their bringup/smoke references.
4. Update the root README and wizard README to describe the opencode stack
   only, linking the decision doc and the tag for the old stack.

Leave `host/test/lib/claw.js` and the harness's claw branches in place —
their removal is #010's scoped change (keeps this PR mechanical:
production stack only).

Verify the new stack is unaffected: resident opencode server green, `oc run`
smoke passes after the deletions.

## Acceptance criteria

- [ ] `git tag` shows `claw-stack-final`; `git show claw-stack-final:client/claw-code/README.md` resolves (archive intact)
- [ ] No process listening on `:11435`/`:4000`; launchd no longer lists the claw/litellm services
- [ ] `git ls-files` shows no `client/claw-code`, `host/litellm`, claw grammar, or claw plists; wizard has no steps 48/49
- [ ] Post-gut: resident opencode server `/health` green and one `oc run` smoke passes
- [ ] READMEs updated (root + wizard) with decision-doc + tag pointers

## Blocked by

- #004
- #005
- #007
