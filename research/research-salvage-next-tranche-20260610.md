# Research salvage: fruitful threads for the post-migration tranche

**Date:** 2026-06-10 · Companion to
[docs-audit-defunct-20260610.md](docs-audit-defunct-20260610.md). The
migration suite (#001–#011) is complete; the lab now has one stack
(OpenCode + discipline prompt + resident `:11436`), one instrument (the
generic config-vs-config driver, `ARMS`/`BASELINE`/`TIER`), and a baked
runner image that cut Phase-B startup 49s → ≤1s. This doc inventories which
prior research survives the architecture change, what each thread needs to
restart, and a ranked shortlist.

## What changed underneath the research

Three migration outcomes reshape every thread below:

1. **The instrument got cheaper and more general.** Any
   config-vs-config question (prompt, sampler, model, thinking, tier) is now
   a driver invocation with paired-bootstrap CIs, pre-registerable gates,
   and fingerprinted rows — the machinery that produced the migration
   verdicts is reusable as-is.
2. **The mechanism finding reframes old questions.** Claw's advantage
   decomposed as: grammar redundant, harness loop ≈ 0, **prompt = the moat**
   (+6.6pp [+3.1, +10.2] isolated at tier-16). Threads premised on
   grammar-side or loop-side levers are dead; threads about *prompt content*
   and *model-strength interaction* are promoted.
3. **The bridge is gone.** Several anomalies and gaps were claw-bridge
   artifacts or claw-bridge-only instrumentation; each needs re-basing, and
   some may simply dissolve.

---

## Thread inventory

### 1. Prompt decomposition — the moat is unexamined *(highest leverage)*

The single largest causal effect the lab has measured (+6.6pp at tier-16) is
attributed to ~ten lines of markdown (`host/llama-server/docs/system-prompt.md`),
measured only as a block. Nothing is known about which rules carry it, whether
it's additive, or how the effect scales with model strength (tier-64 needs it
less by hypothesis — that's testable and thesis-relevant: *discipline
prompting as a substitute for model capability*).

- **Salvage**: the sidecar-port arm design (`opencode-a+git` as the
  delivery-mechanism control) is exactly the template for line-ablation arms.
- **Cost**: each arm is one driver run; tier-16 on-demand, AFK-safe.
- **Caveat carried forward**: between-task heterogeneity (per-task deltas
  span ±48pp) dominates CI width — pre-register coarse contrasts (e.g.
  halves, then quarters), not ten single-line arms.

### 2. Re-base the anomaly file — cheap falsification wins

Several flagged anomalies were plausibly bridge artifacts. The bridge no
longer exists, so each is a fast, decisive re-run:

- **needle-haystack tier-64 inversion**
  (`usability-pack/memos/needle-haystack-t64-inversion.md`) — root-caused to
  bridge SSE deadlock + an 8.6s routing error. If it vanishes on the new
  stack, the cell re-enters the pack; if not, it's a real model finding.
- **book-store / two-bucket transcript anomalies** (parked in decision §5) —
  now inspectable once the transcript adapter exists (thread 4).
- **grep-search workspace-leak**
  (`usability-pack/memos/grep-search-claw-runtime-leak.md`) — the failure
  mode (fixture-literal self-poisoning via unscoped search) is
  harness-independent and OpenCode's tools need the same audit; the proposed
  mitigation ranking transfers.

### 3. Thinking-on evaluation — explicitly unmeasured at every tier

All evidence to date is thinking-off (#017 parity; decision §4 carries it as
a scope boundary). Thinking-on is now just another arm: the per-request
`enable_thinking` kwarg is probe-verified at all three tiers (#011 confirmed
tier-32). Interesting crossing: does thinking-on at tier-16/32 buy what the
discipline prompt buys, and do they stack? Combines naturally with thread 1
as a 2×2.

### 4. Transcript adapter + token accounting (#021/#022 specs) — the enabling investment

Two fully-written, deferred specs are the gate to everything trace-level:

- `client/opencode/docs/SESSION-LOG-FORMAT.md` — OpenCode's SQLite session DB
  is authoritative (the JSON event stream is lossy); WAL and `run --rm`
  ephemerality caveats already mapped; schema-v1 mapping sketched.
- `host/test/docs/OPENCODE-SERVER-TIMINGS.md` — prompt/decode timings via
  log-cursor, blocked only on #021's ordinal join.

Deliverable: iteration records + token fields in the registry. This unlocks
threads 5 and 6 and closes the "registry carries no token fields" scope gap.

### 5. Iteration-distribution program (W1–W5) — parked at W4, taxonomies intact

The richest dormant program (`TODO-ITERATION-DISTRIBUTION-TEST.md` v2 plan;
results in `W2-W3-RESULTS-20260428.md`). What survives the migration:

- **Frozen taxonomies** — failure A–F (`W4-TAXONOMY.md`, E deprecated under
  widened timeouts) and productive P1–P5 (`W4-TAXONOMY-PRODUCTIVE.md`), plus
  the classifier prompts (`scripts/analysis/classifier-prompt*.md`). All
  conceptually harness-independent.
- **Findings** — tail-heavy iteration distributions are real (csv-parser
  p90/median 2.48); wallclock is ~99.4% model time; iter-count association
  ρ > 0.8.
- **Needs re-basing** — the W1 telemetry schema was claw-bridge
  (`bridge.iterations.jsonl`); its replacement *is* thread 4's adapter.
  Levers must be re-derived: grammar-class levers (D) are void; prompt-side
  levers get promoted per the mechanism finding.

### 6. Tier-eval v2 sprint remainder — Sprints 2–4 are the backbone

The pre-migration roadmap (`TIER-EVAL-V2-SPRINT-PLAN.md` +
`TIER-EVAL-STRATEGIC-HANDOFF-20260429.md` framing: cross-tier
*discrimination matrix*, not single-tier audit) resumes on a faster
substrate:

- **Sprint 2 confirmatory N=60** — difficulty-pack roster is locked and
  calibrated (`good-tests.md`: book-store, wordy, twelve-file-refactor v3,
  word-search v2.1, two-bucket); the baked runner makes the sweep
  meaningfully cheaper than when it was planned.
- **Sprint 3 productivity grading** — `productivity-grader-notes.md` is a
  complete grader architecture (deterministic → semantic → pinned judge →
  human calibration, κ ≥ 0.7 gate) waiting on task authoring.
- **Sprint 4 hidden holdouts** — `HIDDEN-HOLDOUT-POLICY.md` ready as written.
- **Probe ports** — latency/prose-quality/tool-discipline probes were
  claw-bridge-only (no registry rows; decision §4). Rebuild as driver arms +
  thread-4 timings rather than porting the old probe code.

### 7. Sampler work — revive only with a sharper design

Two honest negative/partial results constrain this thread:
`TIER-EVAL-MEMO-20260428-sampler-v2.md` (8-cell grid below the variance
floor at n=3) and `W2-W3-RESULTS-20260428.md` (n=20 underpowered for
retirement). One live lead: tier-32 candidate C1 (+14.2pp, unconfirmed —
`T32-TUNING-PROGRESS.md`, including C2's instructive premature-exit failure
mode). Salvage the *methodology* (equivalence-based retirement, tail-metric
battery, candidate-log format from `W2-W4-ANALYSIS-METHODS-LIBRARY.md`);
don't re-run grids below the measured variance floor.

### 8. Tool-use & Mac-tier scorecard roadmap — re-scope before resourcing

`research/tool-use-and-mac-tier-scorecard.md` (the big v2 proposal) is
half-answered by the migration itself: Thread A's backend bake-off
(GBNF vs LLGuidance vs XGrammar) presumed constrained decoding is
load-bearing — the A/B showed native tools-grammar suffices at tier-64 and
the *prompt* dominates at tier-16. Thread A survives only as the
weak-model question ("does any constrained backend beat prompt-discipline at
tier-16?"). Thread B (cross-tier scorecard, BFCL/SWE-bench anchoring) is
aligned with thread 6 and remains fruitful — fold it into the discrimination
matrix rather than running it as a separate program.

### 9. Durable methods & evidence (no action, just inheritance)

- `EVAL-DESIGN.md` rules + statistical decision gates — govern all new tests.
- `W2-W4-ANALYSIS-METHODS-LIBRARY.md` — stdlib-only HL shift / bootstrap /
  Cliff's δ reference implementations.
- Committed canonical registries (`host/test/docs/data/`) — every published
  CI re-derives verbatim; new sweeps should keep extending this convention.
- Calibration lineage (`EVAL-CALIBRATION-REPORT.md`, `NEW-EVALS-REPORT.md`,
  `QWEN3.6-MODEL-REPORT.md`, n8 memo) — the difficulty-gradient evidence
  behind the current panel.

---

## Ranked shortlist (effort × yield)

| # | Experiment | Builds on | Cost | Why now |
|---|---|---|---|---|
| 1 | Prompt halves/quarters ablation @16 | threads 1, 2-template | low (driver-ready) | biggest unexplained effect in the lab; thesis-central |
| 2 | Anomaly re-base: needle-haystack + grep-leak audit on oc | thread 2 | trivial | dissolves-or-confirms flagged findings; cleans the pack |
| 3 | Thinking-on arm @16/@64 (optionally ×prompt 2×2) | thread 3 | low | closes an explicit scope boundary |
| 4 | Transcript adapter + timings (#021/#022) | thread 4 | medium (eng) | unlocks 5, 6-probes, token accounting |
| 5 | Sprint 2 confirmatory matrix N=60 | thread 6 | medium (compute, AFK) | roster locked; runner now fast |
| 6 | W4 classification pass on oc transcripts | threads 4→5 | medium | taxonomies frozen and waiting |
| 7 | Productivity pack + grader (Sprint 3) | thread 6 | high | architecture done; needs task authoring + judge calibration |
| 8 | T32 C1 confirmation (n≥7) | thread 7 | low-medium | only if tier-32 becomes a daily tier; otherwise park |

Items 1–3 are all single-driver-invocation experiments at on-demand tiers —
a natural first post-migration week. Item 4 is the one engineering
investment that converts the dormant trace-level program (5, 6) from
"parked" to "runnable."
