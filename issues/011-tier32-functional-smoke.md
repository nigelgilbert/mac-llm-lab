# Tier-32 functional smoke

**Type**: AFK

**Status:** ✅ Complete (2026-06-10)

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

- [x] `OPENCODE_TIER=32 opencode-server start` reaches green health; `/apply-template` shows the closed think block
- [x] Wizard smoke passes with the tier slider at 32
- [x] ≥8 harness cells at tier-32 complete with rows carrying the tier-32 fingerprint and zero harness_error
- [x] Server stopped after; resident tier-64 server unaffected

## Blocked by

- #007
- #010

## Result

**SCOPE (decision doc §4): no comparative claim is made.** Tier-32 was
adopted by extrapolation from tier-16 (same 9B at Q5_K_XL); everything
below is serving validation only. The 8 harness rows exist to prove the
serving/config/emit path, not to compare tiers.

Implemented and verified by the #011 agent (manifest/config edits, probe,
wizard smoke, 8-cell sweep, registry inspection, cleanup — all completed
in-session; early "sweep done" notifications were spurious, the agent
re-verified against the filesystem after the driver process actually
exited). Evidence preserved under `/tmp/issue-011/` (`server-start.log`,
`probe.log`, `wizard-install-tier32.log`, `sweep.log`, `state.bak`).

### Tier-32 entries (parity with other tiers)

- `host/test/lib/model_configs.json`: TWO new fingerprints (mirroring the
  tier-16 pair):
  **`qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-a`** (serving
  fingerprint for `opencode-a` and the serving-identical `opencode-a+git`)
  and **`qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-prompt`**
  (`opencode-a+prompt`; only delta `prompt_pack_version:
  pp01+agentsmd-v1`) — same weights/sampler as tier-32 production
  (Sprint 1.19 B2), serving provenance = OpenCode llama-server on `:11438`,
  corrected Jinja template, native tool_calls, thinking-off; §4 scope note
  embedded in both. `lib/config.js` wired (`'32'` in both tier maps) +
  selector test extended (tier-32 mappings + drift-guard cells; runner-image
  suite lib 140/140 + scripts 5/5).
- `models.conf` TIER_32 block, `opencode.32.json` (#003), `opencode-server`
  tier mapping `32 → :11438` (#002), wizard step-51 provision check (#006):
  already present; verified.

### Serving + thinking-off (probe.log)

`OPENCODE_TIER=32 opencode-server start` → green health on `:11438`;
`opencode-server probe` (tier-32): **all 3 checks PASS** — system-not-first
fix; thinking-off launch default (closed `<think></think>` on a plain
request); thinking-off per-request kwarg (`enable_thinking:false` → closed
prefill). The #018 corrected-template gotcha is covered by checks 1–2.

### Wizard smoke at slider 32 (wizard-install-tier32.log)

With state at TIER=32: step-61 smoke green — `oc probe` injection PASS
(wire capture saw `Instructions from: /root/.config/opencode/AGENTS.md`)
and `oc run` (tier 32, `:11438`) artifact verified
(`smoke.txt` = `WIZARD-OC-SMOKE-48985`). State restored to
full-local/TIER=64 afterward (diff vs `state.bak`: identical).

### Harness cells (sweep.log + registry)

`TIER=32 ARMS="opencode-a+prompt" SMOKE_TESTS="deep-equal wordy subtle-bug
refactor" CONFIG_AB_REPEATS=2 host/test/run-config-ab.sh` → driver rc=0,
gate rc=0 (self-paired sanity gate: 8 vs 8 eligible, 0.0pp).

Registry `run_registry.config-ab-20260610-183557.jsonl`:
**8/8 rows** with `hardware_tier: 32`, single fingerprint
`qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01-opencode-prompt`,
`config_id: opencode-a+prompt`, **zero harness_error**. Outcomes: 7 task
passes (`terminal_status: done`), 1 genuine task failure (`wordy` rep 1,
`terminal_status: timeout` — hit the 600 s per-cell cap; a clean emitted
row, not a harness error; consistent with a 9B on this panel and making
no comparative claim per §4).

### Cleanup / end-state

`:11438` stopped (orchestrator-verified port free); resident tier-64
daemon `:11436` green and untouched throughout (launchd pid 31147
unchanged); wizard state restored; no stray opencode containers.
