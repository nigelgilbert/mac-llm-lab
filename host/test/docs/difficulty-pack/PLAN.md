# Sprint 1.21 — Difficulty-Extension Test Pack

**Author:** Tier-eval harness team
**Date:** 2026-05-02
**Audience:** ML PhD staff scientist review; harness engineers implementing
**Status:** In-flight; cycles 1+2 complete. Hard gate for Sprint 2 matrix publish.

**Post-cycle-2 update (2026-05-03):** Three tests (`alphametics`, `forth`, `semver-range`) floored at 0% across t32 (N=3) and t16 (N=2) despite clearing the 10-min hand-solve rule. Relocated to [`host/test/__tests__/tier-eval/frontier/`](../../__tests__/tier-eval/frontier/) and reclassified `suite_layer: D, difficulty_band: frontier` — held as documented capability gaps for current Qwen3.5-9B at t16/t32. Active screening set is now 9 tests; `scripts/explore-cycle.sh` filter trimmed accordingly. Test-pack composition table below records original 12; current verification-gate denominator is 9.
**Canonical:** `host/test/docs/difficulty-pack/PLAN.md`
**Working copy (plan-mode):** `~/.claude/plans/you-re-a-phd-student-deep-moler.md`

---

## TL;DR

Author **~12 new tier-eval tests** that drop done-only pass rate into the 50–85% Wilson-discriminable band on at least one of t16 or t32, so Sprint 2's discrimination matrix has cells where 95% Wilson CIs can separate. Source mix: **7 Aider/Exercism-inspired hand-translations** (JS subset, mutated for contamination resistance) + **1 post-Feb-2026 AtCoder Hard port** (provably post-Qwen3.5 release, JS-translated, presented at relaxed N for hand-solvability) + **4 hand-authored gap-fillers** (long-horizon convergence, multi-file scale, denser spec, plus one TBD post-pilot axis-gap-filler). Stay strictly within the existing five coding axes (no productivity, no library-API). Calibrate at N=5 pilot before commit; size Sprint 2 confirmatory at **N ≈ 55–60 per cell** (re-derived from Newcombe-Wilson power calc, not the N=40 the original V2 plan footnote suggested).

**Verification gate (post-cycle-3 reframe):** ≥6 cells qualifying, where qualifying = (pass-rate middle band [10–80% on t16 OR 25–85% on t32]) ∪ (R9-A `ctx_discriminator`). R9-A is a NEW classifier added 2026-05-03 after cycle-3 evidence showed `t16 ctx-overflow / t32 clean-pass` is genuine architectural discrimination on the per-turn-context-efficiency axis (model needs more turns at IQ4_XS than Q5_K_XL → trips the 32k ceiling at t16 before convergence). See §R9 below.

---

## Context — why this work

Sprint 1.18 measured the 26-test pack at t16 37.2% / t32 31.2% pass-all (Pareto inversion); Sprint 1.19 closed the inversion by unifying both tiers on a Qwen3.5-9B base with per-tier sampler/quant/context tuning (cell E for t16, cell B2 for t32). The N=8 confirm landed at:

| tier | pass-all | done-only | dominant failure |
|---|---|---|---|
| t16 | 84.6% | **98.3%** | 13.5% harness errors |
| t32 | 88.9% | **99.5%** | 7.7% timeouts (64k context) |

Both tiers are **at the 26-test pack ceiling.** Wilson 95% CIs at p=0.99, N=8 are nearly degenerate; even at p=0.85 they span ~±20pp. Sprint 1.18's per-test discrimination matrix already showed only **3/26 cells separating t16 from t32** under the *worse* model configs; with the new configs all 26 cells are pinned high. **More reps on this pack cannot recover discrimination** — the information is no longer there to recover.

Sprint 2's deliverable (`discrimination_matrix_v1.csv` with Wilson CIs, point spreads, credible-spread flags) is meaningless without cells where the underlying pass rate is in the discriminative middle. That is what this pack delivers.

Source memo: [`memos/n8-confirm-vs-baseline.md`](memos/n8-confirm-vs-baseline.md), "Recommended next actions" item 3. Sibling sprint plan: [`../TIER-EVAL-V2-SPRINT-PLAN.md`](../base/TIER-EVAL-V2-SPRINT-PLAN.md).

---

## Locked decisions

| | Decision | Rationale |
|---|---|---|
| Sourcing | External ports first; hand-author only the gaps | Transfer signal from external benchmarks; ML-PhD-defensible citations; less authoring burden than wholly hand-authored |
| Volume | ~12 new tests (cap at 12, not 16; was 12–16 in scoping) | Plan-agent review flagged that 5–6 hand-authored + 7 ports is over-scoped for 1.21; locked at 7 P1 + 1 P2 + 4 H |
| Tier separation target | t16 vs t32 only; skip t64 | t64 still runs Qwen3.6-35B-A3B (different model family); cross-tier comparisons would be apples-to-oranges. t64 model swap is its own future sprint. |
| Axis scope | Existing 5 coding axes only at higher difficulty | Productivity is Sprint 3-gated on grader calibration; library-API as a new axis would require npm deps in container (against design) |
| Oracle type | `public_verifier` only | All 26 existing tests use this; rubric/judge/hidden-holdout deferred to Sprints 3/4 |
| Container constraints | Node stdlib + `node:test` + `node:assert/strict` only | The container is deliberately npm-free per `Dockerfile` ("Zero npm dependencies"). All ports must hand-translate to `node:assert/strict`, not import Jest/Mocha |
| Live-sweep coexistence | Steps 1–6, 8, 10 (chip-independent authoring) MAY proceed while another sweep holds the chip; steps 7 + 9 (pilot/rerun pilot) MUST wait | A live sweep was in flight at proposal time. Any GPU-touching step interferes; any edit to `lib/*.js`, `lib/model_configs.json`, `scripts/run-overnight-screen.sh`, plist configs, `thermal-watch.sh`, or `host/test/.claw-runtime/` interferes. New `host/test/__tests__/tier-eval/<id>.test.js` files are NOT discovered until a sweep launches, so authoring is safe. |

---

## Design

### Test-pack composition

| # | Source | Count | Primary axis | Difficulty band | Effort/test |
|---|---|---|---|---|---|
| P1 | Aider/Exercism JS, hand-translated | 7 | spec_precision (4), stateful_logic (2), convergence (1) | hard | 1.5h port + 1h mutation |
| P2 | AtCoder ARC 216 C "Count Power of 2" (2026-03-22), JS-translated, relaxed-N | 1 | spec_precision (bit-manipulation) + stateful_logic | hard | 3.5h translation + verification |
| H1 | Hand-authored: long-horizon convergence (8-step cascade) | 1 | convergence | hard | 3h author + 1h calibrate |
| H2 | Hand-authored: 12-file refactor with circular-import trap | 1 | multi_file_context | hard | 3h author + 1h calibrate |
| H3 | Hand-authored: 2x-density grammar parser | 1 | spec_precision | frontier | 4h author + 1.5h calibrate |
| H4 | Hand-authored gap-filler (axis TBD post-pilot — likely 2nd convergence at 6-step or 2nd multi_file at 8-file scale) | 1 | TBD (convergence or multi_file_context) | hard | 3.5h author + 1h calibrate |
| | **Total** | **12** | | | ~30h authoring + ~12h calibration |

Hand-authored cap dropped from 5–6 → 3 per design review, then bumped back to 4 after P2 sourcing reduced from 2 → 1 ports. Dropped from earlier scoping: tool-discipline-primary test (would re-litigate axis classification of `tool-confusion-redundant-verifies`, scope creep) and 15–20 file workspace (marginal axis-coverage gain over H2 and existing `large-refactor`). Multi-SWE-bench JS/TS deferred to Sprint 4 — adapter cost (npm-install layer in container) is real and orthogonal.

### Failure modes deliberately probed

Drawn from observed Qwen3.5-9B failure signatures (Sprint 1.18 tier-16/32 data, [`../NEW-EVALS-REPORT.md`](../base/NEW-EVALS-REPORT.md) Round-2/3 calibration):

| Failure mode | Probed by | Rationale |
|---|---|---|
| Spec density (csv-parser-class fails on 9B at lower tiers) | P1 (4 spec_precision Exercism translations) + H3 | csv-parser was 0/6 at t16/t32 pre-1.19; at 2x density it should re-floor on t16. |
| Recursive structure (json-schema-validate-class) | P2 (AtCoder Hard port) | Recursive validation defeats 9B at lower tiers historically; competitive-programming Hard often features recursive/dynamic-programming structure. |
| Long-horizon convergence (9B fatigue across >5 fix-iterate cycles) | H1 | `cascading-bugs` (5 steps) saturates; 8-step cascade with backtracking should re-floor t16. |
| Multi-file navigation under distractor pressure | H2 | `large-refactor` (6 files) saturates; 12 files + circular-import trap forces backtracking. |
| Algorithmic correctness without canonical-solution recall | P2 (post-Feb-2026 AtCoder) | Contests dated after Qwen3.5's Feb 2026 release are provably post-training-freeze; no editorial/accepted-submission recall path. |

### What this pack does NOT cover (explicit)

- **Productivity** — deferred to Sprint 3 (grader-human calibration prerequisite). Bolts on as a separate task suite per user direction.
- **Library-API axis (BigCodeBench-style)** — would require npm deps in the test container, against `Dockerfile` design. Out for 1.21; revisit if a future sprint accepts the container-rebuild cost.
- **Hidden-holdout siblings** — Sprint 4 territory per `../base/HIDDEN-HOLDOUT-POLICY.md`. Public tests authored here may have hidden siblings *later*; do not author both in 1.21.
- **t64 discrimination** — t64 still runs Qwen3.6-35B-A3B; cross-tier comparison would mix model families. Out until t64 model swap.
- **Multi-SWE-bench full integration** — npm-install workspace adapter is genuine harness work; defer to a focused future sprint.

---

## Calibration protocol

Each candidate test runs the gauntlet below before merging into the core matrix. Failed tests either drop or move to a Layer-D `frontier` reserve.

### Step 1 — Hand-solve audit (EVAL-DESIGN.md rule #1)

Author must hand-solve the task in **<10 minutes** from `prompt + seed alone`. If the seed scaffolding is too large to read in 10 minutes (a real concern for Aider-Exercism translations with multi-file fixtures), **inline relevant fixture content into the prompt** to honor the rule. If a candidate cannot honor the 10-min rule, classify as `difficulty_band: frontier` (Layer-D reserve) and don't put it in the core matrix.

### Step 2 — Pilot N=5 on t16 + t32 (skip t64)

Run with `RUN_REGISTRY_EMIT=1` and frozen `--ctx` JSON for each tier. (Reminder: registry rows only emit when this env var is set — see [`../../lib/claw.js`](../../lib/claw.js) line 211.)

### Step 3 — Reject criteria (any single criterion fails → reject or reclassify)

| # | Reject if | Reason |
|---|---|---|
| R1 | t16 OR t32 pass rate is 0/5 or 5/5 | No signal (EVAL-DESIGN red flag) |
| R2 | t32 timeout rate ≥ 25% (`terminal_status='timeout'`) | Measuring harness, not capability (EVAL-DESIGN red flag #4) |
| R3 | t16 OR t32 `terminal_status='harness_error'` rate ≥ 1/5 | Registry-assembly failure, not model failure ([`../../lib/run_row.js`](../../lib/run_row.js) line 171) |
| R4 | t16 OR t32 `passed=null` rate > 20% | Test produces interpretable result <80% of the time (`run_row.js` line 174–178) |
| R5 | t32 `iters_count` p90 > 25 | Retry-storm territory, measuring agent-loop pathology (`iters_count` available since Sprint 1.16b — `run_row.js` line 120) |
| R6 | t32 pass rate > 85% | Re-introduces saturation; the gate we're trying to fix |
| R7 | Hand-solve > 10 min OR seed leaks answer (TODO/FIXME, hint-y filenames) | EVAL-DESIGN rules #1, #8 |
| R8 | Aider/Exercism port: t16 ≥ 70% AND solution structurally identical to canonical Exercism reference | Memorization, not capability — see Contamination Risk below |

### Step 4 — Keep band (all four required)

- t16 pass rate ∈ **[10%, 80%]**
- t32 pass rate ∈ **[25%, 85%]** (tighter ceiling than scoping draft, per design review — 95% would re-create saturation)
- |t32 − t16| ≥ 15pp at N=5 OR test is axis-critical (e.g., the only spec_precision test landing in band)
- All R1–R8 cleared

**OR:** test classifies under R9-A (`ctx_discriminator`) — see §R9. R9-A cells skip Step-4 keep-band and qualify directly toward the verification gate.

### R9 — ctx-axis classifier (NEW 2026-05-03; cycle-3 reframe)

R1–R8 above are **reject** criteria (test fails, drop or move to frontier). R9 is a **classifier** — it does not reject; it labels a cell as belonging to a separate discrimination axis (per-turn context efficiency) that the original keep-band was blind to.

Cycle-3 evidence: tests like `book-store` and `two-bucket` produced t16 0% / t32 100% on N=3, with t16 failures all `ctx_overflow_400` (legitimate "request exceeds 32k context" 400 from llama-server). At t32 (Q5_K_XL @ 64k ctx) the same tests converge cleanly. This is real architectural signal — model converges in fewer turns at higher quant, fits in less ctx — but the keep-band would have rejected these as floor (R1) on t16. They are not floor; they are ctx-discriminating.

**R9-A `ctx_discriminator` (counts toward verification gate):**

| Tier | Condition |
|---|---|
| Tier X | ≥66% of reps end in `terminal_status='error'` AND error class is `ctx_overflow_400` (real "request exceeds context size" 400 from llama-server, **NOT** bridge `stream_aborted_mid_run+count_mismatch` noise) |
| Tier Y (the OTHER) | ≥66% of reps pass cleanly (`terminal_status='done'` AND `passed=true`) |

Direction-agnostic: works whether t16 is the ctx-bound side (the expected case for this model + configs) or t32 (theoretical; not observed yet). At N=3 screening, ≥66% means 2/3 or 3/3.

**R9-B `ctx_floor` (Tier D — does NOT count):**

- ≥66% `ctx_overflow_400` on **both** tiers → cell is a genuine ctx ceiling for current model + configs at both tiers (e.g., `wordy` post-cycle-3). Reclassify `suite_layer: D, difficulty_band: frontier` and reserve.

**Transient filter (mandatory before R9 fires):**

R9 distinguishes legitimate `ctx_overflow_400` (real model behavior — claw stderr shows `request (NNNNN tokens) > NNNNN ctx`) from bridge `stream_aborted_mid_run+count_mismatch` (the bridge dropped the SSE stream, claw eventually timed out from above, model never had a fair chance — see [`../../../litellm/docs/TODO-1.21-bridge-error-diagnostics.md`](../../../litellm/docs/TODO-1.21-bridge-error-diagnostics.md) anomaly #2). Filter out the latter as transient noise BEFORE counting toward R9-A or R9-B. At Sprint 2 confirmatory N=60, the ~5–8% bridge-transient rate would otherwise inflate the ctx_overflow_400 count and could mislabel a cell.

**Verification gate count = (pass-rate keep-band cells) ∪ (R9-A cells), targeting ≥6.**

### Step 5 — Classify and merge

- Pass calibration → manifest header tagged with appropriate `difficulty_band`, `expected_tier_signature`, and `known_confounds`; commit to `host/test/__tests__/tier-eval/<test-id>.test.js`.
- Borderline (R6 violation only) → reserve as future ceiling probe; do not include in core matrix.
- Frontier (R7 hand-solve violation) → `suite_layer: D`, `difficulty_band: frontier`; reserve.

---

## Statistical sizing

### Wilson 95% CI half-widths (single proportion)

Computed from the standard Wilson formula at z=1.96. Re-derived after design-review caught a ~2× error in an earlier draft.

| N | half-width @ p=0.5 | half-width @ p=0.7 | half-width @ p=0.85 |
|---|---|---|---|
| 8 | ±31pp | ±27pp | ±21pp |
| 20 | ±21pp | ±19pp | ±15pp |
| 40 | ±15pp | ±14pp | ±11pp |
| 60 | ±13pp | ±11pp | ±9pp |

**Implication for screening (N=8):** Wilson CIs are too wide to declare durable discrimination; consistent with Sprint 1.18's `screening_only=true` discipline. Calibration-pilot N=5 is even wider — sufficient only to identify candidate discriminators and reject pathologies (R1–R5), not to label.

### Newcombe-Wilson power calc for Sprint 2 confirmatory (difference of proportions)

Detecting Δ = 25 percentage points at α=0.05, power=0.80:

| p₁ vs p₂ | Required N per cell (independent) |
|---|---|
| 0.50 vs 0.75 | ~55 |
| 0.60 vs 0.85 | ~47 |
| 0.65 vs 0.90 | ~39 |

**Recommendation: N=60 per cell for Sprint 2 confirmatory at the planned 25pp target**, not the V2 plan's footnoted N=40. The V2 plan's "n=40 is a starting point, not a power guarantee — recompute per comparison" caveat already anticipates this; we're cashing in the caveat.

Paired-seed structure (which Sprint 2's plan calls for) reduces variance modestly; with high pairing correlation, an effective N=45–50 per cell may suffice. **Default to N=60 unless paired-seed correlation is measured at ≥0.5 in the pilot.**

Reference: [Bowyer, Aitchison, Ivanova. "Position: Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints." ICML 2025 position paper (arXiv:2503.01747)](https://arxiv.org/abs/2503.01747). Argues CLT/normal approximation underestimates uncertainty in small-sample LLM evals; recommends Wilson and similar coverage-improved alternatives.

### Saturation budget for the 12 new tests

Even if every new test lands cleanly in the discriminative middle, the *combined* 38-test pack (26 existing + 12 new) will still aggregate-saturate because the 26 are still ceiling-pinned. **Per-test cell-level Wilson CIs are what Sprint 2 needs**, not aggregate pass rate. The aggregate is already not a publishable metric per [`../EVAL-DESIGN.md`](../base/EVAL-DESIGN.md) ("Forbidden in any leadership-facing artifact: 'tier-32 scored X%'"). So this is not a problem; we just need to remember it when describing results.

---

## Sourcing — concrete details

### P1: Aider/Exercism JS hand-translations (7 tests)

Locked picks: book-store, wordy, alphametics, word-search, forth, grade-school, two-bucket. Runner-up bench: ledger, robot-name, zebra-puzzle, poker.

Selection process:

1. **Filter to "Hard" Exercism difficulty** in JS (Exercism rates each exercise easy/medium/hard).
2. **Cross-filter against Aider leaderboard data**: pick problems where Qwen3-coder-class models score in the **30–60% range** (discriminative middle), not the 0–15% floor. Sourcing the hardest problems re-creates the floor problem; we want middle-mass.
3. **Per-port mutation pass** (R8 mitigation):
   - Rename functions/variables (`reverseString` → `flipChars`)
   - Shift edge cases (empty input, Unicode, off-by-one boundary moves)
   - Modify return shapes where semantically equivalent (array of pairs vs object of arrays)
   - Inline relevant fixture into the prompt; do NOT load Exercism's `package.json`/`jest.config.js` (incompatible with our npm-free container anyway)
   - Translate test cases to `node:assert/strict` against an authored `verify.js` template-literal, following the [`../../__tests__/tier-eval/expression-eval.test.js`](../../__tests__/tier-eval/expression-eval.test.js) pattern (canonical example of a complex hand-authored verify script)
4. **Per-port memorization audit** (R8 enforcement): if t16 N=5 pilot pass rate ≥ 70%, hand-inspect produced solution against the Exercism canonical reference. Structurally identical → mutate harder; rerun pilot. Repeat or reject.

License posture: Exercism content is per-exercise licensed (mostly MIT, some CC-BY-SA, some unclear). After mutation step the test is a derivative; preserve attribution in the test file's manifest `notes` field (`"adapted from Exercism JS '<exercise>' under <license>"`). Per-exercise audit before commit; document in PR.

Budget: ~7 ports × 2.5h = 17.5h.

### P2: AtCoder ARC 216 C "Count Power of 2" (2026-03-22), relaxed-N (1 test)

**Why not LiveCodeBench:** LCB v6 (current public release) tops out at Apr 2025. Qwen3.5 shipped Feb 2026 and Qwen3.6 shipped Mar 2026; the model's exact training-data freeze is undisclosed by Alibaba but is necessarily ≤ release. We cannot prove any LCB v6 problem is post-freeze, only that it is "released N months before the model shipped" — a soft defense. Direct sourcing from contests dated **after Feb 2026** gives a hard post-release guarantee that LCB v6 cannot.

**Why one P2 port, not two:** Manual statement-fetching from Codeforces/AtCoder is high-overhead. Of 4 candidates browsed, 3 disqualified (CF 2207 D = game-theory, CF 2211 E = interactive, CF Edu-187 C = below band). Continuing the loop is low-yield. Locked on A3 only; second slot redirected to H4. The single P2 still serves the core purpose: a contamination-detection signal — compare A3's pass rate to spec_precision-similar Aider ports; systematic Aider over-performance is evidence of memorization.

**The locked port:** [ARC 216 C "Count Power of 2"](https://atcoder.jp/contests/arc216/tasks/arc216_c), released 2026-03-22 (5 weeks post-Qwen3.5 release; provably post-freeze). Score 800. Statement: given non-negative integers A_1...A_N, count subarrays (l,r) where ∑ 2^A_i is a power of 2.

**Scope adjustment (relaxed N):** Original constraints (N ≤ 2×10⁵, A_i ≤ 2×10⁵) require a non-trivial amortized algorithm and exceed the <10-min hand-solve rule. We present the model with **relaxed constraints (N ≤ 100, A_i ≤ 100)**, which admits an O(N² log) brute force using `BigInt` and a `(s & (s-1n)) === 0n` power-of-2 check. The test then probes spec_precision (correctly implementing the multi-condition spec) rather than algorithmic ingenuity. Hand-solve becomes trivial on the published sample (`N=4, A=[0,1,0,2] → 6`).

**Verifier:** author-written brute force (~15 lines), runs against 8–10 hand-authored test cases including edges:
- single element (any A_i) → 1
- all zeros (`[0,0,0]`) → 6 if all subarrays sum to a power of 2 (verify by hand)
- all distinct ascending (`[0,1,2,3]`) → 4 (singletons only)
- consecutive equal pairs (`[1,1,2,2]`) — exercise the carry-merge mechanic
- sum that is power-of-2 only via long chain (`[0,0,1,2,3]`)
- N=100 stress with mixed values (sanity check)

**Contamination posture:** post-Feb-2026 contest problem; editorial published on AtCoder post-2026-03-22; no editorial reposts on personal blogs predating Qwen3.5's training freeze. This is a **hard** post-release guarantee, distinct from P1's mutation-based defense. Manifest `notes` must record contest URL + date for future audit.

**License:** AtCoder problem statements are owned by AtCoder under their ToS (educational/research use permitted with attribution; no verbatim redistribution). The committed test ships a **paraphrased** problem statement (author-written) + author-written sample tests + author-written verifier — a derivative work. Preserve attribution in manifest `notes`: `"problem inspired by AtCoder ARC 216 C 'Count Power of 2' (2026-03-22), <URL> — paraphrased; author-written sample tests"`.

**Budget:** 1 × 3.5h = 3.5h.

### H1, H2, H3, H4: hand-authored gap-fillers (4 tests)

Probe failure modes that external benchmarks underweight.

- **H1: 8-step cascading convergence** — extends `cascading-bugs` (5 steps) to 8 unrelated bugs across 8 files, where the test runner exits on first failure. Optional: introduce a partial-circular-import that forces backtracking on bug #5. Probes long-horizon iteration fatigue. Target: t16 30–60%, t32 60–85%.

- **H2: 12-file refactor with circular-import trap** — extends `large-refactor` (6 files threading currency) to 12 files threading two parameters, where naive ordering creates a circular import that the model must resolve by re-architecting. Probes multi-file navigation + planning. Target: t16 20–50%, t32 50–80%.

- **H3: 2x-density grammar parser** — twice the assertion count of `expression-eval` (currently 25+). Candidate grammars: HTTP/1.1 chunked-transfer encoding, SemVer range expressions, glob-pattern matching, mini-regex with character classes + alternation + groups. Probes spec_precision under dense edge surface. Target: t16 10–40%, t32 30–60%.

- **H4: post-pilot gap-filler** — axis decided after A3 + H1/H2/H3 pilots reveal which axis-coverage gap is deepest. Default proposal: 2nd convergence test at intermediate difficulty (6-step cascade between `cascading-bugs` and H1) OR 2nd multi_file at 8-file scale between `large-refactor` and H2. Resolve at step 8.

Budget: 4 × ~3.5h = 14h.

---

## Harness affordances — what changes, what doesn't

### No changes required (reusing as-built)

- Test file location, manifest header format, `runClaw` contract, `writeAssertionResult` flow, registry emission via `RUN_REGISTRY_EMIT=1`.
- Default `timeoutMs = 240_000` for most tests; the 360s precedent (already used by [`../../__tests__/tier-eval/expression-eval.test.js`](../../__tests__/tier-eval/expression-eval.test.js) line 132) covers anything that runs longer. Do not lift to 600s for any 1.21 test — that crosses the EVAL-DESIGN red flag #4 ("strongest model times out >25% → measuring harness").
- Inline template-literal fixtures (no `loadFixture` helper). Plan-agent review correctly flagged that committing fixture directories pulls upstream Exercism content into the repo with its license footprint. Inline strings keep the contamination/license posture clean.

### Two changes considered, both DEFERRED to 1.22/1.23

- `lib/workspace.js` `loadFixture(dir)` helper — defer. Existing inline pattern works; helper is scope creep for 1.21 and triggers a `docker compose build test` cycle. Fixture *content* should remain inline regardless (license/contamination posture).
- `lib/standardTest.js` control-flow helper — defer. Would extract the duplicated `workspace.reset` → seed-write → `runClaw` → post-script → `writeAssertionResult` → timeout-guard → assert sequence. Real technical debt (Sprints 1.10 and 1.16a both required mechanical sweeps across 20–32 files), but landing it during 1.21 risks helper API churn during authoring and adds a container rebuild to the critical path. Logged as a 1.22/1.23 follow-up; design rationale captured in [`../base/standardtest-helper.md`](../base/standardtest-helper.md).

### Authoring template (canonical pattern)

Copy [`../../__tests__/tier-eval/expression-eval.test.js`](../../__tests__/tier-eval/expression-eval.test.js)
as the starting point for each new test file — manifest header, imports,
`describe`/`it` structure, and timeout-guard ordering. No harness changes
needed.

---

## Risks & mitigations

### R-1: Contamination — Exercism content on GitHub since 2013

- **Severity:** High. Qwen2.5/Qwen3 training cutoffs almost certainly cover Exercism JS plus their canonical solutions.
- **Failure mode if unmitigated:** Tests pass on small models via memorization, not capability. Discrimination matrix interpretation is invalidated — we'd be measuring training-set recall, not spec_precision/stateful_logic.
- **Mitigation (mandatory):** Per-port mutation step (rename + edge shift + return shape change) + R8 calibration check (memorization audit if t16 ≥ 70%). P2 uses post-Feb-2026 sourcing as a hard post-release defense.
- **Residual risk:** Mutation may not fully sever recall paths for popular Exercism exercises. **Prefer Exercism exercises with low GitHub fork count** as a structural defense; document the choice in manifest `notes`.

### R-2: License — per-exercise Exercism audit

- **Severity:** Medium. Mostly MIT but heterogeneous.
- **Mitigation:** Per-port license audit before commit. Document the license in the test file's manifest `notes` field. After mutation, the test is a derivative; preserve attribution. Get legal-equivalent sign-off in the PR.

### R-3: Container constraints — npm-free Dockerfile

- **Severity:** Already mitigated at design time. Ports must hand-translate to `node:assert/strict`; do not import Jest/Mocha/etc.
- **Detection:** PR review against `host/test/Dockerfile` and any Aider port that imports a non-`node:` module.

### R-4: Saturation overshoot — tests too hard

- **Failure mode:** All new tests floor at t16 0/5 → R1 reject → wasted authoring time → 1.21 misses gate.
- **Mitigation:** "Discriminative middle" sourcing heuristic (P1 step 2) prefers Aider problems where Qwen3-coder-class scores 30–60%, not the hardest problems. Pilot before committing.

### R-5: Sequencing — Sprint 1.20 (downgraded from hard prereq to partial dependency)

- **Status (2026-05-02):** 1.20 is being worked in parallel by another engineer. Not blocking 1.21 authoring or t32 pilots.
- **Why it matters:** R3 calibration check (`harness_error` reject) presupposes a low background harness-error rate. t16's pre-1.20 baseline is 13.5%; probability of ≥1 harness_error in 5 attempts at that rate is ~52%. So roughly half of all candidate tests would trip R3 on t16 from background noise alone, not test-specific failure. t32's 2.9% baseline is fine; R3 is interpretable on t32 as-is.
- **Mitigation (Option A, in effect):** Run t32 pilots immediately with R3 enforced. Run t16 pilots concurrently but treat R3 trips on t16 as `re-pilot post-1.20` rather than auto-reject. Other reject criteria (R1, R2, R4, R5, R6, R7, R8) fire normally on both tiers. When 1.20 lands, re-pilot only the t16-R3-deferred set.
- **Fallback if 1.20 slips materially:** Drop to Option B (defer t16 pilots) or Option C (temporarily relax R3's t16 arm to ≥2/5). Both documented above for completeness; Option A is current default.

### R-6: Wilson sizing — math credibility

- **Why:** A draft of this proposal had a ~2× error in Wilson half-widths. Caught and corrected by independent review.
- **Mitigation:** Numbers in this revision are from the Wilson formula directly. Recommended Sprint 2 confirmatory N is **60 per cell**, not 40. The V2 plan's "n=40 is a starting point, not a power guarantee — recompute per comparison" caveat is now operationalized.

---

## Execution order (with GPU scheduling)

The proposal mixes "what to build" (Sourcing) with "how to test it" (Calibration). This section linearizes execution and tags each step for GPU/chip scheduling. Steps 1–6, 8, 10 are entirely chip-independent — they can run while a separate sweep holds the chip. Only steps 7 and 9 require exclusive chip time.

| # | Step | GPU? | Notes |
|---|---|---|---|
| 1 | Research / sourcing (Aider exercise selection in 30–60% Qwen3-coder-class band; post-Feb-2026 AtCoder contest selection; H1/H2/H3 design) | No | Web + leaderboard browsing only |
| 2 | Per-port mutation pass (rename, edge shift, return shape changes) | No | Text edits |
| 3 | License audit (per-exercise Exercism check; AtCoder ToS check, attribution prep) | No | Read-only |
| 4 | Hand-solve audit (<10 min rule, EVAL-DESIGN.md rule #1) | No | Author's own work; reclassify to `frontier` if >10 min |
| 5 | Author 12 `.test.js` files against the canonical template | No | Disk-only |
| 6 | Manifest validation (`readManifest('<id>')` per file) | No | Pure Node, no model invocation |
| 7 | **Pilot N=5 on t16 + t32** with `RUN_REGISTRY_EMIT=1` | **Yes** | Plist swap claims chip exclusively per `run-overnight-screen.sh`. ~120 attempts (12 × 2 × 5). Budget ~2–4 hours serial including plist swap + cold-load. |
| 8 | Memorization audit R8 (post-pilot Exercism-canonical comparison) | No | Hand-compare produced solution vs canonical reference for any t16 ≥ 70% port |
| 9 | **Mutate/replace rejects + rerun pilot** | **Yes** | Expect ~25% reject rate → 1–2 additional pilot passes. Budget +1–3 hours. |
| 10 | Classify, commit manifest tags, merge | No | Manifest tagging + commit |
| — | Sprint 2 confirmatory N=60/cell (downstream, NOT in 1.21 scope) | Yes | 12 × 2 × 60 = 1440 attempts → overnight sweep |

**Total GPU budget for 1.21 calibration: ~3–7 hours** of exclusive chip time, split across 1–3 pilot sessions. All other authoring work parallelizes off-chip.

**Hard constraint:** do not launch step 7 while another sweep holds the chip. Confirm `RUN_REGISTRY_PATH` of any in-flight sweep is no longer being written before pilot kickoff.

---

## Sequencing & parallelism

### Hard prerequisites (do not start 1.21 calibration until landed)

1. **Sprint 1.20** (t16 harness-error triage) — without this, R3 calibration check is uninterpretable on t16. Per the V2 plan, 1.20 is "soft gate" for matrix; for *this* proposal it's a partial dependency (see R-5 above).
2. **Sprint 1.5 cuts** — code-review verdicts shouldn't be in flight while we author against `lib/`. Most cuts already documented in [`../CODE-REVIEW.md`](../base/CODE-REVIEW.md) per V2 plan §1.5.

### Parallelizable streams (independent; can be authored concurrently)

- **Stream A:** P1 Aider hand-translations (7 tests) — single author, sequential.
- **Stream B:** P2 ARC 216 C port (1 test, A3 locked) + H4 hand-authored gap-filler (1 test, axis TBD post-pilot) — independent of A.
- **Stream C:** H1/H2/H3 hand-authored gap-fillers (3 tests) — independent of A, B.

A, B, C share only the manifest schema (already shipped) and the canonical test template above. Three authors → ~5 days; one author → ~2 weeks.

### Calibration convergence

See **Execution order** table above (steps 7–10). Expect ~25% rejection rate (3/12) → 1–2 pilot iterations after the initial pass.

**Estimated total:** ~1.5–2 weeks single-author, ~1 week with three-way parallelism (per V2 plan timeline footnote for 1.21).

---

## Critical files

### To modify

- `host/test/__tests__/tier-eval/<new-test-id>.test.js` — 12 new files
- [`../TIER-EVAL-V2-SPRINT-PLAN.md`](../base/TIER-EVAL-V2-SPRINT-PLAN.md) — flip row 1.21 from `planned` → `in-progress` → `done`
- [`memos/n8-confirm-vs-baseline.md`](memos/n8-confirm-vs-baseline.md) — annotate "Recommended next actions" item 3 as in-flight

### To reuse without modification

- [`../../lib/claw.js`](../../lib/claw.js) — `runClaw` + `writeAssertionResult` (line 211 for emit-on-env-var)
- [`../../lib/run_row.js`](../../lib/run_row.js) — terminal_status enums (line 39, 171)
- [`../../lib/test_manifest.js`](../../lib/test_manifest.js) — manifest validator
- [`../../lib/schemas/test_manifest.schema.json`](../../lib/schemas/test_manifest.schema.json) — 7 required fields
- [`../../lib/workspace.js`](../../lib/workspace.js) — reset/exists/read/list (no changes; no `loadFixture` added)
- [`../../__tests__/tier-eval/expression-eval.test.js`](../../__tests__/tier-eval/expression-eval.test.js) — canonical pattern for complex `verify.js` template literals

### Not modifying (explicit)

- `host/test/Dockerfile` — npm-free design; not adding Jest/Mocha/jsdom. (Hidden-holdout siblings and `loadFixture` helper are deferred per [Explicit deferrals](#explicit-deferrals-for-proposal-review).)

---

## Verification

End-to-end checks before declaring 1.21 done:

1. **Manifest validation:** `node -e "import('./lib/test_manifest.js').then(m => m.readManifest('<id>'))"` for each new test_id → returns valid object, no throws.
2. **Pilot sweep:** N=5 per test on t16 + t32 with `RUN_REGISTRY_EMIT=1` and frozen `--ctx`. Verify `expected-attempts.mjs` diff = 0/0.
3. **Reject criteria:** every committed test cleared R1–R8 with witness data in a `1.21-calibration-log.md` artifact.
4. **Smoke run:** existing `sprint1-emit-smoke.mjs` extended to validate one new test from each stream (P1, P2, H1/H2/H3 representative). 14/14 → 17/17 expected.
5. **CI emission:** All 12 new tests produce registry rows on at least one t16 and one t32 attempt during pilot. No `harness_error` rows on author/CI machines.
6. **Hand-solve audit log:** for each test, a 1-paragraph note in PR body showing the author solved it from prompt+seed in <10min (or marking it `frontier`).
7. **Sprint 2 dry run:** with 12 new tests committed, generate a draft `discrimination_matrix_v1.csv` from the pilot data (N=5, screening only) and confirm at least 6 cells land in the discriminative middle band.

---

## Explicit deferrals (for proposal review)

The following are **out of scope for 1.21** and tracked for future sprints:

| Deferred | Sprint | Why |
|---|---|---|
| Productivity (rubric-judged) tests | Sprint 3 | Grader-human calibration prerequisite; explicitly Sprint 3 work per V2 plan |
| Hidden-holdout siblings | Sprint 4 | Per `HIDDEN-HOLDOUT-POLICY.md` |
| t64 model swap (so t64 also runs Qwen3.5-9B base) | Future | Cross-tier comparison currently mixes model families; single-tier-family swap is its own work |
| Multi-SWE-bench JS/TS full integration | Future | Requires npm-install workspace adapter; orthogonal to discrimination-matrix gate |
| BigCodeBench Python adapter | Future | Requires Python toolchain in container; against `Dockerfile` design |
| `tool-confusion-redundant-verifies` axis re-classification (convergence → tool_discipline) | 1.22 or later | Manifest-level fix; standalone work |
| `lib/workspace.js` `loadFixture` helper | 1.22 or later | Scope creep; existing inline-fixture pattern is sufficient |
| `lib/standardTest.js` control-flow helper | 1.22 or 1.23 | Real technical debt but lands cleanly only when not in the 1.21 authoring critical path; see standardtest-helper memo |
| Tool-discipline-primary new test | 1.22 or later | Marginal axis-coverage gain at this difficulty band; revisit after 1.21 lands |

---

## References

1. **Bowyer, Aitchison, Ivanova.** *Position: Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints.* ICML 2025 position paper, [arXiv:2503.01747](https://arxiv.org/abs/2503.01747). Argues CLT/normal approximation underestimates uncertainty in N<200 LLM evals; recommends Wilson and Bayesian alternatives. Cited for confirmatory-N sizing rationale (§ Statistical sizing).

2. **Jain et al.** *LiveCodeBench: Holistic and Contamination-Free Evaluation of Large Language Models for Code.* [arXiv:2403.07974](https://arxiv.org/abs/2403.07974); [livecodebench.github.io](https://livecodebench.github.io/). Considered as P2 source and rejected: LCB v6 (current public release) tops out Apr 2025, fully pre-Qwen3.5 (Feb 2026). P2 redirects to direct AtCoder sourcing dated ≥ Feb 2026 for a hard post-release contamination guarantee. LCB methodology (post-cutoff dating, contamination-controlled benchmarking) still informs the approach.

2a. **Codeforces** ([codeforces.com](https://codeforces.com/)) and **AtCoder** ([atcoder.jp](https://atcoder.jp/)). Direct competitive-programming contest sources for P2; problems dated ≥ 2026-02-15 are provably post-Qwen3.5 release.

3. **Aider polyglot benchmark.** [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/). 225 Exercism exercises × 6 languages; source for P1 (JS subset, hand-translated).

4. **Zhuo et al.** *BigCodeBench: Benchmarking Code Generation with Diverse Function Calls and Complex Instructions.* ICLR 2025 ([arXiv:2406.15877](https://arxiv.org/abs/2406.15877)). Cited as the literature alternative we considered and rejected for 1.21 (Python-only library-call evaluation; would require container changes against design).

5. **Yang et al.** *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* [swebench.com](https://www.swebench.com/) / SWE-bench Multilingual / SWE-bench Pro. Cited as the inspiration for Multi-SWE-bench JS/TS deferred work.

6. **Internal:** [`../EVAL-DESIGN.md`](../base/EVAL-DESIGN.md) — eight rules + difficulty-band definitions + decision rule (§9.2). All R1–R8 reject criteria trace to one of these.

7. **Internal:** [`memos/n8-confirm-vs-baseline.md`](memos/n8-confirm-vs-baseline.md) — saturation finding driving this work.

---

## Open questions for staff-scientist review

Methodological/technical questions specific to this pack. Strategic and
stakeholder-level questions (P2 expansion, contamination provenance in
the published matrix, etc.) live in
[`README.md`](README.md#open-questions-for-stakeholder-review).

1. Is **N=60 per cell** the right Sprint 2 confirmatory target, or is a paired-seed-corrected lower N (45–50) preferred? Depends on measured paired-seed correlation in the pilot — would adding a paired-seed correlation measurement to the pilot protocol be worthwhile?
2. R6 ceiling at **t32 ≤ 85%** — too tight? Allows a successful test that lands t32=87% to be reclassified as ceiling probe rather than discriminator. Tighter = more discrimination value per test, looser = more tests survive calibration.
3. Mutation depth for P1 Aider ports: where on the spectrum from "rename variables" to "redesign the spec" should we land? Heavier mutation = stronger contamination defense, but at some point we've authored a new test inspired by Exercism rather than ported one — is that acceptable, and if so should we relabel the source as `inspired_by` not `adapted_from`? (The naive 32B → 9B parameter-count extrapolation question is captured separately in [`memos/aider-calibration-note.md`](memos/aider-calibration-note.md).)
