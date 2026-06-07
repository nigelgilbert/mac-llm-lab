# Verdict — claw-rig vs OpenCode config-(a), **tier-16** (issue #019)

**Decision: KEEP the bespoke claw serving stack at tier-16.** Rule 0a.1
(pass-rate non-inferiority) is **NOT MET** — OpenCode config-(a) is in fact
*significantly worse* on pass-rate (90% CI lies entirely below 0). Rule 0a.2
(wall-clock) is MET (near-parity, 0.96×), but both §0a rules must hold to retire,
so the rig stays.

> **This is the opposite of the tier-64 verdict, and that is expected, not a
> contradiction.** §0a evaluates each tier **independently**; a tier-64 retire
> and a tier-16 keep was pre-registered as a valid outcome. The mechanism is
> intuitive: the weaker tier-16 model (Qwen3.5-9B IQ4_XS) leans on the claw
> bundle's scaffolding (`claw.gbnf` grammar + `system-prompt.md`) that the
> stronger tier-64 model (Qwen3.6-35B-A3B) did not need. Strip that scaffolding
> (OpenCode's native path) and the 9B regresses.

> **Scope: tier-16 ONLY, and a CAPABILITY PROXY.** Running `TIER=16` on this
> M5 Max / 64 GB box loads the 9B with ~50 GB of headroom; it does **not**
> reproduce 16 GB memory pressure / KV eviction. This verdict characterizes the
> *capability* of the claw-bundle vs OpenCode-native pairing on the 9B weights —
> **not** a faithful 16 GB-hardware adoption call. A real 16 GB verdict needs
> real 16 GB silicon (plan §0). It also characterizes the **thinking-off harness
> mode** of claw-16, not thinking-on production claw-16 (issue #017 skew).

This verdict is rendered, not asserted. Every figure below is re-derived from the
raw registry by [scripts/config-ab-verdict.mjs](../scripts/config-ab-verdict.mjs),
which reuses the #015 statistic ([lib/paired_bootstrap.js](../lib/paired_bootstrap.js))
and the registry reader ([lib/registry.js](../lib/registry.js)) — the same code the
#013 pairing gate runs. To audit, re-run the command in [Reproduce](#reproduce) and
diff against this page.

---

## Dataset (verified, gitignored)

`host/test/.claw-runtime/run_registry.config-ab-20260607-062848.jsonl`

- **512 rows** = 2 configs × 32 paired tasks × N=8 (256 / 256).
- **32 paired** `runAgent` tasks, **0 unpaired** — every task has eligible runs on
  both sides. (Same A/B set as tier-64: the plan's "35" over-counts; `latency`,
  `prose-quality`, `tool-discipline` are claw-bridge probes that emit no row, and
  the 4 `frontier/` tasks are claw-wired and out of v1 scope. True A/B set = **32**.)
- Bootstrap: B=10000, seed `0xc0ffee`. Harness commit `ae9460b`.

### Split provenance — honest note (read this)

This dataset was assembled from **two driver runs**, not one phase-swap sweep, for
a reason worth recording:

1. **claw-rig rows (Phase A)** came from the original tier-16 phase-swap sweep
   ([run-config-ab.sh](../run-config-ab.sh) `PHASE_SWAP=0 TIER=16
   CONFIG_AB_REPEATS=8 CLAW_MODEL_CONFIG_ID=qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01`),
   span `2026-06-07T04:09:02Z → 09:33:00Z`. Production claw `:11435` was swapped to
   the 9B for this; claw-16 ran the 9B via the `anthropic/claw-llama` LiteLLM route
   (thinking-off) + `claw.gbnf`. **Phase A was clean.**
2. **That sweep's Phase B was discarded.** It hit a serving bug: the OpenCode
   container's `opencode.json` hard-coded `baseURL` `:11436` (the **tier-64** oc
   port), so the tier-16 oc client dialed a dead port and **every** cell
   `ConnectionRefused`-looped until its budget expired (`iters=1`, 0 tokens, 0 tool
   calls — a degenerate 0% that would have *falsely manufactured* this KEEP). The
   27 broken oc rows are preserved for audit in
   `run_registry.config-ab-20260606-230902.jsonl` (gitignored). Root cause: #018
   stood up the tier-16 *server* (:11437) but never made the OpenCode *client*
   config tier-aware. Fixed in this commit (new `client/opencode/opencode.16.json`
   + tier-selectable `${OPENCODE_CONFIG_JSON}` compose mount + driver wiring;
   verified end-to-end before the re-run: a `deep-equal` oc-16 cell passes with 6
   real iterations).
3. **opencode-a rows (Phase B)** came from a Phase-B-only re-run reusing the
   banked claw rows (new `SKIP_PHASE_A=1` driver mode), span
   `2026-06-07T11:31:05Z → 16:14:14Z`, oc-16 9B on `:11437` (corrected Jinja, no
   grammar, native tool-call, thinking-off via `--chat-template-kwargs`). Phase A
   was **not** re-run; production `:11435` (restored to the 35B) was **never
   touched** by this run — oc talks only to `:11437`.

**Why reuse is sound:** §0a's unit of analysis is per-task pass-probability, paired
**by `test_id`**, bootstrapped over tasks — pairing is not by wall-clock, and the
phase-swap design (§4.2) already collects claw and oc non-simultaneously and
explicitly accepts phase-time confounds. The apples-to-apples invariants below
(weights / engine / sampler / thinking-mode / ctx / oracle) are properties of the
*config*, identical across both runs and verified in the rows. The split was an
operator choice (avoid re-burning ~5 h of valid claw runs and a second production
downtime window); it does not affect the pairing or the invariants.

## Apples-to-apples conditions (what was held constant)

Both sides ran the **same weights, same engine, same sampler, same thinking-mode** —
verified identical in the rows' provenance fingerprints:

| Held constant (both sides) | Value (from the rows) |
|---|---|
| Model / GGUF | `unsloth/Qwen3.5-9B-GGUF@IQ4_XS` |
| Quantization | `IQ4_XS` (~5 GB) |
| Inference engine | llama.cpp `llama-server` (own port each: claw :11435 / oc :11437) |
| `context_limit` | 65536 |
| Sampler config | `v6-antiloop` (identical id both sides) |
| Prompt pack | `pp01` |
| Thinking mode | **OFF both sides** (claw via the `anthropic/claw-llama` LiteLLM route's per-request `enable_thinking:false` override of the launch-time `true`; OpenCode via `--chat-template-kwargs '{"enable_thinking":false}'` — §0, #017. Both re-verified live this run: claw :11435 `/apply-template` → closed `<think></think>` prefill; oc-16 `probe` 3/3 PASS.) |
| N per cell | 8 |
| Pass oracle | `public_verifier` (`/workspace` post-script only — §0b; no `agent.code` gate) |

The **only** moving parts (the bundle on trial): LiteLLM Anthropic bridge,
`claw.gbnf` grammar, `system-prompt.md`, and the Anthropic-API tool path — all
removed on the OpenCode side in favour of native `<tool_call>` parsing + a corrected
Jinja template + OpenCode defaults. A delta is attributable to *that bundle*, not the
model (§1).

### Provenance line per side (§4.7)

- **claw-rig** — `model_config_id` `qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01`;
  Qwen3.5-9B IQ4_XS @ ctx 65536; sampler `v6-antiloop`; LiteLLM bridge + `claw.gbnf`
  + `system-prompt.md`; thinking-off; oracle `public_verifier`.
- **opencode-a** — `model_config_id` `qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01-opencode-a`
  (distinct serving fingerprint per §4.5: same weights/quant/ctx/sampler, but corrected
  Jinja, no grammar, native tool-call, no LiteLLM); thinking-off; oracle `public_verifier`.

---

## Rule 0a.1 — pass-rate non-inferiority → **NOT MET** (OpenCode significantly worse)

Unit of analysis: per-task pass-probability, **paired by task**, bootstrapped over the
32 tasks (B=10000, seed `0xc0ffee`). Not 256 pooled Bernoulli trials.

- Mean per-task pass-rate: **claw-rig 84.3%**, **opencode-a 76.6%**.
- Aggregate delta `(opencode-a − claw-rig)` = **−7.7 pp**.
- **90% paired-bootstrap CI = [−13.1, −2.5] pp.**
- Decision: CI lower bound **−13.1 pp ≤ −5 pp** margin → **non-inferiority NOT MET**.
- The CI **excludes 0** (upper bound −2.5 pp < 0) → OpenCode is **statistically
  *worse*** on this panel, not merely "not non-inferior."
- Stable across seeds: `0xc0ffee` [−13.1, −2.5], `0x1` [−13.0, −2.6], `0x3039`
  [−13.2, −2.4] — all exclude 0, all lower-bounds far below −5 pp.

**Per-task deltas (regressions not averaged away — §0a).** OpenCode regressed on
13 tasks and improved on 5; the rest tied. Full table (sorted by `test_id`):

| test_id | claw-rig | opencode-a | delta |
|---|---|---|---|
| adversarial-input | 5/6 † | 8/8 | +16.7 pp |
| algorithm-intervals | 8/8 | 7/8 | −12.5 pp |
| api-evolution | 8/8 | 8/8 | +0.0 pp |
| book-store | 5/8 | 5/8 | +0.0 pp |
| cascading-bugs | 8/8 | 8/8 | +0.0 pp |
| comment-spec | 8/8 | 8/8 | +0.0 pp |
| csv-parser | 3/7 † | 1/8 | −30.4 pp |
| deep-equal | 8/8 | 8/8 | +0.0 pp |
| dependency-graph | 8/8 | 6/8 | −25.0 pp |
| eight-functions | 7/8 | 4/8 | −37.5 pp |
| expression-eval | 0/1 †† | 1/8 | +12.5 pp |
| ini-parser | 8/8 | 6/8 | −25.0 pp |
| json-schema-validate | 8/8 | 6/8 | −25.0 pp |
| large-refactor | 8/8 | 7/8 | −12.5 pp |
| long-horizon-bugs | 8/8 | 7/8 | −12.5 pp |
| lru-cache | 2/7 † | 4/8 | +21.4 pp |
| multi-bug | 8/8 | 8/8 | +0.0 pp |
| multi-bug-decoy | 8/8 | 8/8 | +0.0 pp |
| multi-file-rename | 8/8 | 7/8 | −12.5 pp |
| parseISO-with-timezone | 5/8 | 5/8 | +0.0 pp |
| refactor | 8/8 | 7/8 | −12.5 pp |
| spec-compliance | 7/8 | 7/8 | +0.0 pp |
| spec-precedence | 8/8 | 8/8 | +0.0 pp |
| state-machine | 8/8 | 8/8 | +0.0 pp |
| subtle-broken-spec | 8/8 | 5/8 | −37.5 pp |
| subtle-bug | 8/8 | 8/8 | +0.0 pp |
| tool-confusion-redundant-verifies | 8/8 | 8/8 | +0.0 pp |
| twelve-file-refactor | 4/8 | 4/8 | +0.0 pp |
| two-bucket | 6/7 † | 2/8 | **−60.7 pp** |
| two-step-refactor | 8/8 | 8/8 | +0.0 pp |
| word-search | 4/7 † | 7/8 | +30.4 pp |
| wordy | 2/4 †† | 2/8 | −25.0 pp |

The aggregate is driven by `two-bucket` (−60.7), `eight-functions`/`subtle-broken-spec`
(−37.5 each), `csv-parser` (−30.4), and the `−25` cluster (`dependency-graph`,
`ini-parser`, `json-schema-validate`, `wordy`), partly offset by OpenCode wins on
`word-search` (+30.4), `lru-cache` (+21.4), `adversarial-input` (+16.7).

† claw cell under-sampled by ineligible context-overflow drops (N<8 — see Attrition).
†† claw `expression-eval` is **N=1** (7 of 8 attempts dropped as context-overflow
`harness_error`) and claw `wordy` is **N=4** — both heavily under-sampled; their
deltas rest on a thin claw denominator (see the Sensitivity note, which neutralizes
the denominator effect).

### Sensitivity — the eligibility asymmetry (and why KEEP survives it)

There is a **measurement asymmetry** worth surfacing: the 9B's "ran out of
context/budget on a hard task" failure mode surfaces as **two different terminal
states** depending on the serving stack:

- **claw** → the LiteLLM bridge returns a typed `BadRequestError` →
  `terminal_status = harness_error` → **dropped as ineligible** (17 rows, all
  `context_overflow`).
- **opencode** → no LiteLLM, no typed overflow; the run simply consumes its
  wall-clock budget → `terminal_status = timeout` → **eligible fail** (counted
  against OpenCode; 0 oc `harness_error`).

The pre-registered §0b eligibility rule (drop `harness_error`) is symmetric *in
definition*, but the *data* is asymmetric because claw's bridge emits typed
overflows and OpenCode's path does not — so the rule favors claw on the
overflow-prone tasks (it removes claw failures from the denominator while keeping
OpenCode's).

**Sensitivity check** — recompute treating claw's 17 context-overflow
`harness_error`s as eligible **fails** (symmetric with OpenCode timeouts):

| Treatment | Aggregate delta (oc − claw) |
|---|---|
| Pre-registered (drop overflow) — **canonical** | **−7.7 pp** |
| Symmetric (overflow = fail) — sensitivity | **−5.5 pp** |

The asymmetry tempers the *magnitude* (−7.7 → −5.5 pp) but **not the direction or
the decision**: even under the symmetric treatment the point estimate stays beyond
the −5 pp non-inferiority margin, and the canonical CI's *upper* bound (−2.5 pp) is
already < 0. **KEEP is robust to the eligibility convention.** (Honestly stated: the
canonical −7.7 pp slightly overstates the gap; the defensible reading is "OpenCode
is worse by roughly 5.5–7.7 pp on the 9B," and either end fails non-inferiority.)

## Rule 0a.2 — wall-clock → **MET** (near-parity)

Median wall-clock per side (end_time − start_time, all 256 runs; eligible-only median
in parens):

| config | median | p90 | max | n |
|---|---|---|---|---|
| claw-rig | **24.4 s** (elig 24.0 s) | 262.0 s | 352.0 s | 256 |
| opencode-a | **23.5 s** (elig 23.5 s) | 232.2 s | 352.3 s | 256 |

- Ratio = 23.5 / 24.4 = **0.96×** ≤ 1.5× → **MET**. The two are at wall-clock
  parity on the 9B (unlike tier-64, where OpenCode was ~1.6× faster). High p90/max
  on both sides reflect the 600 s per-cell cap being approached on the hard,
  overflow-prone tasks (`csv-parser`, `expression-eval`, `two-bucket`, `wordy`).
- Rule 0a.2 alone is not sufficient to retire — both rules must hold — so this MET
  does not change the KEEP.

---

## Iteration parity (recorded, not gated — §0b)

| config | median | min | max | n |
|---|---|---|---|---|
| claw-rig | 8 | 0 | 84 | 256 |
| opencode-a | 9 | 2 | 61 | 256 |

Near-identical medians (8 vs 9). claw's longer tail (max 84) and `min 0` reflect a
few grammar-constrained cells that emitted no tool-call iteration; OpenCode's loop
ran a touch longer on the median but capped lower. Recorded, not gated.

## Attrition — nothing silently dropped

Eligibility follows [lib/paired_bootstrap.js](../lib/paired_bootstrap.js) `isEligible`:
a row counts only with a boolean `passed` and `terminal_status ∉ {harness_error,
interrupted}`.

| config | rows | terminal_status histogram | eligible |
|---|---|---|---|
| claw-rig | 256 | done 207 · timeout 32 · harness_error 17 | **239** |
| opencode-a | 256 | done 227 · timeout 29 | **256** |

- **claw-rig**: 17 `harness_error` (all `context_overflow`) **dropped** as
  ineligible — concentrated on the long-context tasks (`expression-eval` ×7,
  `wordy` ×4, plus single drops on `adversarial-input`, `csv-parser`, `lru-cache`,
  `two-bucket`, `word-search`). 32 `timeout` are eligible fails. The drops leave
  several claw cells under-sampled (`expression-eval` N=1, `wordy` N=4,
  `csv-parser`/`lru-cache`/`two-bucket`/`word-search` N=7, `adversarial-input` N=6).
- **opencode-a**: **zero** `harness_error` — every row eligible (N=8 on every task).
  Its 29 `timeout`s are eligible fails (`two-bucket` ×6, `csv-parser` ×7,
  `expression-eval` ×6, `wordy` ×3, plus a few singles).

No row was silently excluded: the 17 dropped rows are the only ineligible rows, all
enumerated by the renderer, and the Sensitivity check above quantifies their effect.
The #013 pairing gate independently confirms claw baseline bucketed 239 (not 0)
eligible paired runs.

---

## Deferred (not in this verdict, honestly noted)

- **Token parity — NOT RECORDED in this dataset.** The `run_registry` schema carries
  no token field, so token counts cannot be derived from these rows. Cross-harness
  token parity is deferred to the #021 transcript adapter; it is *not* implied here.
- **Server prompt/decode parity — DEFERRED.** This run, like the tier-64 sweep, ran
  with `OPENCODE_SERVER_TIMINGS` **OFF** (the #021/#022 ordinal join has a known
  `count_mismatch` — OpenCode emits an extra title-generation server request — that
  would misalign a server-decode split). Deferred until the join is keyed robustly.

These deferrals do not bear on either §0a rule — both rules are decided on pass-rate
and wall-clock alone.

---

## Verdict

| Pre-registered rule (§0a) | Result |
|---|---|
| 0a.1 — 90% paired-bootstrap CI lower bound on `(oc − claw)` pass-rate > −5 pp | **NOT MET** (−13.1 pp; CI [−13.1, −2.5], excludes 0 → significantly worse) |
| 0a.2 — OpenCode median wall-clock ≤ 1.5× claw | **MET** (0.96×) |

**Rule 0a.1 fails → KEEP the bespoke claw serving stack (LiteLLM bridge + `claw.gbnf`
+ `system-prompt.md` + Anthropic tool path) at tier-16.** On the same weights, engine,
sampler, and thinking-mode, vanilla OpenCode's native serving path is **5.5–7.7 pp
worse** on pass-rate for the Qwen3.5-9B (and only at wall-clock parity, not faster).
The bespoke scaffolding — the grammar that constrains the small model's tool-calls and
the system prompt that disciplines it — earns its keep on the weaker model. The
maintenance win of deleting it is **not** free at this tier; it costs pass-rate.

**Read against tier-64:** [retire at tier-64](OPENCODE-AB-TIER64-VERDICT.md), keep at
tier-16. The claw bundle's value is **model-strength-dependent**: redundant for the
35B-A3B, load-bearing for the 9B. Both verdicts are valid under the per-tier-independent
§0a rule.

**Caveat restated:** tier-16 here is a capability proxy on 64 GB silicon and reflects
claw-16's *thinking-off harness mode*. A faithful 16 GB-hardware adoption decision (and
a production-thinking-on comparison) remain out of scope.

---

## Reproduce

```sh
# from repo root; node lives in the test image (mac-llm-lab-test:local)
REG="$PWD/host/test/.claw-runtime/run_registry.config-ab-20260607-062848.jsonl"

# full verdict render (this document's figures):
docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" \
  --entrypoint node mac-llm-lab-test:local \
  scripts/config-ab-verdict.mjs "$REG" --tier 16

# independent #013 pairing gate (config_id discipline + both sides bucket):
docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" \
  --entrypoint node mac-llm-lab-test:local \
  scripts/config-ab-pairing-check.mjs "$REG" --tier 16
```

Both reuse `lib/paired_bootstrap.js` + `lib/registry.js`; the bootstrap is seeded
(`0xc0ffee`, B=10000) so the CI is bit-for-bit reproducible. The discarded
port-bug Phase B is preserved at
`run_registry.config-ab-20260606-230902.jsonl` (gitignored) for audit.
