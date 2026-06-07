# Report + non-inferiority verdict

**Type**: AFK

**Status:** ✅ Done — tier-64 verdict rendered from the verified #014 dataset; both
pre-registered §0a rules MET → **retire the claw rig at tier-64** (OpenCode superior on
pass-rate, 0.61× wall-clock). Verdict doc
[OPENCODE-AB-TIER64-VERDICT.md](../host/test/docs/OPENCODE-AB-TIER64-VERDICT.md), renderer
[config-ab-verdict.mjs](../host/test/scripts/config-ab-verdict.mjs) (reuses #015
`paired_bootstrap` + `registry.js`). Every figure re-derived from the 512-row registry, not
copied. Status sha: `3129860`. See **Result** below.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0a, §4.7

## What to build

A report that consumes the #015 statistics over the #014 dataset and renders the
pre-registered decision. Headline pass-rate, then wall-clock; apply the **retire
rule** per tier: non-inferior iff the 90% paired-bootstrap CI lower bound on
`(B − claw)` is `> −5 pp` **and** OpenCode median wall-clock `≤ 1.5×` claw's. Show
per-task deltas so a single regressed task is visible, and emit a provenance line per
side (model + serving config + prompt). Evaluate tier-64 independently.

## Acceptance criteria

- [x] Report renders per-tier: aggregate pass-rates, the `(B − claw)` delta + 90% CI lower
  bound, and median wall-clock ratio. (tier-64: +3.1pp, 90% CI [+0.8, +6.3]pp, oc/claw
  median ratio 0.61×. Renderer reuses `pairedBootstrapCI`; figures re-derived, not copied.)
- [x] The retire/keep verdict is computed from the two-condition rule (5 pp margin AND
  1.5× wall-clock). Both MET → **retire tier-64**; computed in the renderer, not asserted.
- [x] Per-task deltas are listed; regressions are not averaged away. (32-row table; every
  delta ≥ 0 — no regression; largest `expression-eval` +50pp.)
- [x] A provenance line per side states model + serving config + prompt. (Same GGUF / quant
  / ctx / sampler `v1-prod` / thinking-off both sides; distinct `model_config_id`
  serving fingerprint for opencode-a.)
- [x] Server-decode timing is omitted unless built (not implied); tier-64 verdict stands
  alone. (Omitted + explicitly deferred — #014 ran `OPENCODE_SERVER_TIMINGS` OFF; tokens
  also noted absent from the schema. tier-16 scoped out to #019.)

## Result (2026-06-06)

- **Verdict doc:** [OPENCODE-AB-TIER64-VERDICT.md](../host/test/docs/OPENCODE-AB-TIER64-VERDICT.md)
  — auditable; states apples-to-apples conditions, per-task table, attrition, iteration
  parity, deferred token/server-decode notes, and the adoption call.
- **Renderer:** [config-ab-verdict.mjs](../host/test/scripts/config-ab-verdict.mjs)
  re-derives every figure from the registry via `lib/paired_bootstrap.js` +
  `lib/registry.js` (seeded B=10000 / `0xc0ffee`; stable across seeds). Reproduce command
  in the doc.
- **Decision:** Rule 0a.1 MET (CI lower +0.8pp > −5pp; excludes 0 → superior); Rule 0a.2
  MET (0.61× ≤ 1.5×) → **RETIRE the claw serving stack at tier-64**. tier-16 = #019.
- **Re-derived correction:** claw median wall-clock is **21.7 s / 0.61×** from the rows
  (the #014 Result line's 21.9 s / 0.60× was slightly off); decision unchanged.

## Blocked by

- #015 (done)
- #014 (done)
