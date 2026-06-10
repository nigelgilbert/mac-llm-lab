# Tier-32 functional smoke

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.7, §3.6.

## What to build

Validate the opencode stack at tier-32 (same 9B as tier-16 at Q5_K_XL —
adopted by extrapolation, so this is serving validation, **not** a
comparative claim):

- tier-32 entries wherever the other tiers have them: models.conf serving
  params, opencode config, `opencode-server` tier mapping/port,
  model-config manifest fingerprint,
- thinking-off verified via the `/apply-template` closed-think-block check
  (the corrected-template gotcha from #018 of the old suite applies),
- wizard smoke green at tier-32, plus a handful of oc+prompt harness cells
  (e.g. 4 tasks × N=2) emitting clean registry rows at
  `hardware_tier: 32`.

Document in the Result section that no comparative claim is made (decision
doc §4 scope boundary).

## Acceptance criteria

- [ ] `OPENCODE_TIER=32 opencode-server start` reaches green health; `/apply-template` shows the closed think block
- [ ] Wizard smoke passes with the tier slider at 32
- [ ] ≥8 harness cells at tier-32 complete with rows carrying the tier-32 fingerprint and zero harness_error
- [ ] Server stopped after; resident tier-64 server unaffected

## Blocked by

- #007
- #010
