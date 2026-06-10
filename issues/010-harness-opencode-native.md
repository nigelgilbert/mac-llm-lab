# Harness opencode-native: delete the claw half, generic config-vs-config driver

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.8, §3.5.

## What to build

Make the eval harness opencode-native now that the production claw stack is
gone (#008):

- delete `lib/claw.js` and every claw branch in `runAgent`/`config`/
  reporters/entrypoint (the claw-rig config_id stays valid in the registry
  *schema* — historical rows in the preserved registries must keep
  validating — but is no longer runnable),
- generalize the phase-swap driver from its claw-vs-opencode shape into a
  config-vs-config driver: N arms from a list, any arm pairable as
  `--treatment`/`--baseline` (the analysis scripts already accept these
  flags), reuse-existing-rows mode kept,
- keep untouched: the 32-task panel, `runAgent`'s workspace pass oracle,
  registry/reporter, paired bootstrap,
- prune claw-only knobs (PHASE_SWAP launchd headroom dance, bridge health
  preflights) and their doc references.

Future A/Bs this enables, for the record: prompt variants, samplers, models,
thinking on/off — all as opencode arms.

## Acceptance criteria

- [ ] `grep -ri 'runClaw\|claw\.js' host/test/lib host/test/scripts` returns nothing; unit tests green after deletion
- [ ] A two-arm demo sweep (e.g. `opencode-a+git` vs `opencode-a+prompt`, 1 cell each) runs through the generalized driver and gates with explicit `--treatment/--baseline`
- [ ] Committed historical registries still pass schema validation / verdict re-derivation (claw-rig rows readable, not runnable)
- [ ] Driver header documents the new arm/baseline interface; stale claw references removed from harness docs

## Blocked by

- #008
- #009
