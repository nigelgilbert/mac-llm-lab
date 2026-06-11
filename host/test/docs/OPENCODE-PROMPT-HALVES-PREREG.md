# Pre-registration — prompt-halves ablation, tier-16 (which half of the discipline prompt carries the +6.6pp?)

**Status: SIGNED OFF 2026-06-11 (lab owner) — §9 decision recorded; T11 wiring + sweep authorized.**

**Date:** 2026-06-11 · Tranche T10 · Salvage-doc ranked item 1
([research-salvage-next-tranche-20260610.md](../../../research/research-salvage-next-tranche-20260610.md)
thread 1, "Prompt decomposition — the moat is unexamined").

This document pre-registers the arms, the exact prompt bisection, the
contrasts, and the interpretation rules **before any data is collected**, in
the style of [OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) §0a.
Everything in §5 is committed now; the sweep produces numbers that are read
against these rules, not the other way around. Wiring (config enum, schema,
fingerprints, seeding branch) is **T11 work, after sign-off** — nothing in
this tranche touches code or servers.

---

## 0. Evidence lineage (what this builds on)

| finding | number | source |
|---|---|---|
| tier-16: bare oc inferior to claw | −7.7pp [−13.1, −2.5] | [OPENCODE-AB-TIER16-VERDICT.md](OPENCODE-AB-TIER16-VERDICT.md) (#019) |
| git-init alone is a wash | −8.1pp vs claw ≈ bare oc | [OPENCODE-SIDECAR-PORT-HANDOFF.md](OPENCODE-SIDECAR-PORT-HANDOFF.md) RESULT |
| **prompt effect (`+prompt` − `+git`)** | **+6.6pp, 90% CI [+3.1, +10.2]** | sidecar-port sweep, RESULT table |
| grammar non-portable AND redundant | null arm (overridden under `tools`) | handoff §1 |
| harness loop ≈ 0 | `+prompt` vs claw −1.5pp [−6.4, +3.5] | handoff RESULT; [OPENCODE-MIGRATION-DECISION.md](OPENCODE-MIGRATION-DECISION.md) §1 |
| between-task heterogeneity | per-task deltas span ±48pp | migration decision §1 override record |

All CIs above: paired bootstrap by `test_id` over the 32-task panel, B=10000,
seed `0xc0ffee`, 90% CI — re-derivable verbatim from the committed registries
per [docs/data/README.md](data/README.md).

---

## 1. Question + motivation

The single largest causal effect this lab has measured — **+6.6pp, 90% CI
[+3.1, +10.2], at tier-16, vs the `opencode-a+git` control** — is attributed
to ~ten lines of markdown:
[host/llama-server/docs/system-prompt.md](../../llama-server/docs/system-prompt.md),
planted verbatim as a git-committed `AGENTS.md`. It has only ever been
measured **as a block**. Nothing is known about which rules carry it or
whether it is additive (salvage doc thread 1).

The question this experiment answers: **which half of the discipline prompt
carries the tier-16 effect, and is the effect additive across halves?**

Why it matters beyond curiosity: the migration's mechanism conclusion
(decision §1) decomposed claw's tier-16 advantage as *grammar redundant,
harness loop ≈ 0, prompt = the moat*. The thesis framing is **discipline
prompting as a substitute for model capability** — the weak 9B leans on
scaffolding the 35B-A3B does not need. Decomposing the prompt is the first
step toward saying *what kind* of discipline substitutes for capability
(tool-call economy? output/action discipline?), and it sharpens the
follow-up interaction question (§8: does the stronger model need it less?).

---

## 2. Arms — four, coarse halves only (hard constraint)

Arm design is exactly the sidecar-port template (handoff §4): every arm gets
a git-initialized `/workspace`; arms differ **only** in the `AGENTS.md`
planted and committed before the runner starts. Four arms:

| config_id | AGENTS.md content | role | status |
|---|---|---|---|
| `opencode-a+git` | none | control ("none") | existing config, reused |
| `opencode-a+prompt` | full `system-prompt.md`, verbatim | treatment ("full") | existing config, reused |
| `opencode-a+prompt-h1` | half-1 (pinned in §2.2) | decomposition arm | **NEW — T11 wiring** |
| `opencode-a+prompt-h2` | half-2 (pinned in §2.2) | decomposition arm | **NEW — T11 wiring** |

### 2.1 Naming + fingerprints

**Names.** `opencode-a+prompt-h1` / `opencode-a+prompt-h2` extend the
existing `+`-suffix enum style (`lib/config.js` `VALID_CONFIGS`). Positional
names (`h1`/`h2`) are chosen over semantic ones (e.g. `+prompt-calls` /
`+prompt-output`) deliberately: the registry enum is provenance, and the
semantic characterization of each half is **this document's hypothesis** —
it belongs here and in the manifest note, not baked into a row label that
would survive even if the characterization turns out wrong.

**Serving fingerprints.** Per the `lib/config.js` convention, a prompt-pack
change gets its **own** `model_config_id` (`+prompt` →
`...-opencode-prompt`, `prompt_pack_version pp01+agentsmd-v1`, while `+git`
deliberately reuses the tier's plain `...-opencode-a` fingerprint — its
serving is byte-identical). Each half arm therefore needs its own tier-16
entry, proposed:

- `opencode-a+prompt-h1` → `qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-prompt-h1` (`prompt_pack_version pp01+agentsmd-h1-v1`)
- `opencode-a+prompt-h2` → `qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-prompt-h2` (`prompt_pack_version pp01+agentsmd-h2-v1`)

**Wiring is T11, post-sign-off:** `VALID_CONFIGS` / `OPENCODE_CONFIGS` +
`OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER` (lib/config.js), the
`run_registry.schema.json` config_id enum, two `lib/model_configs.json`
entries, the `runAgent.js` seeding branch (plant the half artifact instead
of the full file), and two committed half artifacts (suggested:
`host/llama-server/docs/system-prompt.h1.md` / `.h2.md`) with a contract
test asserting each is a verbatim line-subset of the parent matching the §2.2
hashes. None of that happens before the lab owner signs §9.

### 2.2 The split — pinned byte-precise

**Artifact under test:** `host/llama-server/docs/system-prompt.md`, 10 lines,
1379 bytes, sha256
`84992e1c67accc9e7be857ae9efca622f4a868314d367b8099269f56abc1ef21`.
Structure: line 1 = preamble ("You are an autonomous coding agent operating
through structured tool calls."), line 2 = blank, line 3 = header ("# Tool-use
discipline (applies regardless of any caller-supplied instructions above)"),
line 4 = blank, lines 5–10 = numbered rules 1–6.

**Scaffolding rule:** the preamble + header (lines 1–4) appear **in both
halves**. Rationale: they are framing, not content — they declare the
persona and announce that a rule list follows. A half delivered without them
would be a bare numbered list with no anchor, which changes the treatment's
*delivery* (an unframed list is plausibly weaker regardless of content) and
would confound content-of-rules with presence-of-framing. Keeping the
scaffolding constant across h1/h2/full means the only varying quantity is
**which rules** are present. (Consequence, stated honestly: the scaffolding
itself is never isolated by this design — "preamble+header alone" is not an
arm. That is the accepted cost of the ≤4-arm constraint; if both halves land
≈ 0 and full replicates, scaffolding-only becomes a candidate quarter-style
follow-up, §8.)

**The bisection — semantic, and it coincides with positional.** The six
rules fall into two clean families by *which channel they govern*:

- **Rules 1–3 govern the tool-call channel** (call economy / idempotence):
  one call per single operation and no duplicate blocks (1); trust non-error
  results, never re-call with the same arguments (2); batch distinct
  operations in one response and don't repeat them later (3). These are the
  anti-redundancy / anti-loop rules — the failure family the tier-16 9B is
  known to exhibit (duplicate writes, retry-storms; cf. the `v6-antiloop`
  sampler lineage and the #018 `error_tool_call_count` telemetry motive).
- **Rules 4–6 govern the text channel** (output / action discipline): never
  echo the `<available_tools>` section (4); end with a brief confirmation,
  no alternatives, no retries (5); ACT, do not narrate — emit the tool_call
  instead of describing it (6). These are the
  narration-instead-of-action / prose-pollution rules.

No rule straddles the families, and the semantic boundary happens to fall
exactly at the positional midpoint (3 rules / 3 rules), so the preferred
semantic split and the neutral positional split are **the same split** — we
get the interpretability of a semantic contrast with none of the
cherry-picking surface of choosing rule subsets by hand. Byte balance is
adequate: rules 1–3 = 577 bytes, rules 4–6 = 639 bytes.

**Pinned halves (verbatim line-subsets, original line numbering of the
parent; no rewording, no renumbering — handoff §6.4: an adapted prompt is a
non-comparable treatment):**

| half | parent lines | content | bytes | sha256 |
|---|---|---|---|---|
| **h1** ("call economy") | 1–4 + 5–7 | preamble, blank, header, blank, rules **1, 2, 3** | 740 | `cf7dafb075e68543c89ab9e9514f473066b8ad13190c95cabc11f5d401ab2585` |
| **h2** ("output/action discipline") | 1–4 + 8–10 | preamble, blank, header, blank, rules **4, 5, 6** | 802 | `cd3213d8847f7d7e88def206cd054310dcb79c74ca103ffea51ca1f1c47448d3` |

Each half is the byte-exact concatenation of the named parent lines
(trailing newlines preserved; `sed -n '1,7p'` and `sed -n '1,4p;8,10p'`
respectively). **h2's rule list therefore visibly starts at "4."** — a
cosmetic artifact accepted on purpose: renumbering 4–6 to 1–3 would change
bytes and constitute adaptation. Recorded as a known (judged minor) confound
of the h2 arm.

### 2.3 Single-line arms — explicitly ruled out

Per-task deltas in this design space span ±48pp (decision §1); between-task
heterogeneity dominates CI width, which is why the lab owner declined
further sampling on the ±5pp parity question as uninformative. A ten-arm
single-line ablation would chase per-rule effects of order ~1pp with an
instrument whose CI half-width at N=8 is ~±3.5pp — every arm would be noise.
The salvage doc's caveat is binding: **coarse contrasts first** — halves
now; quarters (or a scaffolding-only arm) only as a possible future tranche,
**conditional on a clean halves result** (§8).

---

## 3. Panel + N

- **Panel:** the **32** runAgent A/B tasks — not the plan's 35;
  `latency` / `prose-quality` / `tool-discipline` were claw-bridge probes
  that emit no registry row (tier-16 verdict, dataset note). Same panel as
  every published comparison, so per-task deltas are comparable across the
  record.
- **Tier: 16 only** (Qwen3.5-9B IQ4_XS on `:11437`, build `b1-5594d13`).
  Caveat carried verbatim from the tier-16 verdict: tier-16 here is a
  **capability proxy on 64 GB silicon** (~50 GB headroom; no real 16 GB
  memory pressure), and **thinking-off** in all arms.
- **N = 8 per cell** (`CONFIG_AB_REPEATS=8`), matching the sidecar-port
  sweep that produced the +6.6pp — so C1's replication is like-for-like —
  and satisfying N≥8 so the #018 tool-call telemetry (rows carry
  `tool_call_count` / `error_tool_call_count` / `truncated_tool_call_count`
  per #010) accumulates alongside at useful density.

---

## 4. Data plan — fresh 4-arm sweep (recommended) vs 2-arm reuse (alternative)

**Recommended: run ALL FOUR arms fresh in one sweep.**
4 arms × 32 tasks × N=8 = **1024 runs**. Rationale:

1. **Fresh `full` and `none` arms replicate the +6.6pp on the same harness
   commit** as the half arms, with the #010 telemetry columns and the #002
   symmetric overflow semantics that the 2026-06-10 sidecar rows **lack**
   (those rows predate both: no tool-call columns, flag-off overflow
   semantics). C1 then doubles as an independent replication of the
   headline effect under current semantics.
2. **One-sweep provenance.** No split-provenance note, no
   eligibility-semantics asymmetry between contrasts (see the alternative's
   flaw below). The tier-16 record has carried a split-provenance caveat
   twice already; the headline decomposition shouldn't carry a third.

**Alternative (cheaper): `REUSE_ROWS=1`.** Copy the committed
`docs/data/run_registry.sidecar-port-20260610.jsonl` into
`host/test/.claw-runtime/`, point `REGISTRY_OUT` at it, and sweep only
`ARMS="opencode-a+prompt-h1 opencode-a+prompt-h2"` (512 runs, ~half the
wall-clock). What that buys, flagged loudly:

- **Overflow-semantics asymmetry across contrasts:** the reused
  `full`/`none` rows count a context overflow as an eligible timeout-fail
  (pre-#002), while fresh flag-on half rows re-type it
  `harness_error`/ineligible. C2/C3 would use one eligibility convention
  and C1 another — precisely the asymmetry #002 was landed to close.
- **Telemetry asymmetry:** the #018 tally would exist for the half arms
  only.
- **Harness-commit asymmetry:** reused rows from `212546f`, fresh rows from
  current HEAD; plus a mandatory split-provenance note in the verdict.

**Wall-clock estimate (honest, from the record):** tier-16 medians run
~21–24 s/run (`+prompt` 20.8s, `opencode-a` 23.5s, claw 24.4s), but p90/max
approach the 600 s per-cell cap on the hard tasks (`csv-parser`,
`two-bucket`, `expression-eval`, `wordy`), so medians do not predict phase
time. Historically a 256-run tier-16 arm-phase took **~5 h** (Phase A
04:09→09:33, Phase B 11:31→16:14 on 2026-06-07). Budget accordingly:
**~20 h for the fresh 4-arm sweep, ~10 h for the 2-arm reuse**. The driver
is AFK-safe (#003 row accountability, #004 reaping, #019 canary/retry), so
this is an overnight-plus-a-day unattended run, not operator time.

**The fresh-vs-reuse choice is left to the lab owner as an explicit §9
checkbox.** This pre-registration recommends fresh-4-arm.

---

## 5. Pre-registered contrasts + decision rules (committed before data)

**Statistic (identical for every contrast):** paired bootstrap by `test_id`
over the 32-task panel, B=10000, seed `0xc0ffee`, 90% CI
(`lib/paired_bootstrap.js`), rendered by `scripts/config-ab-verdict.mjs
--treatment <arm> --baseline <arm>` against the sweep registry. Eligibility
per §6. Point estimates are aggregate Δ pass-rate in percentage points.

### 5.1 The contrasts (the complete family — nothing else is a claim)

| id | contrast | role |
|---|---|---|
| **C1** | `opencode-a+prompt` − `opencode-a+git` | replication of the +6.6pp; gateway for everything below |
| **C2** | `opencode-a+prompt-h1` − `opencode-a+git` | decomposition: does call-economy carry it? |
| **C3** | `opencode-a+prompt-h2` − `opencode-a+git` | decomposition: does output/action discipline carry it? |
| **C4** | (C2 + C3) vs C1 | additivity check — **descriptive only** (point estimates; the tooling renders pairwise CIs, and no gate hangs on C4) |

Under the 2-arm reuse plan C1 is *re-rendered* from the reused rows
(numerically it re-derives the published +6.6pp) rather than replicated;
gate G1 below then tests the published effect, not a fresh one — one more
reason to prefer the fresh plan.

### 5.2 Gates and definitions

- **G1 (replication gateway):** C1's 90% CI **excludes 0 with positive
  sign**. Expectation: ≈ +6.6pp.
  **If G1 FAILS, the ablation STOPS — C2/C3/C4 are reported as descriptive
  numbers but support NO carry/additivity claims.** A failed G1 is itself a
  deliverable finding (handoff §6.2 style): the headline prompt effect did
  not replicate on the current harness, i.e. the original +6.6pp is fragile
  to harness commit / overflow semantics / resampling — that goes in the
  verdict as the headline, and the decomposition question returns to the
  queue pending diagnosis.
- **Carry criterion (per half, evaluated only if G1 passes):** half *i*
  "carries the effect" iff its CI vs none (C2 or C3) **excludes 0 with
  positive sign** AND its point estimate is **≥ half of C1's point
  estimate**.
- **Partial contributor:** CI excludes 0 (positive) but point < C1/2 —
  named as a contributor, not promoted to "carries."
- **Harmful half:** CI excludes 0 with **negative** sign — pre-registered
  as a reportable finding (a rule family that hurts without its
  complement), not an anomaly to explain away.

### 5.3 Pre-written readings (each outcome is a deliverable)

| outcome (G1 passed) | reading |
|---|---|
| **Both halves meet carry** | Effect is distributed across both rule families. C4 disambiguates: (C2+C3) ≈ C1 → **additive**; (C2+C3) markedly > C1 → **redundant/overlapping** (either half suffices; the families back-stop each other). |
| **Exactly one meets carry** | **One-half-dominant.** The named family is the moat at tier-16; the other is excess baggage there. The quarters follow-up (§8) becomes well-posed *for the dominant half only*. |
| **Neither meets carry, neither harmful** | **Synergistic (whole > sum):** the effect needs the whole prompt. At this N that is a terminal finding for decomposition — no quarters follow-up; the prompt ships whole. This is a *finding*, not a failed experiment. |
| **A harmful half** | Reported as such; the complement's reading proceeds per the rows above. |
| **G1 failed** | See gate G1 — fragility finding; everything else descriptive. |

C4 is read qualitatively against the contrasts' CI widths (≈ ±3.5pp
half-width each, from the record); we pre-commit to NOT manufacturing an
"interaction CI" post hoc — a joint-resample interaction CI would be new
tooling and, if wanted, gets its own pre-registration.

### 5.4 What this licenses (EVAL-DESIGN §5 + addendum honesty)

- **Claim tier:** this is a **mechanism decomposition**, not a
  model-admission or test keep/drop decision. Under the EVAL-DESIGN
  addendum's two-stage table, N=8/cell is screen-tier; what rescues the
  primary contrasts is the paired-by-task design over 32 tasks, which
  resolved the +6.6pp with a CI excluding 0. The licensed claim is
  therefore: *config-delta effect sizes with bootstrap CIs* (addendum §5
  "Config deltas" row) at ~±3.5pp resolution — sufficient for "which half
  carries a +6.6pp effect," NOT for per-rule effects, per-task claims
  (heterogeneity ±48pp), durable suite decisions, or external headline
  numbers.
- **Reporting (binding):** effect sizes + CIs only, never p-values alone;
  **per-task delta tables alongside every aggregate** (regressions must not
  average away); **no single aggregate score** anywhere in the verdict;
  attrition table (eligible/ineligible histogram per arm) enumerated, never
  silently dropped.
- **Multiplicity, stated plainly:** the family is the four contrasts above,
  fixed in advance; all four are reported whatever they show, and no other
  contrast may be promoted to a claim post hoc. No formal alpha correction
  is applied — the family is small, G1 gateways the decomposition
  hierarchically, and the readings hinge on effect sizes against a ±3.5pp
  instrument rather than significance declarations. The honest residue:
  with two primary decomposition CIs at 90%, the chance that at least one
  falsely clears its interval under a true null is material (order 10–20%);
  the carry criterion's second condition (point ≥ C1/2) is the buffer, and
  any conclusion drawn here is screen-tier for the follow-up program (§8),
  not a terminal scientific claim.

### 5.5 Mechanistic side-prediction (descriptive, no gate)

If h1 (call economy) carries the effect, the #018 telemetry should show it:
lower `error_tool_call_count` / duplicate-call signatures on h1 vs none,
with h2 ≈ none. Recorded as a prediction so the telemetry read-out is
honest; it gates nothing.

---

## 6. Eligibility + telemetry semantics

- **`OPENCODE_SERVER_TIMINGS=1` for the entire sweep** (all arms). This
  arms the #002 context-overflow pass: a mid-run n_ctx-exceeded overflow is
  re-typed `terminal_status: 'harness_error'` / `passed: null` in both the
  run_summary and the already-emitted row, **before** the row audit and
  pairing gate read the registry — so overflow semantics are symmetric
  across all four arms by construction. (Flag-off would silently restore
  the old overflow-counts-as-fail semantics — plan §0b caveat 1. The driver
  refuses to start flag-on if the tier-16 server log is missing.)
- **Eligibility:** `lib/paired_bootstrap.js` `isEligible` — a row counts
  iff `passed` is boolean and `terminal_status ∉ {harness_error,
  interrupted}`. Expectation from the record: near-zero `harness_error` on
  oc arms (the sidecar sweep's new arms had zero). Any drop is enumerated
  in the verdict's attrition table.
- **Row accountability:** #003 expected-attempts plan (4 × 32 × 8 = 1024
  planned cells, or 2 × 32 × 8 = 512 under reuse) — any planned cell with
  no row turns the sweep red.
- **#019 soak data:** `retried_cells=N` from each arm summary line is
  logged per arm into the tranche log (workspace-mount-flake canary/retry
  telemetry rides along).
- **#018 tally (post-sweep, HITL):** the tool-call telemetry tally
  (`tool_call_count` / `error_tool_call_count` / `truncated_tool_call_count`
  by tier/task/arm) is produced and handed to the lab owner. Any threshold
  decision on it is the lab owner's, explicitly **NOT** part of this
  experiment's gates.

---

## 7. Protocol (canonical)

One invocation of [run-config-ab.sh](../run-config-ab.sh):
`ARMS="opencode-a+git opencode-a+prompt opencode-a+prompt-h1
opencode-a+prompt-h2"` (or the two half arms under the reuse plan)
`BASELINE=opencode-a+git`, `TIER=16`, `CONFIG_AB_REPEATS=8`,
`SMOKE_TESTS=<the 32 A/B stems>`, `OPENCODE_SERVER_TIMINGS=1`, fresh
`REGISTRY_OUT` under `host/test/.claw-runtime/` (driver-enforced;
pre-existing only under `REUSE_ROWS=1`). The resident tier-64 server
`:11436` is strictly read-only — never restarted, used only as found — and
the resident lock is held for the sweep (`mkdir /tmp/oc-resident.lock.d`)
with `OC_ROTATE_HOLDING_LOCK=1` exported so the #015 rotation preflight's
G3 guard passes. The tier-16 server (`:11437`) lifecycle belongs to the
driver via `opencode-server` (started iff not green, stopped on exit iff
this sweep started it — `:11437` quiet after). The #006 arm×tier preflight
must pass for **every arm × tier-16** before any cell runs (this is what
makes the half arms' `modelConfigIdFor` wiring a hard T11 prerequisite).
After the sweep: verdict memo rendered by `config-ab-verdict.mjs` per §5,
and the **canonical registry committed to
[host/test/docs/data/](data/README.md)** with every published CI
re-deriving verbatim from the committed copy (seeded bootstrap, bit-for-bit).

---

## 8. Named follow-ups — explicitly NOT this tranche

- **Tier-64 model-strength contrast (the thesis interaction).** Does the
  stronger model need the prompt less — i.e. does the winning half's effect
  shrink or vanish at tier-64 (Qwen3.6-35B-A3B, resident `:11436`)? This is
  the thesis-relevant interaction (*discipline prompting as a substitute
  for model capability*) and is the explicit **next pre-registration**
  after this experiment's verdict. Out of scope here.
- **Quarters / single-line decomposition** — only conditional on a clean
  one-half-dominant result (§5.3), and only within the dominant half. A
  scaffolding-only arm joins that tranche if §5.3's synergy row fires.
- **Thinking-on arms** — unmeasured at every tier (decision §4); a separate
  experiment (salvage thread 3), possibly a 2×2 with the winning half.

---

## 9. Sign-off

**Lab-owner decision: APPROVED 2026-06-11**

- [x] **Arms + split approved as drafted** (§2: four arms; h1 = rules 1–3,
      h2 = rules 4–6, scaffolding in both, verbatim line-subsets pinned by
      sha256). No amendment.
- [x] **Data plan: fresh 4-arm sweep** (1024 runs, ~20 h, the recommended
      option). The 2-arm reuse alternative was declined.
- [x] **Margins / N: defaults kept** (N=8, 90% CI, carry criterion
      "CI excludes 0 AND point ≥ C1/2").

Decision recorded: 2026-06-11, lab owner (Nigel Gilbert), via interactive
sign-off in the T10→T11 orchestration session (tranche log:
issues/LOG-2026-06-11-research-t10.md). Everything in §5 is now frozen;
any later change would be a protocol deviation and must be reported as such.
