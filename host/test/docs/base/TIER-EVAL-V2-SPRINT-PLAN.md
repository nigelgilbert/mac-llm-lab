# Tier-Eval Suite v2 — Sprint Plan

**Date:** 2026-04-29
**Status:** Sprint 0 closed. Sprint 1 closed through 1.19 (2026-05-02). Sprint 1.20 (t16 harness-error triage) and 1.21 (difficulty-extension test pack) logged as open follow-ups before Sprint 2.
**Source:** Derived from `Tier-Eval Suite Improvement Plan V2` (2026-04-29) plus the Q&A below.
**Audience:** Harness engineers continuing this work across sessions/compactions.

---

## Plan philosophy

Sprint 0 is a hard gate: rows produced before the canonical schema lands become legacy-asterisked the moment it ships.

This iteration ships five things, in order:

1. Phase 0 foundation — registry, manifests, decision rule, thermal policy.
2. One overnight cross-tier screen (Phase 1A) under the new schema.
3. Discrimination matrix v1 — screening labels only, no test drops.
4. Productivity grader **design** + calibration set — no productivity tests in core matrix yet.
5. Hidden-holdout policy + Stage 0–4 model-trial funnel skeleton.

**Deferred to next iteration:** DOE/sampler comparisons, full agentive expansion, frontier stress tests, new coding test families.

---

## Decisions captured 2026-04-29 (locked)

| Question | Decision |
|---|---|
| Tier emulation vs. physical hardware | Single M5 Max MBP, serial. Tier configs swapped between runs. Apple SoC family treated as homogeneous in latency/throughput until evidence shows otherwise. Three-machine parallel is not available; do not re-pitch. |
| Schema: `hardware_id` | Dropped. One physical machine per tier. |
| Schema: `soc_generation` | Dropped. Decorative-only on a single machine. Reintroduce `machine_label` if a second physical unit lands. |
| Canonical hardware fields | `hardware_tier` (16/32/64) + `memory_gb`. |
| Hidden-holdout storage | `host/test/__tests__/tier-eval-hidden/` (gitignored). Stage 3 emits visible warning if missing — never silently passes. |
| Productivity judge | `claude-opus-4-7` via Claude API. Version recorded per row. Prompt caching on system + rubric. Local model never grades itself or peers. |
| Sprint 1 latency labeling | Mandatory: every row records latency as **single-hardware config latency**, not final product-tier latency. |

---

## Sprint 0 — Phase 0 foundation (gating)

**Goal:** every subsequent run lands in the registry with provenance.

| # | Deliverable | Lands in |
|---|---|---|
| 0.1 | `run_registry.schema.json` per §6.2 minus `hardware_id`/`soc_generation`. Includes `canonical_status` enum (`canonical`/`legacy-compatible`/`legacy-asterisked`/`excluded`) and `thermal_status` enum (`clean`/`warning`/`contaminated`/`unknown`). | `host/test/lib/registry.js` + JSON schema sidecar. |
| 0.2 | `model_config.schema.json` — 9 fields per §5.3. | `host/test/lib/`. |
| 0.3 | `test_manifest.schema.json` — primary axis, secondary axes, suite layer (A/B/C/D), difficulty band, oracle type, known confounds, keep/drop rule. | `host/test/lib/`. |
| 0.4 | Migrate 35 tier-eval files to declare manifest header. Test bodies untouched. | `host/test/__tests__/tier-eval/*.test.js`. |
| 0.5 | Historical bucketing pass: every existing CSV/run gets a status. | `host/test/docs/historical_bucketing.csv`. |
| 0.6 | §9.2 decision rule: 25 pp + non-overlapping 80% Wilson, plus `provisional_discriminator` label. | `host/test/docs/EVAL-DESIGN.md` addendum. |
| 0.7 | Thermal telemetry hook: start/end/peak SoC temp + tokens/sec. macOS best-effort. | `host/test/lib/telemetry.js`. |
| 0.8 | Hidden-holdout policy memo (storage path, rotation, access). **No holdouts authored.** | `host/test/docs/`. |
| 0.9 | Productivity-grader design memo. Pinned to `claude-opus-4-7`. Calibration spec, Opus budget. **Design only.** | `host/test/docs/`. |

**Sign-off gate (all four required before Sprint 1):**

1. Single dry-run lands in registry with all mandatory fields.
2. Smoke run on each tier emits `thermal_status` and a resolvable `model_config_id`.
3. Historical bucketing index reviewed; legacy comparisons display bucket label.
4. §9.2 decision rule signed off in writing.

**Scope discipline:** no test-body edits beyond manifest headers. No new tests, graders, or model trials.

---

## Sprint 1 — Overnight cross-tier screen (Phase 1A)

**Goal:** first cross-tier signal under the new schema.

| Setting | Value |
|---|---|
| `run_kind` | `overnight_screen`. |
| Hardware | Single M5 Max MBP, serial. tier-16/32/64 by config swap. |
| Tier coverage | Full tier-16 + tier-32. tier-64 reused from canonical-compatible historical when available + 5-test × n=5–10 anchor panel. Fallback if no compatible history: t16+t32+t64 at n=8. |
| Tests | Existing 35-test set with manifests. No new productivity/agentive families. |
| Sampler | One — current product/default. No v3-deterministic. |
| n | 10/cell; drop to 8 globally if projected runtime exceeds overnight. |
| Order | Interleave by tier × test × seed. |
| Thermal | Telemetry only, no blanket cooldown (would consume meaningful overnight budget on serial HW). Flag warning/contaminated rows. |
| Hard stop | If wall clock projects past next workday, finish coverage at lower n. Don't deepen any cell. |
| Output | `screening_only=true` on every row. |

**Tight-night fallback:** one test per axis from §8 Phase 1A priority subset. Substitute closest sibling if missing.

**Allowed conclusions:** "candidate discriminator", "appears ceiling/floor", "axis appears tier-sensitive", "run was contaminated".
**Forbidden conclusions:** drop a test permanently, model passes admission, definitive tier deltas, sampler comparisons.

---

## Sprint 1.5 — Code review + maintenance-surface audit (gate to Sprint 2)

**Goal:** trim Sprint 0–1 infra before Sprint 2 makes it load-bearing.

**Why now:** Sprint 2's matrix builder reads the registry, manifests, and telemetry hooks. Whatever lives there at Sprint 2 kickoff becomes load-bearing for axis scorecard, confirmatory planning, productivity grader wiring, and hidden-holdout admission.

**Deliverable:** [CODE-REVIEW.md](CODE-REVIEW.md) — one row per item with: what it is, maintenance-surface cost (the load-bearing column — not engineer-hours; we're parallel-agentic and eval-wallclock-bound), removal cost, what's lost, verdict (`keep`/`cut`/`defer-decision`).

- `cut` items → follow-on engineering tasks scoped before Sprint 2.
- `defer-decision` items → written tripwire ("revisit if X happens").

**Initial slate (expandable):**

| # | Item | Initial concern |
|---|---|---|
| 1.5.1 | 4-state `canonical_status` enum | Could be 2-state + free-text `provenance_note`. Only meaningful if downstream tooling branches on the 4 states. |
| 1.5.2 | Thermal-watch (`pmset` hint + drift advisory) | 0/650 pmset_contaminated rows in 1.18; lab runs 24/7 under external fan. **Verdict: cut.** |
| 1.5.3 | `expected-attempts.mjs` plan-vs-diff layer | Used and earning keep; verify no dead paths. |
| 1.5.4 | Telemetry library split (`captureThermalStatus` / `captureThroughputAdvisory`) | Couples to 1.5.2; cut as part of same follow-on. |

**Retained without review entry:** 3-schema split, Stage 0–4 funnel memo, hidden-holdout memo, productivity-grader memo. Maintenance cost ≈ 0; locking value real.

**Sign-off:**
- Every slate item has a verdict.
- All `cut` items merged or written reason for delay.
- All `defer-decision` items have a tripwire.
- Schema files reflect verdicts (e.g. enum collapse → migrate or grandfather historical rows).

**Out of scope:** new features; reopening §9.2, hidden-holdout, or productivity-grader policy decisions.

**Envelope:** ~1 day. Per-row review parallelizable across agents.

---

## Sprint 2 — Discrimination matrix v1 + confirmatory plan

**Goal:** classify tests as screening candidates; pick which deserve confirmatory night.

**Deliverables:**

- `discrimination_matrix_v1.csv` with §8 Phase 2 columns: pass rates + Wilson CIs, point spread, credible-spread flag, monotonicity, harness-error rate, thermal-contamination rate, p90 iters/wallclock, dominant trace tags, oracle type.
- Per-test classification (§9.2): `core_discriminator_candidate`, `provisional_discriminator`, `likely_ceiling`, `likely_floor`, `noisy_diagnostic`, `harness_contaminated`, `thermal_contaminated`. Screening-only — no keep/drop yet.
- Confirmatory-night plan: top ~6–10 `provisional_discriminator` cells. n from §9.3 power calc against 25 pp target. Paired seeds.
- Axis scorecard v1 (§8 Phase 3) with explicit "Not measured" for productivity. No aggregate score.

**Forbidden in any leadership-facing artifact:** "tier-32 scored X%".

---

## Sprint 3 — Productivity grader + calibration set

**Goal:** make productivity grading credible **before** it enters the matrix. §10.3: 1–2 sprint weeks.

**Deliverables:**

- Pinned judge `claude-opus-4-7`. Version per row.
- Calibration set: ~30 examples per family across pass/fail/borderline. Start with §10.1 cheapest two: changelog summarization + email rewrite.
- Two humans grade calibration; disagreement adjudication recorded.
- Judge–human agreement measured; "trust at scale" threshold written.
- Hybrid grader scaffolding (deterministic + semantic match + judge), wired to two pilot productivity tests as `run_kind=pilot`. Not in core matrix yet.
- Prompt caching on system + rubric.

Productivity enters Layer B core only after sprint review confirms judge–human agreement is acceptable.

---

## Sprint 4 — Hidden holdouts + model-trial protocol skeleton

**Goal:** make §15's Stage 0–4 funnel implementable so the next model trial doesn't enter through ad-hoc tuning.

**Deliverables:**

- `host/test/__tests__/tier-eval-hidden/` created + gitignored.
- One hidden sibling per Layer-B core test (small reserve pool), authored from §7.4 generalization patterns.
- Rotation cadence committed in writing.
- `host/test/run-model-trial.sh` skeleton: Stage 0 (fit/harness gate) → Stage 1 (public core) → Stage 3 (hidden admission). **Stage 2 (config tuning) stays manual.**
- Empty/missing `tier-eval-hidden/` → Stage 3 emits visible warning, never silent pass.

Sprint 4 can run parallel with Sprint 3 once Sprint 0 lands.

---

## Out of scope for this iteration

- Sampler/prompt DOE (§14.3) — needs baseline matrix first.
- New coding test families from §12.
- Frontier/stress suite (Layer D).
- Multi-physical-machine thermal isolation beyond telemetry + flagging.
- Public leadership-facing scorecard. All output this iteration is internal R&D evidence.

---

## Rough timeline (planning, not commitment)

| Sprint | Wall clock | Notes |
|---|---|---|
| 0 | 1.5–2 weeks | Schema + migration + manifest tagging is long pole. |
| 1 | 1 night + 1 day analysis | Triggered on Sprint 0 sign-off. |
| 2 | 3–5 days + 1 confirmatory night. | |
| 3 | 1.5–2 weeks | Gated on human reviewer availability. |
| 4 | 1 week | Parallel with Sprint 3. |

Total: ~5–6 weeks if 3+4 overlap. §9.3 caveat: `n=40` is a starting point, not a power guarantee — recompute per comparison.

---

## Resume cheatsheet (for fresh sessions / post-`/compact`)

1. Sections 1–2 = strategic frame + locked decisions.
2. Check §"Sprint 0 status" / "Sprint 1 status" for current position.
3. Sprint 0 is the only sprint that can run before any tests are written. Don't skip ahead.
4. If Sprint 0 partially done, resume at lowest-numbered incomplete deliverable.
5. Verify Sprint 0 sign-off gate before any sweep.
6. Hardware is **single M5 Max MBP, serial.** Three-machine parallel is not available. Don't re-pitch.

**Repo landmarks:**
- Tier-eval tests: `host/test/__tests__/tier-eval/` (35 files; 26 emit-eligible post-trim 1.16c)
- Runner library: `host/test/lib/` (`claw.js`, `tier.js`, `model.js`, `backend.js`, `bridge.js`, `workspace.js`, `telemetry.js`, `run_row.js`, `registry.js`, `model_config.js`, `test_manifest.js`)
- Entry script: `host/test/run-tier-eval.sh`
- Overnight wrapper: `host/test/scripts/run-overnight-screen.sh`
- W1 sidecar: `/workspace/.claw-runtime/<run-id>/`
- Adjacent docs: `EVAL-DESIGN.md`, `EVAL-CALIBRATION-REPORT.md`, `NEW-EVALS-REPORT.md`, `TIER-EVAL-MEMO-20260428-*.md`

---

## Sprint 0 status — CLOSED 2026-04-29

| # | Deliverable | Status |
|---|---|---|
| 0.1 | `run_registry.schema.json` + `registry.js` | **done** — 26 fields (12 required), append-only JSONL, structural validation only, `RUN_REGISTRY_PATH` overridable. |
| 0.2 | `model_config.schema.json` | **done** — 9 required + 4 optional (incl. `sampler_settings`, `tier_compatibility`). Accessor `lib/model_config.js` (`resolveConfig`/`listConfigs`). Empty manifest = "no configs registered". |
| 0.3 | `test_manifest.schema.json` | **done** — 7 required + 5 optional. `/** @manifest { ... } */` JSDoc header. Accessor parses without importing test (avoids `node:test` registration side effects). Rejects manifests where `secondary_axes` includes `primary_axis`. |
| 0.4 | 35 tier-eval manifest headers | **done** — `/tmp/insert_manifests.py` (idempotent). All 35 validate. Distribution: primary_axis = spec_precision 12 / convergence 7 / tool_discipline 5 / stateful_logic 5 / multi_file_context 4 / local_usability 1 / productivity 1 (only `prose-quality` — confirms §2.2's gap). Suite: B 32, A 2 (`latency`, `tool-discipline`), C 1 (`long-horizon-bugs`). Oracle: public_verifier 33, rubric 2. |
| 0.5 | `historical_bucketing.csv` | **done** — 9 rows. 120-row prod CSV `legacy-compatible` (assumes `hardware_tier=64`, `oracle_type=public_verifier`, `thermal_status=unknown`, backfilled `model_config_id`). 2026-04-28 archive `legacy-asterisked`. W4 indices + 0-row partial-sweep `excluded`. ~351 `.claw-runtime/` dirs `legacy-compatible`. |
| 0.6 | EVAL-DESIGN addendum | **done** — codifies two-stage screen-then-confirm, 25 pp + 80% Wilson rule, seven discrimination labels (incl. `provisional_discriminator`), power-derived-N for admission, prohibition on aggregate scores externally. Existing eight-rules section unchanged. |
| 0.7 | Thermal telemetry | **done (library-only)** — `lib/telemetry.js` (`captureThermalStatus`, `captureThroughputSignal`). Host: `scripts/thermal-watch.sh` polls `pmset -g therm` once/sec, sudo-free. Wiring into row assembly deferred to Sprint 1. |
| 0.8 | Hidden-holdout policy | **done** — `docs/HIDDEN-HOLDOUT-POLICY.md`. Storage `host/test/__tests__/tier-eval-hidden/` (gitignored), naming `<public_test_id>-h`, quarterly rotation, ≥2 per-axis reserve, retire-on-suspicion, no-leak reporting, Sprint-4 Stage-3 contract (visible warning + `admission_status=skipped` if empty — silent passes forbidden). No holdouts yet. |
| 0.9 | Productivity-grader notes | **moved to research/** (2026-05-01) — `research/productivity-grader-notes.md`. Not commitment material; re-derive when a real productivity-grading need arises. |

**Sign-off — all four met 2026-04-29:** dry-run lands fully-populated row; smoke emits `thermal_status` + resolvable `model_config_id` (3 tier baselines in `lib/model_configs.json`: t16 Qwen2.5-7B Q5_K_M, t32 Qwen3-14B Q4_K_M, t64 Qwen3.6-35B-A3B UD-Q4_K_XL); historical bucketed; decision rule written. `/tmp/sprint1-smoke.mjs` 28/28 in `node:24-bookworm-slim`.

---

## Sprint 1 status (live)

| # | Deliverable | Status |
|---|---|---|
| 1.0 | `lib/model_configs.json` (3 tier baselines) | **done** — sourced from `host/llama-server/models.conf`. `runtime_backend=llama-server@unknown` until real SHA captured at sweep time. |
| 1.1 | `lib/run_row.js` | **done** — `assembleRow(clawResult, ctx)` joins claw sidecar + manifest + thermal hint into a schema-conformant row; `emitRow` validates + appends. Reads `assertion_result.json` for authoritative `passed`. |
| 1.2 | `scripts/harvest-runs-to-registry.mjs` | **done** — offline harvester. Walks `/workspace/.claw-runtime/<run-id>/`, joins by `test_id`. `--ctx` JSON carries static fields. Caveat: thermal hint reflects harvest time → for late harvests, `thermal_status` falls back to throughput drift. |
| 1.3 | `scripts/registry-to-csv.mjs` | **done** — flattens JSONL to CSV (columns from schema property order; evolves with schema). Filters: `--bucket`, `--run-kind`, `--tier`. |
| 1.4 | Sprint 1 sign-off smoke | **done** — `/tmp/sprint1-smoke.mjs` 28/28 in `node:24-bookworm-slim`. Validates assemble→validate→append→harvest→CSV, including contaminated-throughput case. |
| 1.5 | Per-test auto-emit | **done** — `lib/claw.js`'s `writeAssertionResult` emits a row when `RUN_REGISTRY_EMIT=1`, joining `test_id` from `run_summary.json` to `test_version` + `oracle_type` via manifest header. Static fields from envs (`RUN_REGISTRY_KIND`, `_HARDWARE_TIER`, `_MODEL_CONFIG_ID`, `_HARNESS_VERSION`). Best-effort: emission failures stderr but never throw. `/tmp/sprint1-emit-smoke.mjs` 14/14. No tier-eval test body touched. |
| 1.6 | Overnight-screen wrapper | **done** — `scripts/run-overnight-screen.sh`. Wraps per-tier plist-swap with `EVAL_REPS` outer loop, sweep-specific `RUN_REGISTRY_PATH`, full registry-env passthrough. `DRY_RUN=1` exits before first plist swap. Order: rep-outer × tier-middle × test-inner (~3 swaps/rep, not 600/night). Acceptable for screening, not admission. |
| 1.7 | Thermal hint path bugfix | **done** — `lib/telemetry.js` was reading `/workspace/.thermal-hint.json`; `thermal-watch.sh` writes to `/workspace/.claw-runtime/.thermal-hint.json`. Aligned. Sprint 0 smoke masked this by setting up the hint at the buggy path itself. |
| 1.8 | Real-claw confirmatory (tier-64, single test) | **done** 2026-04-29 — `agent-single.test.js` in rebuilt container with `RUN_REGISTRY_EMIT=1` + live `thermal-watch.sh`. One fully-populated row. Two issues fixed inline: (a) `test_id` was null because tier-eval tests don't set `ITER_DIST_TEST_ID` → `runClaw` now infers from caller stack frame; (b) test image must be rebuilt (`docker compose build test`) when `lib/` changes. |
| 1.9 | Multi-tier confirmatory (16→32→64, EVAL_REPS=1) | **done** 2026-04-29 — 80 min wallclock, plist swaps clean (t32 cold-load 4s, t64 cold-load 6s). 32 rows: t16 9 (2P/7F), t32 11 (3P/8F), t64 12 (12P/0F). Auto-emit fired on every `runClaw` test calling `writeAssertionResult`. Six perfect FAIL→FAIL→PASS discriminators (`csv-parser`, `deep-equal`, `eight-functions`, `large-refactor`, `lru-cache`, `tool-confusion-redundant-verifies`). One ceiling/floor (`agent-single` PASS at all 3 tiers). Throughput-drift fired 4/9 t16 vs 1/12 t64 — likely real warmup-pattern signal on smaller models. |
| 1.10 | Coverage gap fix: 23/35 tests didn't call `writeAssertionResult` | **done** 2026-04-29 — added emit to 20 emit-eligible tests (every `runClaw` test except 3 streamMessage-exempt: `latency`, `tool-discipline`, `prose-quality`). Pattern: compute `passed` from `r.code===0` AND target-file-exists AND post-script `status===0`; insert before assert chain so failed test still produces row. Tier-64 smoke: 31 rows (vs 12 in 1.9), all pass on t64, manifest joins clean. `mini-vm` missing — claw timed out at 240s → addressed by 1.13. Throughput-drift `contaminated` fired 5/31 on cleanest tier — threshold tuning still pending. |
| 1.11 | Wrapper CSV export bug | **fixed** — `run-overnight-screen.sh` called `node` directly on host (not installed). Switched to `docker run --rm node:24-bookworm-slim`. JSONL is authoritative; warning didn't fail sweep. |
| 1.12 | Demote drift-only thermal flags to advisory | **done** 2026-04-29 — `lib/telemetry.js` split: `captureThroughputSignal` → `captureThroughputAdvisory` returning `{advisory, drop_pct, ...}`. `combineStatuses` removed. `PMSET_LEVELS` rename `contaminated` → `pmset_contaminated`. `lib/run_row.js`: `thermal_status = thermalHint.status` (pmset only); new `thermal_drift_advisory` boolean column. Schema enum `{clean, warning, pmset_contaminated, unknown}` + `thermal_drift_advisory: boolean`. `/tmp/sprint1-12-smoke.mjs` 10/10. |
| 1.13 | Timeout-as-row + schema loosening | **done** 2026-04-29 — `runClaw` resolves with `{code: null, signal: null, timeout: true, terminal_status: 'timeout', ...}` instead of rejecting. `maybeEmitRegistryRow` propagates `code: null`. No schema change needed: `passed` already `[boolean, null]`, `terminal_status` enum already had `timeout` + `harness_error`. Tests reach `writeAssertionResult` even on timeout; assertion fires after; row lands. |
| 1.14 | Expected-attempts manifest + diff | **done** 2026-04-29 — `scripts/expected-attempts.mjs` (`plan` + `diff`). Eligibility: tier-eval test imports `writeAssertionResult` (excludes `latency`, `prose-quality`, `tool-discipline`). 32 emit-eligible. Wrapper writes `expected_attempts.<sweep>.csv` pre-sweep, runs `diff` post-sweep, tee'd to `.diff.txt`. Non-zero exit = divergence. Self-validated against 1.10 JSONL: correctly flagged `mini-vm tier=64 rep=1`. |
| 1.15 | Short-timeout smoke for 1.13 | **done** 2026-04-29 — `/tmp/sprint1-15-smoke.mjs` with `timeoutMs=1500`. 10/10: no throw, `code=null`, `timeout=true`, `terminal_status='timeout'`, row lands with `passed=false`, `thermal_drift_advisory: boolean`. |
| 1.16a | Timeout assertion guard | **done** 2026-04-29 (`629714d`) — 1.13 produced misleading `null !== 0` runner output on legitimate timeout rows (registry row was correct because emit ran first). Inserted `if (r.terminal_status === 'timeout') assert.fail(...)` ahead of existing `assert.equal(r.code, 0, …)` in 32 files via Python regex sweep. Verified by smoke (`smoke-sprint1-16-20260429-2221`, 26/26 t64 n=1, 1 timeout row produced clean message). |
| 1.16b | `iters_count` registry enrichment | **done** 2026-04-29 (`629714d`) — `run_row.js` emits `iters_count: iterRecords.length` on every row (records already loaded for drift-advisory). Schema added `iters_count` (int, ≥0) — feeds Sprint 2 §8's "p90 iters/wallclock". Distribution: 4×12, 5×6, 6×2, 7×2, 9×2, 13×1, 19×1 across 26 cells. With `end_time - start_time` gives per-cell wallclock + iter p90s. |
| 1.16c | Suite trim | **done** 2026-04-29 (`629714d`) — pilot n=3 (`overnight-eval8-20260429-1803`, 288 rows) flagged 6 ceiling/floor tests. Renamed to `*.test.js.skip` (preserves source, hides from Vitest discovery): `agent-parallel`, `agent-single`, `code-self-test`, `distractor`, `null-default` (likely_ceiling, 9/9 across all 3 tiers); `mini-vm` (likely_floor, 0/9 t16/t32, t64 timed out at 360s). Saved ~1.6h on deep run. **26 emit-eligible tests remain.** Re-validated: 26 × 3 × 8 = 624 cells. |
| 1.17 | Pilot n=3 (`overnight-eval8-20260429-1803`) | **done** 2026-04-29 — 288 rows = 3 reps × 3 tiers × 32 emit-eligible (pre-trim). Wilson 95% CIs: t16 41.7% [32.3, 51.7], t32 39.6% [30.4, 49.6], t64 94.8% [88.4, 97.8]. **t16↔t32 plateau real** (CIs overlap massively); t64 cleanly separated. Stopped after rep 3 on graceful boundary. |
| 1.18 | Deep n=8 (`eval8-trimmed-20260429-2240`) | **done** 2026-04-30 — 650 rows (624 planned + 26 over-emission on t16 from split kickoff → effectively n=9 t16, n=8 t32/t64). `expected-attempts` diff: 0 missing. Wilson 95% CIs: t16 37.2% [31.2, 43.5], t32 31.2% [25.3, 37.8], t64 98.6% [95.8, 99.5]. Done-only: t16 46.3%, t32 33.5%, t64 100%. **Discrimination matrix:** 16/26 t32↔t64, 14/26 t16↔t64, only 3/26 t16↔t32 (`dependency-graph` + `long-horizon-bugs` t16-favored; `parseISO-with-timezone` t32-favored). Wallclock p50/p90: t16 30.4s/224s, t32 24.7s/135s, t64 10.2s/37s — t64 3× faster median, 6× faster p90. **Thermal: 0/650 pmset_contaminated**; drift advisory 31% / 26% / 20% (smaller models thrash more, expected). **Headline:** t32 (Qwen3-14B Q4) does *not* Pareto-dominate t16 (Qwen2.5-7B Q5) — t16 wins on done-only. Bipolar per-test: t16 wins on algorithmic/long-horizon, t32 wins on structured-spec-following. Real model-selection finding worth surfacing in the manifesto. |
| 1.19 | Tier-32 param-tuning + model swap; tier-16 model swap | **done** 2026-05-02 — model swap landed on both tiers (Qwen3.5-9B unified base) after sweeps 1–4. **Lock-ins:** t16 = `qwen35-9b-iq4xs-ctx32k-v6antiloop-pp01` (cell E), t32 = `qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01` (cell B2). Old baselines `qwen25-7b-instruct-q5km-ctx32k-v1prod-pp01` / `qwen3-14b-q4km-ctx32k-v1prod-pp01` flipped to archived in `lib/model_configs.json`. **Confirm N=8 (208 attempts each, 4×N=4 chunks per tier):** t16 84.6% pass-all / 98.3% done-only; t32 88.9% pass-all / 99.5% done-only. vs 1.18 baseline: t16 +47.4 pp pass-all / +52.0 pp done-only; t32 +57.7 pp / +66.0 pp. **1.18 t16↔t32 Pareto inversion is closed** — t32 now cleanly dominates t16 on both metrics; manifesto framing of t32 as "instruction-following tier that doesn't dominate" must be revised before Sprint 2 ships. Failure modes shifted: t16 bottlenecked by harness-error rate (13.5%), t32 by 64k-context timeouts (7.7%). Both tiers now hit the 26-test pack ceiling — discrimination matrix needs a harder pack before Sprint 2 (see [`difficulty-pack/memos/n8-confirm-vs-baseline.md`](difficulty-pack/memos/n8-confirm-vs-baseline.md)). Source rows: `host/test/.claw-runtime/run_registry.t{16,32}-confirm-n4-chunk{1,2}-*.csv`. |
| 1.20 | t16 harness-error triage | **planned** — N=8 confirm showed t16 failures dominated by 28/208 = 13.5% harness errors (vs 0.5% timeouts and 1.7% content fails); t32 already at 2.9% harness-error rate. Cluster the 28 t16-confirm rows by `test_id` (source: `run_registry.t16-confirm-n4-chunk{1,2}-*.csv`); if errors cluster, fix at the protocol/parse layer to recover most of the 84.6 → 98.3 pp gap on all-attempts. **Soft gate** for Sprint 2 — matrix can ship with a t16 harness-error footnote, but cheap to clear first (hours, parallelizable with 1.5 cuts). Per the 2026-05-02 N=8 memo "Recommended next actions" item 2. |
| 1.21 | Difficulty-extension test pack | **in-progress** — 12 tests authored 2026-05-02 (7 P1 Aider/Exercism ports with mutation defense, 1 P2 AtCoder ARC 216 C port with post-Feb-2026 freeze guarantee, 4 H hand-authored gap-fillers covering convergence / multi-file / dense-spec / stateful-spec). 11 in core matrix (suite_layer B); 1 frontier reserve (semver-range, suite_layer D). Pilot N=5 per tier per test pending GPU window. Engineering plan in [`difficulty-pack/PLAN.md`](difficulty-pack/PLAN.md); post-cycle triage in [`difficulty-pack/good-tests.md`](difficulty-pack/good-tests.md). **Hard gate** for Sprint 2 matrix publish. |
| 1.22 | `lib/standardTest.js` control-flow helper | **planned** — Extract the duplicated `workspace.reset` → seed-write → `runClaw` → post-script → `writeAssertionResult` → timeout-guard → assert sequence into a single helper. Fixture *content* stays inline (license/contamination posture). Evidence the duplication is technical debt: Sprint 1.10 added `writeAssertionResult` to 20 tests one-by-one; Sprint 1.16a applied the timeout-guard fix across 32 files via Python regex sweep. Migration mechanically verifiable via `expected-attempts.mjs` diff = 0/0 on a t64 N=1 sweep before/after. **Soft gate** for any sprint touching all tier-eval test bodies; **hard gate** before any new control-flow concern (per-test wallclock cap, retry policy, etc.) lands. Deferred from 1.21 to avoid helper API churn during difficulty-pack authoring; design rationale in [`standardtest-helper.md`](standardtest-helper.md). |

**Sprint 1 entry criteria for the real overnight (met 2026-04-29):**

- `thermal-watch.sh` running in separate terminal during sweep.
- Frozen `--ctx` JSON per tier:
  ```json
  { "run_kind": "overnight_screen", "hardware_tier": 16, "memory_gb": 16,
    "model_config_id": "qwen25-7b-instruct-q5km-ctx32k-v1prod-pp01",
    "harness_version": "<git sha>", "screening_only": true }
  ```
- `RUN_REGISTRY_PATH` = sweep-specific path (e.g. `host/test/.claw-runtime/run_registry.overnight-2026-04-29.jsonl`) so canonical jsonl stays clean if run aborts.
- Harness pinned to single git SHA across all three tier runs (no mid-sweep rebuilds).
- Confirmed end-to-end by `sprint1-12-15-confirm-20260429-1640` (t64 `EVAL_REPS=1`, ~14 min): 32 rows, `expected-attempts` diff 0/0, `mini-vm` produced first row with `terminal_status='timeout'`, `thermal_drift_advisory=true` on 4 rows without gating them out, all 32 `thermal_status='clean'`. Latency wrap-rate failure (0.45) is in `latency.test.js` (streamMessage-exempt, no row); orthogonal.

**Output sizing (revised 2026-04-29 post research-team review):**

- ≈ 31 cells/rep × 3 tiers × 10 reps = **~930 rows**, plus what 1.13 surfaces from previously-dropped timeouts.
- Wallclock **~13–14 hours** based on 1.9's 80-min `EVAL_REPS=1` baseline scaled linearly. Plist-swap overhead amortized (3 swaps total).
- t16 will produce ~31 timeout/fail rows where it produces 7 completion rows today → row count biased high vs 1.9 + 1.10. 1.14's manifest is authoritative.
