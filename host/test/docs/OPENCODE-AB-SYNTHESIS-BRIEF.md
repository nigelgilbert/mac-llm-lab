# OpenCode-vs-claw A/B — synthesis & deep-research brief

**Status: experiment complete (22/22 tickets Done, 2026-06-07).** This is the
context-setting handoff for the final deep-research + synthesis agent. Everything
below is **verified** — re-derived from the raw registries by a second instance
(renderer re-run + #013 pairing gate + independent row aggregation), not copied from
the agents' self-reports.

Parent plan: [OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) (§0a decision
rules, §0b pass oracle, §4 design). Per-tier verdicts:
[tier-64](OPENCODE-AB-TIER64-VERDICT.md) · [tier-16](OPENCODE-AB-TIER16-VERDICT.md).

---

## 1. The question

Does the **bespoke "claw rig"** (LiteLLM Anthropic bridge + `claw.gbnf` grammar +
`system-prompt.md` + Anthropic-API tool path) still earn its keep for **local LLM
coding evals on a Mac**, versus **vanilla OpenCode** (native `<tool_call>` parsing +
corrected Jinja template + no grammar, talking straight to a dedicated llama.cpp
server)? Retire the bespoke stack iff OpenCode is non-inferior on pass-rate **and**
not materially slower — decided **per hardware tier, independently**.

## 2. Design (apples-to-apples — the bundle is on trial, not the model)

Both arms hold **everything** constant except the serving bundle, verified in every
row's provenance fingerprint:

| Held constant (both arms) | tier-64 | tier-16 |
|---|---|---|
| Model / GGUF | Qwen3.6-35B-A3B `UD-Q4_K_XL` (~21 GB) | Qwen3.5-9B `IQ4_XS` (~5 GB) |
| Engine | llama.cpp `llama-server` | same |
| `context_limit` | 65536 | 65536 |
| Sampler | `v1-prod` | `v6-antiloop` |
| Prompt pack | `pp01` | `pp01` |
| Thinking mode | **OFF both arms** (#017) | **OFF both arms** (#017) |
| N per cell | 8 | 8 |
| Pass oracle | `/workspace` post-script exit 0 (#001, config-agnostic) | same |

**The only moving part** (= the bundle being trialed): LiteLLM bridge, `claw.gbnf`,
`system-prompt.md`, Anthropic tool path — all present on `claw-rig`, all removed on
`opencode-a` in favor of native tool-call + corrected Jinja + OpenCode defaults. A
measured delta is therefore attributable to *that bundle*, not the weights.

**Pre-registered decision rules (§0a), applied per tier:**
- **0a.1 (pass-rate non-inferiority):** non-inferior iff the **90% paired-bootstrap CI
  lower bound** on `(opencode-a − claw-rig)` aggregate pass-rate **> −5 pp**.
- **0a.2 (speed):** opencode-a median wall-clock **≤ 1.5×** claw-rig.
- **RETIRE iff both MET; else KEEP.**

**Statistic (#015, `lib/paired_bootstrap.js`):** per-task pass-probability, **paired
by `test_id`**, bootstrapped over the **32 tasks** (B=10000, seed `0xc0ffee`) — *not*
256 pooled Bernoulli trials (avoids pseudo-replication). Verdicts are **rendered**
(`scripts/config-ab-verdict.mjs`), every figure re-derived from the rows.

**Task set = 32** (not the plan's "35"): `latency`, `prose-quality`, `tool-discipline`
are claw-bridge probe diagnostics that emit no registry row and are not A/B-eligible;
the 4 `frontier/` tasks are claw-wired and out of v1 scope.

## 3. Headline result — the two-tier verdict (VERIFIED)

| | **tier-64 (35B-A3B)** | **tier-16 (9B)** |
|---|---|---|
| Pass-rate delta (oc − claw) | **+3.1 pp** | **−7.7 pp** |
| 90% paired-bootstrap CI | **[+0.8, +6.3] pp** (excludes 0 → oc *superior*) | **[−13.1, −2.5] pp** (excludes 0 → oc *worse*) |
| Rule 0a.1 (non-inferiority) | **MET** | **NOT MET** |
| Median wall-clock (oc / claw) | 13.2 s / 21.7 s = **0.61×** | 23.5 s / 24.4 s = **0.96×** |
| Rule 0a.2 (≤1.5×) | **MET** | MET |
| **Verdict** | **RETIRE the claw rig** | **KEEP the claw rig** |
| Registry (gitignored) | `run_registry.config-ab-20260606-165548.jsonl` | `run_registry.config-ab-20260607-062848.jsonl` |

**The thesis the synthesis should make:** the claw bundle's value is
**model-strength-dependent**. The grammar + system-prompt scaffolding is **redundant**
for the strong 35B-A3B (which matches/beats native serving and runs ~1.6× faster
without it) but **load-bearing** for the weak 9B (which regresses 5.5–7.7 pp when the
scaffolding is stripped). A tier-64 retire and a tier-16 keep are both valid under the
per-tier-independent §0a rule — not a contradiction.

Per-tier texture (for the writeup):
- **tier-64:** oc matched-or-beat claw on **all 32** tasks (28 ties, wins on
  `expression-eval` +50pp where claw context-overflowed, `wordy` +25pp). Superiority
  is real but task-concentrated; **non-inferiority is the rock-solid claim**.
- **tier-16:** oc regressed on 13 tasks, won 5, tied the rest. Aggregate driven by
  `two-bucket` (−60.7), `eight-functions`/`subtle-broken-spec` (−37.5), `csv-parser`
  (−30.4), the `−25` cluster (`dependency-graph`/`ini-parser`/`json-schema-validate`/
  `wordy`); partly offset by oc wins on `word-search` (+30.4), `lru-cache` (+21.4),
  `adversarial-input` (+16.7).

## 4. Honest caveats & loose ends (the synthesis MUST carry these)

1. **tier-16 is a CAPABILITY PROXY, not a 16 GB-hardware adoption call.** Run on the
   64 GB M5 Max with ~50 GB headroom — it does **not** reproduce 16 GB memory pressure
   / KV eviction. It characterizes the *capability* of claw-bundle vs native serving on
   the 9B weights. A faithful 16 GB verdict needs real 16 GB silicon.
2. **Thinking-OFF harness mode, both tiers.** Production claw may run thinking-on; the
   comparison is the thinking-off configuration (#017 skew). State this scope.
3. **Eligibility asymmetry (tier-16).** claw's context-overflows surface as typed
   `harness_error` (dropped as ineligible, 17 rows); OpenCode's budget-exhaustion
   surfaces as `timeout` (eligible fail). The pre-registered drop-`harness_error` rule
   is symmetric in *definition* but the *data* is asymmetric → it slightly favors claw.
   **Sensitivity:** counting claw's 17 overflows as eligible fails moves the delta
   −7.7 → **−5.5 pp** (point estimate). KEEP is robust either way (canonical CI upper
   bound −2.5 < 0). **Loose end:** the −5.5 has **no CI yet** — a normalized bootstrap
   needs a renderer flag (reclassify the 17 overflow rows as eligible fails, then
   `pairedBootstrapCI`). Worth computing for the paper.
4. **tier-16 split provenance.** Its dataset is two driver runs: claw Phase A from the
   original sweep; opencode Phase B from a `SKIP_PHASE_A=1` re-run after a port fix
   (below). Defended methodologically (pairing is by `test_id`, not wall-clock; the
   phase-swap design already collects arms non-simultaneously). Note it.
5. **Server prompt/decode timing parity — DEFERRED (not measured).** Both sweeps ran
   `OPENCODE_SERVER_TIMINGS` OFF: the #021/#022 ordinal join has a `count_mismatch`
   (OpenCode emits an extra title-generation server request → N+1 timings vs N
   iterations → misaligned ordinal pairing). Fix = key the join robustly (filter the
   title-gen call / match by content), then a timings-on sweep. Neither §0a rule needs
   it.
6. **Token parity — NOT in the registry schema.** Cross-harness token comparison needs
   the #021 transcript adapter's `iterations.jsonl` (which *does* capture per-iteration
   tokens) joined to rows. Deferred.
7. **The tier-16 port bug (fixed, instructive).** `opencode.json` hard-coded the
   tier-64 baseURL `:11436`; #018 stood up the tier-16 *server* (`:11437`) but never
   made the *client* config tier-aware. The first tier-16 sweep's entire Phase B
   ConnectionRefused-looped to timeout (a degenerate 0% that would have *falsely*
   manufactured a KEEP). Caught in verification; fixed (`opencode.16.json` +
   tier-selectable `${OPENCODE_CONFIG_JSON}` mount, `db90963`) and re-run. Good
   cautionary tale for the methods section.

## 5. Artifacts & how to reproduce

- **Renderer:** `host/test/scripts/config-ab-verdict.mjs <registry> --tier <N>` —
  re-derives all figures via `lib/paired_bootstrap.js` + `lib/registry.js`.
- **Gate:** `host/test/scripts/config-ab-pairing-check.mjs <registry> --tier <N>` —
  config_id discipline + both-sides-bucketed invariant.
- **Driver:** `host/test/run-config-ab.sh` (`PHASE_SWAP`, `SKIP_PHASE_A`, tier-aware).
- **Registries** (gitignored, under `host/test/.claw-runtime/`): tier-64
  `…-165548.jsonl`, tier-16 `…062848.jsonl`; discarded port-bug Phase B preserved at
  `…230902.jsonl`.
- Run via `node` in `mac-llm-lab-test:local` or `node:22-slim` with the repo mounted
  (no host node). Bootstrap is seeded → bit-for-bit reproducible.

## 6. Brief for the deep-research + synthesis agent

**Deliverable:** a final report draft (the PhD-reviewable writeup) that positions and
defends the two-tier finding.

**Synthesis (from the verified results above):**
- Frame the question, the apples-to-apples design, and the pre-registered §0a rules.
- Present the two-tier verdict + the **model-strength-dependent scaffolding** thesis.
- Carry **every** caveat in §4 honestly — lead with non-inferiority (robust); treat
  point-superiority/inferiority as task-concentrated; foreground the tier-16
  capability-proxy + thinking-off scope limits.
- Optionally close loose end §4.3 (compute the normalized-treatment bootstrap CI).

**Deep research (external context to gather + cite):**
- Grammar-constrained / structured decoding vs native tool-calling for small local
  models (GBNF, llama.cpp tool-call support, JSON-mode reliability).
- Small-model scaffolding effects (does prompt/format scaffolding help weak models more
  than strong ones — any prior evidence of this strength-dependent pattern?).
- The models in play (Qwen3.5-9B, Qwen3.6-35B-A3B / MoE-A3B), OpenCode as an agent
  harness, local-coding-agent eval methodology, paired non-inferiority testing in ML.
- Position the model-strength-dependent-scaffolding finding against related work.

**Guardrails:** re-derive any experiment number from the registries (don't trust prior
summaries); state scope precisely (tier-64 vs tier-16, capability-proxy, thinking-off);
distinguish pre-registered results from post-hoc sensitivity; cite external claims.
