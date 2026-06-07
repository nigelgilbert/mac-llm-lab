# tier-16 sweep + verdict

**Type**: HITL (swaps the production claw server on :11435 to the 9B for the claw
phase; run watched, restore the 35B on exit)

**Status:** ✅ Done (2026-06-07) — tier-16 **KEEP** verdict (`49cebcb`). 512-row
paired registry, gate green; OpenCode config-(a) is **−7.7 pp** on pass-rate
(90% CI [−13.1, −2.5] pp → rule 0a.1 NOT MET) at wall-clock parity (0.96× → 0a.2
MET). Opposite of the tier-64 retire, per the independent-per-tier §0a rule. A
Phase-B serving bug (oc-16 client dialed the tier-64 port :11436) was found and
fixed (`db90963`) before the verdict run. See **Result**.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0a, §6

## What to build

Run the established tier-64 pipeline at tier-16: phase-swap driver (#013) over the 35
tasks × N=8 under both configs at `TIER=16`, then feed the dataset through the report
(#016) to produce the tier-16 verdict. Reuse all the machinery; the only new inputs
are the tier-16 second server (#018) and the tier-16 model resolution.

Remember the standing caveat: tier-16 on this 64 GB box is a **capability proxy** — it
does not reproduce 16 GB memory pressure. Label the verdict accordingly.

## Acceptance criteria

- [x] **32** tasks × N=8 run under both configs at `TIER=16`. (The "35" over-counts:
  `latency`/`prose-quality`/`tool-discipline` are claw-bridge probes that emit no row;
  4 `frontier/` tasks are claw-wired and out of scope. True A/B set = 32 — same as #014.)
  256 claw-rig + 256 opencode-a = 512 rows.
- [x] Rows carry tier-16 `config_id` + Config-B `model_config_id`
  (`qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01` / `…-opencode-a`); gate green (claw=239,
  oc=256 eligible, 32 paired / 0 unpaired).
- [x] The report renders the tier-16 verdict via the same 5 pp / 1.5× rule, evaluated
  independently from tier-64 → **KEEP** (0a.1 NOT MET, 0a.2 MET).
- [x] The report marks the tier-16 result as a capability proxy (not a 16 GB pressure
  verdict) + thinking-off harness mode.

## Result (2026-06-07)

- **Verdict doc:** [host/test/docs/OPENCODE-AB-TIER16-VERDICT.md](../host/test/docs/OPENCODE-AB-TIER16-VERDICT.md)
  (`49cebcb`). **Decision: KEEP** the claw rig at tier-16.
- **Registry (gitignored):** `host/test/.claw-runtime/run_registry.config-ab-20260607-062848.jsonl`
  — 512 rows (256/256), 32 paired tasks. Bootstrap seed `0xc0ffee`, B=10000.
- **0a.1 (pass-rate):** claw 84.3% vs oc 76.6% mean per-task; aggregate **−7.7 pp**,
  90% paired-bootstrap CI **[−13.1, −2.5] pp** (seed-stable; excludes 0 → oc
  significantly worse) → **NOT MET**. Sensitivity (claw context-overflow drops counted
  as fails, symmetric with oc timeouts): −5.5 pp — still beyond the −5 pp margin, so the
  KEEP is robust to the eligibility convention.
- **0a.2 (wall-clock):** oc median 23.5 s vs claw 24.4 s = **0.96×** → MET (parity, not
  the ~1.6× speedup seen at tier-64).
- **Why opposite of tier-64:** the weaker 9B leans on the claw bundle's grammar +
  system-prompt scaffolding that the 35B-A3B did not need. The bundle's value is
  model-strength-dependent — valid under the per-tier-independent §0a rule.
- **Serving (HITL, watched):** claw phase ran the 9B on `:11435` (swapped from the 35B,
  thinking-off via the `anthropic/claw-llama` route, `/apply-template` re-verified);
  oc-16 9B on `:11437` (`probe` 3/3). Production `:11435` **restored to the 35B and
  confirmed green** on exit.
- **Phase-B bug found + fixed:** the original sweep's Phase B dialed the tier-64 oc port
  `:11436` (a #018 gap — server stood up on :11437 but the OpenCode client config was
  tier-64-hardcoded), so every oc cell ConnectionRefused-timed-out (`iters=1`, 0 tokens).
  Fixed in `db90963` (tier-16 `opencode.16.json` + tier-selectable compose mount + driver
  wiring + new `SKIP_PHASE_A` reuse mode). The valid claw Phase A was reused; the discarded
  broken Phase B is preserved at `run_registry.config-ab-20260606-230902.jsonl` for audit.
- **Deferred (honestly noted, same as tier-64):** token parity (schema has no token field;
  → #021) and server-decode split (`OPENCODE_SERVER_TIMINGS` OFF; #021/#022 count_mismatch).

## Blocked by

- #018
- #014
- #016
