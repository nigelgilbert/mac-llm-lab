# Tier-Eval Suite v2 — Sprint Plan

**Status (2026-05-04):** Sprint 0 + Sprint 1 (through 1.21) closed. Active: **Sprint 1.5** (pre-matrix cleanup) + **1.23** (sampler ablation, owner=user). Next: **Sprint 2** (Usability Pack) → **Sprint 3** (Discrimination Matrix v1) → **Sprint 4** (Hidden Holdouts, lighter scope). The productivity grader is deferred — see §"Deferred".
**Why the re-order:** the N=10 `watch-20260504-0254` sweep surfaced a sampler×tier confound and three harness bugs that contaminate any matrix shipped today. Detail in §"Re-ordering 2026-05-04".

> **Migration annotation (2026-06-10).** This plan predates the OpenCode migration and is
> still the live roadmap for **Sprints 2–4** — but its substrate is historical: the
> `claw.js` runner, `.claw-runtime/` registries, the LiteLLM `_bridge.jsonl`, and the
> `host/test/.claw-runtime/` paths below are all claw-stack artifacts; rebuild on the
> generic config-vs-config driver. In particular, the **`latency` / `prose-quality` /
> `tool-discipline`** probes referenced throughout were **claw-bridge-only and emit no
> registry rows** (decision §4 — [OPENCODE-MIGRATION-DECISION.md](../OPENCODE-MIGRATION-DECISION.md));
> they have **no OpenCode counterpart yet** and must be **rebuilt as driver arms** (+
> #021/#022 timings), not ported. Revival path:
> [research-salvage-next-tranche §6](../../../../research/research-salvage-next-tranche-20260610.md).

---

## Plan philosophy

Same evidentiary discipline as Sprint 0 (canonical schema before any keep/drop). Ships in order:

1. **Sprint 1.5** — pre-matrix cleanup: N=10 follow-ups, t16 harness-error class, `standardTest.js` helper, sampler ablation (1.23). Hard gate to matrix.
2. **Sprint 2** — Usability Pack: real Mac-local bug reports as public_verifier tests.
3. **Sprint 3** — Discrimination matrix v1 against (1.21 ∪ usability), sampler×tier confound resolved.
4. **Sprint 4** — Hidden holdouts, one sibling per Sprint 3 `core_discriminator_candidate`.

**Deferred** (not killed): productivity grader / Opus-as-judge / calibration set — re-derive when subjective grading is the bar (criteria in §"Deferred"). DOE/sampler beyond 1.23, frontier stress, new test families beyond 1.21 + Sprint 2 output.

---

## Re-ordering 2026-05-04 — what changed and why

The N=10 `watch-20260504-0254` sweep on `experiment/better-harness-tests` @ 35911e4 (989 rows) produced findings that gate any matrix shipping today:

- **Per-cell, the 1.21 pack works.** `wordy` 4→6→10, `book-store` 8→5→10, `two-bucket` 10→5→9, `word-search` 8→8→10. The aggregate t16↔t32 plateau (13.3% / 13.9% fail) is the pack pushing into hard territory.
- **Sampler×tier confound buried in the matrix.** t16 runs `qwen35-9b-iq4xs-ctx32k-v6antiloop-pp01`; t32 runs `qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01`. `book-store` and `two-bucket` t32<t16 inversions are confounded — could be sampler, tier, or both. Shipping `discrimination_matrix_v1.csv` without resolving this contaminates every t16↔t32 row. → 1.23.
- **Three pre-matrix harness bugs.** (a) `needle-haystack@t64` ctx-overflow on 8/9 rows (relocated to `frontier/`). (b) 1.20 detector regression: 19 rows have `terminal_status='error'` + matching stderr but no relabel — inflates fail-rate denominators (concentrated on `expression-eval`). (c) Expected-attempts planner reads manifest off `main`, so `observed=9` looks "extra" instead of "short" (masked the missing `needle-haystack@t64` rep). → 1.5-N10A/B/C.
- **Product goal first.** "Useful local claw-code on Mac SoC" (primary) + staff-scientist rigor (secondary). Real bug reports exist (U1, U2, plus roommate-sourced); they're leading indicators of fixable harness/tool bugs. Capturing them as public_verifier tests is product work the matrix's signal-to-noise benefits from.

**Rejected: "drop Sprint 4."** Wrong threat model. Not training-data contamination — **own-suite overfit during the user's own tuning**. Sprint 1.19 demonstrated it: t16 37.2% → 84.6% pass-all after sampler+model swaps tuned against the visible 26-test pack, no admission gate. Sprint 4 stays, lighter scope.

**Rejected: "fold productivity grader into cleanup."** Wrong category. Calibration set + two human graders is heavyweight and only earns its keep when subjective grading is the bar; today's bar is decidable pass/fail. Sprint 2 is **public_verifier only**. Grader deferred, not killed.

---

## Decisions captured 2026-04-29 (locked)

| Question | Decision |
|---|---|
| Tier emulation vs. physical hardware | Single M5 Max MBP, serial. Tier configs swapped between runs. Three-machine parallel not available; do not re-pitch. |
| Schema: `hardware_id` / `soc_generation` | Dropped. One physical machine. Reintroduce `machine_label` if a second unit lands. |
| Canonical hardware fields | `hardware_tier` (16/32/64) + `memory_gb`. |
| Hidden-holdout storage | `host/test/__tests__/tier-eval-hidden/` (gitignored). Stage 3 emits visible warning if missing — never silently passes. |
| Productivity judge | `claude-opus-4-7` via Claude API. Version per row. Prompt caching on system + rubric. Local model never grades itself or peers. *(Implementation deferred 2026-05-04.)* |
| Sprint 1 latency labeling | Single-hardware config latency, not final product-tier latency. |

## Decisions captured 2026-05-04 (locked)

| Question | Decision |
|---|---|
| Sprint 2 ↔ Sprint 3 ordering | Swap. Sprint 2 = Usability Pack; Sprint 3 = Matrix. Matrix soft-gated on Sprint 2 corpus — ships with whatever exists at matrix-time, small-N footnotes if partial. |
| Productivity grader | Deferred indefinitely. Re-entry: `research/productivity-grader-notes.md`. |
| Sprint 1.5 scope | Expanded. Original slate + 1.20 + 1.22 + three N=10 follow-ups (N10A done; N10B, N10C open). |
| Sprint 1.23 — sampler ablation | One overnight N=8 cell: t16+v7-noreppen OR t32+v6-antiloop, whichever swap is cheaper. Hard gate to Sprint 3. Owner: user. |
| Sampler×tier confound | Resolve before Sprint 3 ships any `book-store` / `two-bucket` classification. *Unanswered* is the only unacceptable outcome. |
| Sprint 4 scope | One hidden sibling per Sprint 3 `core_discriminator_candidate` (not per Layer-B core). Quarterly rotation + Stage 0–4 funnel unchanged. |
| Usability Pack grading | Public_verifier only. No Opus-as-judge, no human-in-loop. |

---

## Sprint 0 — Phase 0 foundation

Closed 2026-04-29. Deliverable table: §"Sprint 0 status".

## Sprint 1 — Overnight cross-tier screen

Closed through 1.21 (difficulty-pack landed 2026-05-04). 1.20 + 1.22 moved to Sprint 1.5 Track A. Deliverable table: §"Sprint 1 status".

---

## Sprint 1.5 — Pre-matrix cleanup + sampler disambiguation (HARD GATE to Sprint 3)

**Goal:** every input the matrix reads is honest. Three known-broken inputs (1.20 detector, expected-attempts planner, sampler confound) and one large-gain product fix (1.20 t16 harness-error class) are cheap to clear before the matrix runs.

### Track A — test-tooling cleanup (foreground engineering)

| # | Item | What | Why now |
|---|---|---|---|
| 1.5.1 | `canonical_status` enum review | Original 1.5 item: 4-state enum vs. 2-state + free-text `provenance_note`. Verdict-pending. | Decide before Sprint 3 freezes downstream tooling on whichever shape we keep. |
| 1.5.3 | `expected-attempts.mjs` dead-path verify | Original 1.5 item: confirm no unreachable branches before the 1.5 review closes. | Sprint 3 confirmatory-night planner is one of its consumers. |
| 1.20 | t16 harness-error triage | Cluster the 28/208 t16-confirm error rows by `test_id` (source: `host/test/.claw-runtime/run_registry.t{16,32}-confirm-n4-chunk{1,2}-*.csv`). If errors cluster, fix at the protocol/parse layer. | Recovers most of the 1.19 84.6→98.3 pp gap on t16 all-attempts. Same surface as roommate-bug fixes in Sprint 2. |
| 1.22 | `lib/standardTest.js` control-flow helper | Extract the duplicated `workspace.reset` → seed-write → `runClaw` → post-script → `writeAssertionResult` → timeout-guard → assert sequence. Fixture content stays inline. | Pre-condition for Sprint 2 test authoring at scale. Migration mechanically verifiable via `expected-attempts.mjs` diff = 0/0 on a t64 N=1 sweep before/after. Design rationale: [`standardtest-helper.md`](../standardtest-helper.md). |
| 1.5-N10A | `needle-haystack@t64` verdict | **Already executed 2026-05-03**: relocated to `host/test/__tests__/tier-eval/frontier/needle-haystack.test.js`, dropped from `NEW_TESTS` allowlist in `explore-cycle.sh`. Memo: [`usability-pack/memos/needle-haystack-t64-inversion.md`](../usability-pack/memos/needle-haystack-t64-inversion.md). | Confirm closed and remove from any active-pack manifest assumption in Sprint 3 planner. |
| 1.5-N10B | 1.20 detector regression audit | 19 rows in `watch-20260504-0254` have `terminal_status='error'` + stderr matching the three 1.20 patterns (`BadRequestError` + "exceeds the available context size", `InternalServerError`/`APIError` + "Context size has been exceeded") but didn't relabel. Concentrated on `expression-eval` (9 t16 / 7 t32 / 3 t64) and the t32 sampler under load. | These rows inflate fail-rate denominators that should drop out as harness errors. Sprint 3 cannot ship honest pass-rates until the relabeler covers them. |
| 1.5-N10C | Expected-attempts planner fix | Planner reads manifest off `main`, so all 7 active 1.21 pack tests show `planned=0`; any `observed=9` looks "extra" instead of "short." Two-line fix: read manifest off the working branch (or sweep-tagged ref). | Sprint 3 confirmatory-night planning depends on this diff being trustworthy. |

### Track B — sampler ablation (1.23, parallelizable; user kicks off personally)

One overnight sweep cell. Runs in parallel with Track A.

- **Goal:** disentangle sampler vs. tier on the `book-store` and `two-bucket` t32<t16 inversions. The matrix cannot ship classifications on those cells while the answer is unknown.
- **Cell:** **either** (a) t16 + v7-noreppen, **or** (b) t32 + v6-antiloop. Pick whichever is cheaper to swap on current `lib/model_configs.json` — one tier swap is the work.
- **Pack:** 1.21 pack, 7 active tests (post-needle-haystack relocation).
- **N:** 8 per cell.
- **Output:** registry rows tagged `ablation-sampler-1.23` (e.g. `host/test/.claw-runtime/run_registry.ablation-sampler-1.23-<datestamp>.jsonl`) plus a one-page memo at `host/test/docs/difficulty-pack/memos/sampler-ablation-1.23.md` answering "sampler or tier?" for `book-store` and `two-bucket`.
- **Schedule:** after-hours; consumes one tier's overnight slot. Owner: user (does not block engineering on Track A).

### Sprint 1.5 sign-off (all required before Sprint 3 starts)

- Every Track A item resolved: verdict written, fix merged, or written tripwire ("revisit if X happens").
- Track B memo answers the sampler/tier question for both inverted cells. Either answer is acceptable; *being unanswered* is not.
- One re-sweep at N=8 against the 1.21 pack on `experiment/better-harness-tests` shows zero unrelabeled harness-error rows (1.5-N10B closed) and the expected-attempts diff correctly counts missing vs. extra cells (1.5-N10C closed).

### Out of scope for 1.5

New features. Reopening §9.2, hidden-holdout, or productivity-grader policy decisions. Model swaps or sampler tuning beyond the 1.23 ablation cell. New tests beyond what's already in the 1.21 pack.

---

## Sprint 2 — Usability Pack (HARD GATE on 1.5; SOFT GATE to Sprint 3)

**Goal:** real-world Mac-local claw-code failures captured as public_verifier tests. Each test either drives a fix or surfaces a candidate usability-axis discriminator. No Opus-as-judge.

### Sources

1. [U1 — `grep_search` walks `.claw-runtime/`](../usability-pack/memos/grep-search-claw-runtime-leak.md) — 108KB log-noise payload → ctx-overflow before reasoning. Tool-selection-conditioned.
2. [U2 — needle-haystack@t64 runtime inversion](../usability-pack/memos/needle-haystack-t64-inversion.md) — 8.6s error + SSE deadlock + harness row-loss across 3 reps.
3. `litellm/docs/bridge-sse-deadlock.md` — SSE deadlock class on `word-search` v2.1; likely same root cause as U2's timeout.
4. **Roommate bug reports** — in the user's head; capture is Sprint 2's first deliverable.

### Target & trim filters

- **N target:** 6–8 tests. Generate N+3 to N+5 candidates, trim by:
  - Reproducibility on a non-user machine.
  - Decidable pass/fail (no human, no LLM judge).
  - Fits `lib/standardTest.js` from 1.22 — reshape or drop otherwise.
  - Drives a shippable fix OR is a candidate usability-axis discriminator.
- **Done:** trimmed pack lands in `host/test/__tests__/tier-eval/usability/` with manifest headers; one N=8 sweep across t16/t32/t64 lands cleanly; fix-driving tests' fixes shipped.

### Workflow

1. **Capture (½d).** Drain user's head into `host/test/docs/usability-pack/bug-reports.md` (symptom, who, hardware, reproducible?). Reference U1/U2/SSE-deadlock memos; don't recopy.
2. **Triage (½d).** Classify each entry: (i) testable + fixable, (ii) testable but fix is large, (iii) not reproducible yet, (iv) not a bug.
3. **Author (3–5d, parallelizable).** (i) + (ii) become tests via the 1.22 helper; ship fixes for (i); mark (ii) `expected_status='known-fail'` with a TODO link.
4. **Sweep (one overnight).** N=8 × t16/t32/t64. Per-cell table, same shape as the 1.21 N=10 table.
5. **Trim (½d).** Drop flaky/redundant/no-signal tests. Update [`usability-pack/README.md`](../usability-pack/README.md).

### Out of scope

Opus-as-judge or any human-in-loop grading. Synthetic tests not grounded in a real report. Model/sampler tuning. Holdout siblings (Sprint 4, gated on Sprint 3 labels).

---

## Sprint 3 — Discrimination Matrix v1 + confirmatory plan (was Sprint 2)

**Goal:** classify tests as screening candidates; pick which deserve a confirmatory night.

Same scope as the original Sprint 2 in this plan, with two changes from the 2026-05-04 re-ordering:

1. **Test pack is expanded.** Matrix runs against (1.21 difficulty pack ∪ Sprint 2 usability pack), not just 1.21.
2. **Sampler×tier confound is resolved** by the 1.23 ablation memo. Per-test classifications on `book-store` / `two-bucket` cite the ablation memo for sampler-vs-tier attribution.

### Deliverables

- `discrimination_matrix_v1.csv` with §8 Phase 2 columns: pass rates + Wilson CIs, point spread, credible-spread flag, monotonicity, harness-error rate, p90 iters/wallclock, dominant trace tags, oracle type. Thermal columns retired (layer cut 2026-05-04 per CODE-REVIEW §1.5.2).
- Per-test classification (§9.2): `core_discriminator_candidate`, `provisional_discriminator`, `likely_ceiling`, `likely_floor`, `noisy_diagnostic`, `harness_contaminated`. Screening-only — no keep/drop yet.
- Confirmatory-night plan: top ~6–10 `provisional_discriminator` cells. N from §9.3 power calc against 25 pp target. Paired seeds.
- Axis scorecard v1 (§8 Phase 3) with explicit "Not measured" for productivity. New `local_usability` axis if Sprint 2 produced enough material; otherwise "Not measured" with a footnote pointing at the in-flight Sprint 2.
- **No aggregate score.**

### Forbidden in any leadership-facing artifact

"Tier-32 scored X%". Aggregate scores. Statements that bundle the sampler×tier confound back together post-1.23-resolution.

---

## Sprint 4 — Hidden Holdouts + model-trial protocol skeleton

**Goal:** make §15's Stage 0–4 funnel implementable so the next model trial doesn't enter through ad-hoc tuning. Threat model: own-suite overfit (see §Re-ordering "Rejected: drop Sprint 4"), not training-data contamination.

### Deliverables

- `host/test/__tests__/tier-eval-hidden/` (gitignored, per 0.8 memo).
- One hidden sibling per Sprint 3 `core_discriminator_candidate`.
- `host/test/run-model-trial.sh`: Stage 0 (fit/harness) → Stage 1 (public core) → Stage 3 (hidden admission). Stage 2 (config tuning) stays manual.
- Empty `tier-eval-hidden/` → Stage 3 emits visible warning, never silent pass.

Sibling authoring blocked on Sprint 3 labels; directory + Stage skeleton + warning land independently in parallel with Sprint 3.

---

## Deferred — Productivity Grader (Opus-as-judge)

The original Sprint 3 (calibration set, two human graders, agreement threshold, hybrid grader scaffolding) is **deferred indefinitely**, not killed.

### Re-derivation criteria

Re-open this sprint when *any* of the following becomes true:

- A stakeholder asks "is this output actually helpful?" on a non-decidable task.
- Sprint 2's usability pack hits a wall where pass/fail no longer captures the signal worth measuring.
- A model trial reaches Stage 3 admission and the gate criterion needs subjective grading rather than decidable pass/fail.

### Re-entry point

`research/productivity-grader-notes.md` (moved 2026-05-01) holds the original design. Re-derivation should re-validate the design against whatever circumstance triggered the re-open — the original assumptions (Opus-4-7 pinned, calibration ~30 examples per family, two human graders) may no longer fit the new context.

### Locked decisions that survive deferral

The 2026-04-29 row "Productivity judge: `claude-opus-4-7` via Claude API; version recorded per row; prompt caching on system + rubric; local model never grades itself or peers" stays locked. If Opus-4-7 is retired before re-derivation, update to the then-current frontier Anthropic model and re-pin.

---

## Out of scope for this iteration

- Sampler/prompt DOE (§14.3) beyond 1.23 — needs the matrix first.
- New coding test families from §12; frontier/stress suite (Layer D).
- Multi-physical-machine isolation (thermal layer cut 2026-05-04).
- Public leadership-facing scorecard — all output is internal R&D evidence.

---

## Rough timeline (planning, not commitment)

| Sprint | Wall clock | Notes |
|---|---|---|
| 0 | done | 1.5–2 weeks (closed 2026-04-29). |
| 1 | done | Closed through 1.21 (2026-05-04). |
| 1.5 (Track A + Track B) | ~3–5 days | Track A foreground. Track B (1.23) one overnight, parallel, owner=user. |
| 2 (Usability Pack) | 1.5–2 weeks | Capture (½d) + triage (½d) + author (3–5d, parallel) + sweep (1 overnight) + trim (½d). |
| 3 (Matrix) | 3–5 days + 1 confirmatory night | Gated on 1.5 + 1.23. Soft-gated on Sprint 2 corpus. |
| 4 (Holdouts) | 1 week | Parallel with Sprint 3. Sibling authoring blocked until Sprint 3 labels exist. |

Total: ~3–4 weeks from 2026-05-04 if Sprint 2 and Sprint 3 don't overlap, ~3 weeks if Sprint 4 sibling-authoring overlaps Sprint 3's confirmatory-night write-up.

§9.3 caveat unchanged: `n=40` is a starting point, not a power guarantee — recompute per comparison.

---

## Resume cheatsheet (for fresh sessions / post-`/compact`)

- **Current work:** Sprint 1.5 (Track A engineering) + 1.23 (Track B sampler ablation, owner=user). Everything before 1.5 is closed history.
- **Hard gates to Sprint 3:** all of 1.5 Track A closed AND 1.23 memo written.
- **Soft gate to Sprint 3:** Sprint 2 corpus — matrix ships with whatever exists at matrix-time.
- **Sprint 2 = Usability Pack** (public_verifier, no Opus judge). **Sprint 3 = Matrix.** Productivity grader deferred (re-entry criteria in §Deferred).
- **Hardware: single M5 Max MBP, serial.** Three-machine parallel not available — do not re-pitch.

**Repo landmarks:**
- Active tests: `host/test/__tests__/tier-eval/` — 1.21 difficulty-pack active; `frontier/needle-haystack.test.js` parked.
- Sprint 2 lands at: `host/test/__tests__/tier-eval/usability/`.
- Sprint 4 hidden siblings: `host/test/__tests__/tier-eval-hidden/` (gitignored, empty until Sprint 3 labels).
- Runner library: `host/test/lib/` — `claw.js`, `tier.js`, `model.js`, `backend.js`, `bridge.js`, `workspace.js`, `run_row.js`, `registry.js`, `model_config.js`, `test_manifest.js`. `telemetry.js` cut 2026-05-04. 1.22 lands `standardTest.js`.
- Entry: `host/test/run-tier-eval.sh`. Overnight wrapper: `host/test/scripts/run-overnight-screen.sh`. W1 sidecar: `/workspace/.claw-runtime/<run-id>/`.
- Adjacent docs: `EVAL-DESIGN.md`, `EVAL-CALIBRATION-REPORT.md`, `NEW-EVALS-REPORT.md`, `TIER-EVAL-MEMO-20260428-*.md`, `usability-pack/memos/*.md`, `difficulty-pack/README.md`.
- Plan-mode record: `~/.claude/plans/let-s-get-thru-this-cheerful-dragonfly.md`.

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
| 0.7 | Thermal telemetry | **done (library-only), then cut 2026-05-04** — built and shipped through 1.18; cut per CODE-REVIEW §1.5.2 after 0/650 contamination signal. Schema columns + `lib/telemetry.js` + `scripts/thermal-watch.sh` removed; thermal layer no longer exists. |
| 0.8 | Hidden-holdout policy | **done** — `docs/HIDDEN-HOLDOUT-POLICY.md`. Storage `host/test/__tests__/tier-eval-hidden/` (gitignored), naming `<public_test_id>-h`, quarterly rotation, ≥2 per-axis reserve, retire-on-suspicion, no-leak reporting, Sprint-4 Stage-3 contract (visible warning + `admission_status=skipped` if empty — silent passes forbidden). No holdouts yet. *(2026-05-04: per-axis reserve tightened to "one sibling per Sprint 3 `core_discriminator_candidate`" pending matrix labels.)* |
| 0.9 | Productivity-grader notes | **moved to research/** (2026-05-01) — `research/productivity-grader-notes.md`. Not commitment material; re-derive when a real productivity-grading need arises. *(2026-05-04: status unchanged — grader formally deferred.)* |

**Sign-off — all four met 2026-04-29:** dry-run lands fully-populated row; smoke emits `thermal_status` + resolvable `model_config_id` (3 tier baselines in `lib/model_configs.json`: t16 Qwen2.5-7B Q5_K_M, t32 Qwen3-14B Q4_K_M, t64 Qwen3.6-35B-A3B UD-Q4_K_XL); historical bucketed; decision rule written. `/tmp/sprint1-smoke.mjs` 28/28 in `node:24-bookworm-slim`.

---

## Sprint 1 status (closed through 1.21)

1.20 and 1.22 originally listed as "planned" under Sprint 1; the 2026-05-04 re-ordering moves their execution into Sprint 1.5 Track A. Status rows below reflect the move; the historical context (why each was queued in the first place) is preserved.

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
| 1.12 | Demote drift-only thermal flags to advisory | **done** 2026-04-29 — `lib/telemetry.js` split: `captureThroughputSignal` → `captureThroughputAdvisory` returning `{advisory, drop_pct, ...}`. `combineStatuses` removed. `PMSET_LEVELS` rename `contaminated` → `pmset_contaminated`. `lib/run_row.js`: `thermal_status = thermalHint.status` (pmset only); new `thermal_drift_advisory` boolean column. Schema enum `{clean, warning, pmset_contaminated, unknown}` + `thermal_drift_advisory: boolean`. `/tmp/sprint1-12-smoke.mjs` 10/10. *(Layer cut 2026-05-04 per CODE-REVIEW §1.5.2.)* |
| 1.13 | Timeout-as-row + schema loosening | **done** 2026-04-29 — `runClaw` resolves with `{code: null, signal: null, timeout: true, terminal_status: 'timeout', ...}` instead of rejecting. `maybeEmitRegistryRow` propagates `code: null`. No schema change needed: `passed` already `[boolean, null]`, `terminal_status` enum already had `timeout` + `harness_error`. Tests reach `writeAssertionResult` even on timeout; assertion fires after; row lands. |
| 1.14 | Expected-attempts manifest + diff | **done** 2026-04-29 — `scripts/expected-attempts.mjs` (`plan` + `diff`). Eligibility: tier-eval test imports `writeAssertionResult` (excludes `latency`, `prose-quality`, `tool-discipline`). 32 emit-eligible. Wrapper writes `expected_attempts.<sweep>.csv` pre-sweep, runs `diff` post-sweep, tee'd to `.diff.txt`. Non-zero exit = divergence. Self-validated against 1.10 JSONL: correctly flagged `mini-vm tier=64 rep=1`. *(2026-05-04: planner-reads-main bug filed as Sprint 1.5 item N10C.)* |
| 1.15 | Short-timeout smoke for 1.13 | **done** 2026-04-29 — `/tmp/sprint1-15-smoke.mjs` with `timeoutMs=1500`. 10/10: no throw, `code=null`, `timeout=true`, `terminal_status='timeout'`, row lands with `passed=false`, `thermal_drift_advisory: boolean`. |
| 1.16a | Timeout assertion guard | **done** 2026-04-29 (`629714d`) — 1.13 produced misleading `null !== 0` runner output on legitimate timeout rows (registry row was correct because emit ran first). Inserted `if (r.terminal_status === 'timeout') assert.fail(...)` ahead of existing `assert.equal(r.code, 0, …)` in 32 files via Python regex sweep. Verified by smoke (`smoke-sprint1-16-20260429-2221`, 26/26 t64 n=1, 1 timeout row produced clean message). |
| 1.16b | `iters_count` registry enrichment | **done** 2026-04-29 (`629714d`) — `run_row.js` emits `iters_count: iterRecords.length` on every row (records already loaded for drift-advisory). Schema added `iters_count` (int, ≥0) — feeds Sprint 3 §8's "p90 iters/wallclock". Distribution: 4×12, 5×6, 6×2, 7×2, 9×2, 13×1, 19×1 across 26 cells. With `end_time - start_time` gives per-cell wallclock + iter p90s. |
| 1.16c | Suite trim | **done** 2026-04-29 (`629714d`) — pilot n=3 (`overnight-eval8-20260429-1803`, 288 rows) flagged 6 ceiling/floor tests. Renamed to `*.test.js.skip` (preserves source, hides from Vitest discovery): `agent-parallel`, `agent-single`, `code-self-test`, `distractor`, `null-default` (likely_ceiling, 9/9 across all 3 tiers); `mini-vm` (likely_floor, 0/9 t16/t32, t64 timed out at 360s). Saved ~1.6h on deep run. **26 emit-eligible tests remain.** Re-validated: 26 × 3 × 8 = 624 cells. |
| 1.17 | Pilot n=3 (`overnight-eval8-20260429-1803`) | **done** 2026-04-29 — 288 rows = 3 reps × 3 tiers × 32 emit-eligible (pre-trim). Wilson 95% CIs: t16 41.7% [32.3, 51.7], t32 39.6% [30.4, 49.6], t64 94.8% [88.4, 97.8]. **t16↔t32 plateau real** (CIs overlap massively); t64 cleanly separated. Stopped after rep 3 on graceful boundary. |
| 1.18 | Deep n=8 (`eval8-trimmed-20260429-2240`) | **done** 2026-04-30 — 650 rows (624 planned + 26 over-emission on t16 from split kickoff → effectively n=9 t16, n=8 t32/t64). `expected-attempts` diff: 0 missing. Wilson 95% CIs: t16 37.2% [31.2, 43.5], t32 31.2% [25.3, 37.8], t64 98.6% [95.8, 99.5]. Done-only: t16 46.3%, t32 33.5%, t64 100%. **Discrimination matrix:** 16/26 t32↔t64, 14/26 t16↔t64, only 3/26 t16↔t32 (`dependency-graph` + `long-horizon-bugs` t16-favored; `parseISO-with-timezone` t32-favored). Wallclock p50/p90: t16 30.4s/224s, t32 24.7s/135s, t64 10.2s/37s — t64 3× faster median, 6× faster p90. **Thermal: 0/650 pmset_contaminated**; drift advisory 31% / 26% / 20% (smaller models thrash more, expected). **Headline:** t32 (Qwen3-14B Q4) does *not* Pareto-dominate t16 (Qwen2.5-7B Q5) — t16 wins on done-only. Bipolar per-test: t16 wins on algorithmic/long-horizon, t32 wins on structured-spec-following. Real model-selection finding worth surfacing in the manifesto. |
| 1.19 | Tier-32 param-tuning + model swap; tier-16 model swap | **done** 2026-05-02 — model swap landed on both tiers (Qwen3.5-9B unified base) after sweeps 1–4. **Lock-ins:** t16 = `qwen35-9b-iq4xs-ctx32k-v6antiloop-pp01` (cell E), t32 = `qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01` (cell B2). Old baselines `qwen25-7b-instruct-q5km-ctx32k-v1prod-pp01` / `qwen3-14b-q4km-ctx32k-v1prod-pp01` flipped to archived in `lib/model_configs.json`. **Confirm N=8 (208 attempts each, 4×N=4 chunks per tier):** t16 84.6% pass-all / 98.3% done-only; t32 88.9% pass-all / 99.5% done-only. vs 1.18 baseline: t16 +47.4 pp pass-all / +52.0 pp done-only; t32 +57.7 pp / +66.0 pp. **1.18 t16↔t32 Pareto inversion is closed** — t32 now cleanly dominates t16 on both metrics; manifesto framing of t32 as "instruction-following tier that doesn't dominate" must be revised before Sprint 3 ships. Failure modes shifted: t16 bottlenecked by harness-error rate (13.5%), t32 by 64k-context timeouts (7.7%). Both tiers now hit the 26-test pack ceiling — discrimination matrix needs a harder pack before Sprint 3 (see [`difficulty-pack/memos/n8-confirm-vs-baseline.md`](../difficulty-pack/memos/n8-confirm-vs-baseline.md)). Source rows: `host/test/.claw-runtime/run_registry.t{16,32}-confirm-n4-chunk{1,2}-*.csv`. **2026-05-04: this sweep is also the case for Sprint 4 hidden holdouts — tuning landed gain with no admission gate.** |
| 1.20 | t16 harness-error triage | **done** 2026-05-02 (commit `5fcaf07`) — root cause: 28/208 = 13.5% errors were 100% llama-server context-overflow rejections at t16's 32k ceiling. Three changes shipped: (a) `iter_distribution_logger.py` captures `failure_class`+`failure_message_tail` on LiteLLM failures; (b) t16 lock-in moved to `qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01` (n_ctx 32k→64k, same model+sampler); (c) `run_row.js` relabels typed context-overflow as `terminal_status='harness_error', harness_error='context_overflow'` (gated on claw exit ≠ 0; matches `BadRequestError` + "exceeds the available context size" and `InternalServerError`/`APIError` + "Context size has been exceeded"). N=8 64k confirm: 90.8% pass-rate (+6.2 pp), 99.4% done-only, 6.25% typed harness_error (-7.25 pp), 8.2% timeouts (+7.7 pp); failures reshape from typed overflows to wallclock. **2026-05-04: detector-regression caught in N=10 `watch-20260504-0254` — 19 rows had matching stderr but did not relabel (concentrated on `expression-eval`). Tracked as Sprint 1.5-N10B.** Memo: [`difficulty-pack/memos/n8-confirm-vs-baseline.md`](../difficulty-pack/memos/n8-confirm-vs-baseline.md). |
| 1.21 | Difficulty-extension test pack | **done** 2026-05-04 — N=3 pilot over 4 cycles. Final: 6 core (`book-store`, `wordy`, `word-search`, `two-bucket`, `twelve-file-refactor`, `ini-parser`); 4 frontier (`alphametics`, `forth`, `semver-range`, `needle-haystack`); 3 dropped. New R9 ctx-efficiency axis from c3 — keep-band now "pass-rate cells ∪ R9-A cells, ≥6" (met). **N=10 follow-up sweep `watch-20260504-0254`:** 989 rows, per-cell discrimination clean (`wordy` 4/6/10, `book-store` 8/5/10, `two-bucket` 10/5/9, `word-search` 8/8/10), three pre-matrix fixes filed (see Sprint 1.5 N10A/B/C), sampler×tier confound surfaced (filed as 1.23). Retrospective: [`difficulty-pack/README.md`](../difficulty-pack/README.md). |
| 1.22 | `lib/standardTest.js` control-flow helper | **moved to Sprint 1.5 Track A** (was "planned" under Sprint 1) — Extract the duplicated `workspace.reset` → seed-write → `runClaw` → post-script → `writeAssertionResult` → timeout-guard → assert sequence into a single helper. Fixture *content* stays inline (license/contamination posture). Evidence the duplication is technical debt: Sprint 1.10 added `writeAssertionResult` to 20 tests one-by-one; Sprint 1.16a applied the timeout-guard fix across 32 files via Python regex sweep. Migration mechanically verifiable via `expected-attempts.mjs` diff = 0/0 on a t64 N=1 sweep before/after. **Hard gate** before Sprint 2 test authoring (which lands ~6–8 new tests at scale). Design rationale in [`standardtest-helper.md`](../standardtest-helper.md). |
| 1.23 | Sampler ablation (new) | **planned, Sprint 1.5 Track B** — One overnight cell at N=8 on the 1.21 pack: either t16+v7-noreppen OR t32+v6-antiloop. Output: `host/test/.claw-runtime/run_registry.ablation-sampler-1.23-<datestamp>.jsonl` + memo at `host/test/docs/difficulty-pack/memos/sampler-ablation-1.23.md`. Hard gate to Sprint 3 matrix shipping `book-store` / `two-bucket` classifications. Owner: user (kicks off personally). |

**Sprint 1 entry criteria for the real overnight (met 2026-04-29):**

- ~~`thermal-watch.sh` running in separate terminal during sweep.~~ (Layer cut 2026-05-04 — no longer applicable.)
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
