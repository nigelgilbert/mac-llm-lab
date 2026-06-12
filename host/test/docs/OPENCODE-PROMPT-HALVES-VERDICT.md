# Verdict — prompt-halves ablation, tier-16: **G1 FAILED — the +6.6pp prompt effect did not replicate; the ablation stops here by pre-registration**

**Date:** 2026-06-12 · Tranche T11/T12 · Pre-registration:
[OPENCODE-PROMPT-HALVES-PREREG.md](OPENCODE-PROMPT-HALVES-PREREG.md) (signed
off 2026-06-11, §5 frozen before data).

**Headline:** the replication gateway **G1** — contrast C1
(`opencode-a+prompt` − `opencode-a+git`) 90% CI excludes 0 with positive
sign, expectation ≈ +6.6pp — came back **+0.1pp, 90% CI [−3.4, +3.9]**.
The CI straddles 0; G1 **FAILS**. Per the frozen §5.2 rule, the
decomposition **STOPS**: C2/C3/C4 below are reported as descriptive numbers
and support **no carry/additivity claims**. The deliverable finding, exactly
as pre-written: *the headline tier-16 prompt effect (+6.6pp [+3.1, +10.2],
sidecar-port sweep 2026-06-10) is fragile to harness commit / overflow
semantics / resampling — it is absent on the current stack.* The
decomposition question returns to the queue pending diagnosis (§5 below).

This verdict is rendered, not asserted: every figure re-derives from the
committed registry via the seeded renderer (see [Reproduce](#reproduce)).

---

## 1. Dataset (committed)

`host/test/docs/data/run_registry.prompt-halves-20260611.jsonl` — **1024
rows** = 4 arms × 32 paired tasks × N=8, tier-16 (Qwen3.5-9B IQ4_XS,
`:11437`, build `b1-5594d13`), thinking-off, `OPENCODE_SERVER_TIMINGS=1`
(symmetric #002 overflow semantics), harness commit `927b7d0`, one sweep
2026-06-11T20:06:01Z → 2026-06-12T17:33:45Z (~21.5 h) plus a 2-row top-up
ending 17:43:54Z. Bootstrap B=10000, seed `0xc0ffee`, paired by `test_id`,
90% CIs throughout.

**Provenance wrinkle (flagged):** 2 of the 256 control rows
(`adversarial-input` reps 7–8, `opencode-a+git`) come from a `REUSE_ROWS=1`
top-up invocation ~10 min after the main sweep ended, same
config/server/commit. The main sweep lost those two cells to back-to-back
#019 mount-flake double-flakes (retry budget = 1); a top-up ~5 min after
sweep end double-flaked the same way (4/4 instant seed-ENOENT on an
otherwise idle lab), and a top-up after a further ~2-min idle settle ran
clean (2/2) — the share stays degraded for a window after sustained load. All three driver
invocations and their `retried_cells` counts are in the tranche log
(`issues/LOG-2026-06-11-research-t10.md` ledger).

## 2. Pre-registered contrasts (frozen §5.1) — results

| id | contrast | Δ (pp) | 90% CI (pp) | frozen-rule outcome |
|---|---|---|---|---|
| **C1** | full − none | **+0.1** | **[−3.4, +3.9]** | **G1 FAILED** (CI includes 0; expected ≈ +6.6) |
| C2 | h1 ("call economy") − none | −0.5 | [−3.9, +2.7] | descriptive only (G1 failed) |
| C3 | h2 ("output/action") − none | −3.9 | [−7.7, −0.6] | descriptive only (G1 failed) |
| C4 | (C2+C3) vs C1 | −4.4 vs +0.1 | — | descriptive only (G1 failed) |

Mean per-task pass-rates (eligible rows): none **85.7%**, full **85.7%**,
h1 **85.2%**, h2 **81.7%**.

Descriptive notes, explicitly **hypothesis-generating, not claims** (the
frozen gateway forbids promoting them):

- C3's interval excludes 0 with negative sign. Had G1 passed, this is the
  shape §5.3 pre-registered as a "harmful half" finding for h2. As is, it
  is a screen-tier flag only: *rules 4–6 alone may hurt the 9B* (−3.9pp,
  worst task −42.9pp). If the decomposition is re-run after diagnosis, h2
  harm is the first thing to look for.
- Wall-clock (recorded, no gate in this prereg): control median 22.0 s;
  **full prompt 36.6 s (1.67×)**; h1 20.8 s (0.94×); h2 20.3 s (0.93×).
  On this sweep the full prompt made runs two-thirds slower at zero
  pass-rate gain — the renderer's 0a.2 line flags it; it bears on whether
  the global AGENTS.md earns its keep on the *current* stack (daily-driver
  question, out of scope here).
- Per-task structure: ~21 of 32 tasks are at mutual ceiling (8/8 vs 8/8) in
  C1; the aggregate is carried by a handful of hard tasks with the familiar
  ±48pp-class swings (`lru-cache` +50.0, `csv-parser` +32.1, `book-store`
  −32.1). Between-task heterogeneity dominates, as the prereg anticipated.

## 3. Why the effect may have vanished (named, NOT adjudicated)

The control (`opencode-a+git`) arm scored **85.7%** here vs ≈ **76.2%** in
the 2026-06-10 sidecar-port sweep — the baseline rose ~9.5pp and absorbed
the prompt's entire headroom. Everything that changed between the two
sweeps is a candidate, none verified:

1. **Harness commit** `212546f` → `927b7d0`: the #020–#029 hardening wave
   (oc client hardening #027, server lifecycle #029, probe-gated install
   #010/T4, resident plist redeploy), T6–T9 fixes, T10/T11.
2. **Eligibility semantics**: flag-on #002 overflow re-typing here vs
   flag-off there (the prereg chose fresh-4-arm precisely so all four arms
   share one convention — the *contrasts* are internally consistent; only
   the comparison to the 2026-06-10 number crosses the semantics boundary).
3. Resampling noise on a heterogeneous panel (the old +6.6 CI bound was
   +3.1; the new point is +0.1 — the intervals do not overlap, so this is
   unlikely to be resampling alone, but it is not excluded at screen tier).

**Diagnosis is the named follow-up** (next pre-registration candidate,
alongside the parked tier-64 model-strength contrast — prereg §8): e.g.
re-render the 2026-06-10 registry under symmetric semantics, and/or a
2-arm `+git` vs `+prompt` re-run at the old commit (checkout) to separate
(1) from (2)/(3). Until then, the operative statement is: **on the current
stack, the marginal value of the full discipline prompt at tier-16 is
≈ 0 within ±3.5pp, and the original +6.6pp stands as a finding about the
2026-06-10 stack only.**

## 4. Attrition (nothing silently dropped)

33 of 1024 rows ineligible (3.2%), enumerated by the renderer:

| arm | rows | terminal_status histogram | eligible |
|---|---|---|---|
| opencode-a+git | 256 | done 220 · timeout 27 · harness_error 9 | 247 |
| opencode-a+prompt | 256 | done 217 · timeout 33 · harness_error 6 | 250 |
| opencode-a+prompt-h1 | 256 | done 221 · timeout 27 · harness_error 8 | 248 |
| opencode-a+prompt-h2 | 256 | done 213 · timeout 33 · harness_error 10 | 246 |

- **31 × `post_script_spawn_failed`** (the #024 class; 9/6/6/10 across
  arms — balanced, so no contrast bias) — a NEW-at-scale harness noise
  mode, first 1024-run sweep under co-resident load; concentrated on the
  long/hard tasks, consistent with the OrbStack share-degradation family
  hitting the post-script spawn after long agent runs. Below the
  EVAL-DESIGN 5% harness-error bar but worth a follow-up issue if it
  recurs at this rate.
- **2 × `context_overflow`** (h1 arm) — the #002 oracle working as
  designed under flag-on.

## 5. What this licenses (per prereg §5.4)

Screen-tier mechanism evidence only. Licensed: "the 2026-06-10 prompt
effect did not replicate on commit `927b7d0` under symmetric overflow
semantics (Δ +0.1pp [−3.4, +3.9])." Not licensed: any per-half carry
claim, any per-rule claim, any keep/drop or admission decision, the h2-harm
reading (flag only). Scope caveats carried verbatim: tier-16 is a
capability proxy on 64 GB silicon; thinking-off; N=8.

## 6. Telemetry riders

- **#018 tally** (tool-call telemetry by arm; per-task table in the issue):
  recorded in `issues/018-toolcall-telemetry-threshold-review.md` (2026-06-12
  data section). Headline: zero null-telemetry rows; error_tool_call_count
  ≈ 17.9–19.6% of calls per arm (historical execution-error norm ~18.3%);
  truncated 27–32/arm. Threshold decision is the lab owner's (HITL).
- **#019 soak**: `retried_cells` = 2/0/0/0 across the four main-sweep arms,
  plus the top-up story in §1 — the flake arrives in bursts that defeat the
  single-retry budget but yield to an idle settle. Ledger in the tranche log.

## Reproduce

```sh
# from repo root (node lives in the runner image)
REG="$PWD/host/test/docs/data/run_registry.prompt-halves-20260611.jsonl"
DR() { docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" --entrypoint node mac-llm-lab-eval-runner:local "$@"; }

# C1 → +0.1pp [−3.4, +3.9]  (G1 gateway)
DR scripts/config-ab-verdict.mjs "$REG" --tier 16 --treatment opencode-a+prompt    --baseline opencode-a+git
# C2 → −0.5pp [−3.9, +2.7]
DR scripts/config-ab-verdict.mjs "$REG" --tier 16 --treatment opencode-a+prompt-h1 --baseline opencode-a+git
# C3 → −3.9pp [−7.7, −0.6]
DR scripts/config-ab-verdict.mjs "$REG" --tier 16 --treatment opencode-a+prompt-h2 --baseline opencode-a+git
```

Seeded bootstrap (B=10000, `0xc0ffee`) — CIs are bit-for-bit reproducible.
The gitignored sweep log (`.claw-runtime/prompt-halves-sweep-20260611.log`)
and the two top-up logs hold the full driver/audit/gate transcript.
