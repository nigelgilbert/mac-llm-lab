# One tier-eval test green under OpenCode → registry row

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.3, §6

## What to build

The first end-to-end integration: run a single Family A/B tier-eval test under
`CONFIG=opencode-a` and have it pass via the workspace oracle, emitting a valid
registry row carrying `config_id: opencode-a` and the Config-B `model_config_id`.
This stitches together the oracle (#001), registry dimension (#002), manifest entry
(#003), runner (#010), and injection (#011) — proving the whole pipeline produces a
groupable row with no transcript adapter.

## Acceptance criteria

- [ ] A chosen tier-eval test runs to completion under `CONFIG=opencode-a` against the container
- [ ] Pass/fail is decided by the workspace post-script; a correct run is scored pass
- [ ] A registry row is written with `config_id: opencode-a` and the tier's Config-B `model_config_id`
- [ ] The same test still runs and rows correctly under `CONFIG=claw-rig` (no regression)

## Blocked by

- #011
- #001
- #002
- #003
