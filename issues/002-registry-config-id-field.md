# Registry `config_id` dimension

**Type**: AFK

**Status:** ✅ Done — 1f37e86

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.5

## What to build

Add a `config_id` field to the run-registry schema and row assembly so the two
bundles are groupable before any data is collected. Allowed values: `claw-rig` |
`opencode-a`.

The schema is currently `additionalProperties: false`, so the new field must be added
to the schema (and the `required` list) as well as to row assembly in `run_row.js`,
threaded from the runner/driver context. `config_id` is the **coarse bundle label**;
it is complementary to `model_config_id` (the fine-grained serving fingerprint added
in #003), not a replacement.

## Acceptance criteria

- [x] `config_id` added to the run-registry JSON schema with an enum of `claw-rig` | `opencode-a`
- [x] Row assembly populates `config_id` from run context; existing claw runs default to `claw-rig`
- [x] A row carrying a valid `config_id` validates; an out-of-enum value fails validation
- [x] A row missing `config_id` is handled explicitly (rejected, or defaulted with the decision recorded)

## Blocked by

None - can start immediately
