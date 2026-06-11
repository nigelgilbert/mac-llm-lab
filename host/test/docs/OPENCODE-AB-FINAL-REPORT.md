# Does the bespoke "claw rig" still earn its keep? A two-tier, pre-registered non-inferiority A/B of grammar-constrained serving vs. vanilla OpenCode for local coding agents

**Final report — OpenCode-vs-claw config-(a) experiment.**
Branch `experiment/opencode`; 22/22 tickets Done (2026-06-07). Every figure in this
report was **re-derived from the raw run-registries** by the rendering scripts
([`config-ab-verdict.mjs`](../scripts/config-ab-verdict.mjs),
[`config-ab-normalized-ci.mjs`](../scripts/config-ab-normalized-ci.mjs)) over the #015
statistic ([`lib/paired_bootstrap.js`](../lib/paired_bootstrap.js)); none is transcribed
from a prior summary. Inputs: parent plan
[OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) (§0a rules, §0b oracle, §4
design), per-tier verdicts [tier-64](OPENCODE-AB-TIER64-VERDICT.md) /
[tier-16](OPENCODE-AB-TIER16-VERDICT.md), and the verified synthesis
brief (an interim handoff doc, fully absorbed into this report and
deleted 2026-06-10; in git history).

---

## Abstract

We ask a narrow adoption question with a clean experimental answer: can a bespoke
local-LLM serving stack — a **GBNF grammar that constrains tool-call syntax**, a
**hand-tuned tool-discipline system prompt**, and a **LiteLLM Anthropic-API tool path**
(collectively, the "claw rig") — be **retired** in favour of vanilla **OpenCode** talking
natively to a dedicated `llama.cpp` server, *without losing eval performance* on a Mac?
We hold the weights, inference engine, sampler, context limit, and thinking-mode constant
across both arms, so a measured delta is attributable to the **serving bundle**, not the
model. The decision rule is **pre-registered**: retire iff the lower bound of a 90%
paired-bootstrap CI on the pass-rate delta is `> −5 pp` **and** OpenCode's median
wall-clock is `≤ 1.5×` claw's, evaluated **per hardware tier independently**.

The result is a **two-tier split, and the split is the finding**:

- **tier-64** (strong model — Qwen3.6-35B-A3B MoE, ~3B active): OpenCode is **+3.1 pp**,
  90% CI **[+0.8, +6.3] pp** (excludes 0 → *superior*, not merely non-inferior) and runs
  **~1.6× faster** → **RETIRE**.
- **tier-16** (weak model — dense Qwen3.5-9B): OpenCode is **−7.7 pp**, 90% CI
  **[−13.1, −2.5] pp** (excludes 0 → *worse*) at wall-clock parity → **KEEP**.

We argue these are not contradictory but two readings of one mechanism: **the value of
format/grammar scaffolding is model-strength-dependent.** The grammar + system-prompt
scaffold is **redundant** for the strong model (which already wraps tool-calls correctly
and disciplines its own loop) but **load-bearing** for the weak model (which regresses
~5.5–7.7 pp when the scaffold is stripped). We lead with the robust **non-inferiority**
claims; we treat the point superiority/inferiority as **task-concentrated**; and we carry
every scope limit explicitly (tier-16 is a *capability proxy* on 64 GB silicon, both arms
are *thinking-off*, an *eligibility asymmetry* tempers the tier-16 magnitude, and the
tier-16 dataset has *split provenance*).

---

## 1. The question and what is on trial

The eval harness (`runAgent` + run-registry + reporter) is the lab's durable asset and is
reused **unchanged** on both arms. The thing **on trial for retirement** is the bespoke
serving/prompt/grammar stack wrapped around the model. Concretely:

| | **Config A — `claw-rig`** (incumbent) | **Config B — `opencode-a`** (challenger) |
|---|---|---|
| Agent | ClawCode (Rust) | OpenCode (Go) |
| Serving path | `llama-server` → **LiteLLM** Anthropic bridge → claw | dedicated `llama-server` → OpenCode (no bridge) |
| Tool path | **`claw.gbnf`**-constrained `<tool_call>` wrapper, Anthropic tool API | **native** `<tool_call>` → OpenAI `tool_calls` |
| Prompt | **`system-prompt.md`** tool-discipline preamble | OpenCode defaults |
| Template | stock Qwen template (via bridge) | corrected Jinja (HTTP-500 / dropped-system-message fix) |

This is a **bundle-level** comparison, by design (plan §0): the adoption driver is "can I
delete this engineering?", not "which single component matters?". It is a *tighter*
isolation than a product bake-off — weights and engine are identical — but it is **not**
"pure harness": the serving *config* genuinely differs. The honest framing is therefore
*"claw serving+harness bundle vs OpenCode serving+harness bundle, weights fixed."*

### 1.1 What the scaffold actually is (so "scaffolding" is concrete, not hand-wavy)

The two on-trial scaffold components are small and mechanistically specific:

- **`claw.gbnf`** ([grammars/claw.gbnf](../../llama-server/grammars/claw.gbnf)) constrains
  only the **wrapping** of a tool call — that any tool call be emitted as
  `<tool_call>\n{"name": ..., "arguments": {...}}\n</tool_call>` with valid JSON inside.
  It deliberately does **not** constrain tool names or argument schemas. Its own header
  states the rationale precisely: *"The model is already reliable on tool-name and
  arg-shape correctness — the bug is the* wrapping*, which is what we fix."* The grammar
  cannot make the model *want* to call a tool; it only guarantees the *format* is valid
  *if* it does.
- **`system-prompt.md`** ([docs/system-prompt.md](../../llama-server/docs/system-prompt.md))
  is a six-rule **tool-use discipline** preamble: one tool call per response when one
  operation suffices, *trust tool results* (do not re-call after success), batch distinct
  operations, never echo the tool catalogue, end with a brief confirmation, and **"ACT, do
  not narrate"** (emit the tool-call rather than saying "I'll create…").

Both target the *form and discipline* of tool use — exactly the behaviours a weaker model
is more likely to get wrong (mis-wrapped tool calls, duplicate calls, narration instead of
action). This is the mechanistic seed of the thesis in §5.

---

## 2. Design — apples-to-apples (the bundle is on trial, not the model)

Both arms hold **everything** constant except the serving bundle, and the invariants are
**verified in every row's provenance fingerprint** (`model_config_id`, `model_id`,
`quantization`, `context_limit`, `sampler_config_id`, `prompt_pack_version`,
`harness_version`), re-printed by the renderer:

| Held constant (both arms) | tier-64 | tier-16 |
|---|---|---|
| Model / GGUF | Qwen3.6-35B-A3B `UD-Q4_K_XL` (~21 GB) | Qwen3.5-9B `IQ4_XS` (~5 GB) |
| Architecture class | MoE, ~3B active params | dense 9B |
| Engine | llama.cpp `llama-server` | llama.cpp `llama-server` |
| `context_limit` | 65536 | 65536 |
| Sampler | `v1-prod` | `v6-antiloop` |
| Prompt pack | `pp01` | `pp01` |
| Thinking mode | **OFF both arms** (#017) | **OFF both arms** (#017) |
| N per cell | 8 | 8 |
| Pass oracle | `/workspace` post-script exit 0 (config-agnostic, #001/§0b) | same |

The sampler is held constant deliberately: adopting OpenCode does **not** force abandoning
the tuned sampler (you set temp/top-p/penalties on OpenCode's own `llama-server`), so
equalizing it credits a delta to exactly the four on-trial components rather than to
sampler luck (plan §1). The pass oracle is **workspace-only** (`post.status === 0`) on both
sides; the `agent.code === 0` gate is dropped because it is a claw-ism whose `opencode run`
analogue is unconfirmed and could false-fail a correct workspace (§0b).

### 2.1 Task set = 32 (not the plan's "35")

The A/B set is **32 `runAgent` tasks**, verified `0 unpaired` (every task has eligible runs
on both arms). The plan's "35" over-counted: `latency`, `prose-quality`, and
`tool-discipline` are claw-bridge **probe diagnostics** that never call `runAgent` and emit
no registry row, and the 4 `frontier/` tasks are claw-wired (they call `runClaw` directly)
and out of v1 scope. This is a counting correction, not a dropped-data problem — the
pairing gate confirms both sides bucket on all 32.

### 2.2 Thinking-mode parity (a non-trivial confound, controlled)

Both arms run **thinking-off**, and this was *established empirically*, not assumed
([TIER16-THINKING-PARITY-DECISION.md](TIER16-THINKING-PARITY-DECISION.md)). claw forces it
through the `anthropic/claw-llama` LiteLLM route's per-request
`chat_template_kwargs.enable_thinking=false`; OpenCode forces it with
`--chat-template-kwargs '{"enable_thinking":false}'`. A live `/apply-template` probe on the
exact tier-16 GGUF + pinned build (`b1-5594d13`) confirmed the per-request override **wins**
over the server launch-time `true` (flipping an open `<think>` to a closed `<think></think>`
prefill) — defusing an upstream report that `enable_thinking=false` is *ignored* on
Qwen3.5. Because OpenCode has **no grammar backstop**, #018 additionally asserted the
thinking-off prefill on OpenCode's own server before any numbers were trusted. (Scope
consequence — see §6.2: *production* claw runs thinking-**on**; this A/B characterizes the
harness thinking-off mode.)

---

## 3. The pre-registered decision rule and statistic

Adoption is a stopping decision, so the rule was committed **before** seeing data (plan
§0a, grill session 2026-06-05):

> **Retire the claw rig at a tier iff both hold:**
> **0a.1 (pass-rate non-inferiority):** lower bound of the **90% paired-bootstrap CI** on
> `(opencode-a − claw-rig)` aggregate pass-rate is **> −5 pp**; **and**
> **0a.2 (speed):** OpenCode **median wall-clock ≤ 1.5×** claw's.
> Otherwise **KEEP**. Evaluated **per tier independently** — a tier-64 retire and a
> tier-16 keep was pre-registered as a *valid* outcome, not a contradiction.

Three features make this the right instrument and are worth foregrounding for review:

1. **Non-inferiority, not superiority** (cf. §7). The maintenance win of deleting the
   bridge + grammar + prompt has standalone value, so the question is whether OpenCode is
   *not meaningfully worse* — which demands a margin (`−5 pp`, the one subjective knob:
   "pass-rate I will trade to kill the bespoke stack") and a **one-sided** read of the CI
   lower bound, not a two-sided "is there a difference" test.
2. **Paired by task, bootstrapped over tasks** (#015,
   [`lib/paired_bootstrap.js`](../lib/paired_bootstrap.js)). The unit of analysis is each
   task's pass-probability; the bootstrap resamples the **32 tasks** (B=10000, seed
   `0xc0ffee`), *not* the 256 pooled Bernoulli trials. Pooling would treat tasks as iid and
   **understate variance** (pseudo-replication); pairing by `test_id` cancels per-task
   difficulty and is what licenses reusing non-simultaneous arms (§6.4). Seeds cannot be
   matched across harnesses (different tokenization/prompts), so N=8 samples each cell's
   stochastic pass-distribution.
3. **Per-task deltas reported alongside the aggregate** so a single regressed task is
   *visible*, not averaged away (§0a).

---

## 4. Results — the two-tier verdict (re-derived from the registries)

| | **tier-64 (35B-A3B)** | **tier-16 (9B)** |
|---|---|---|
| Registry (gitignored) | `…config-ab-20260606-165548.jsonl` | `…config-ab-20260607-062848.jsonl` |
| Rows | 512 = 2×32×8 | 512 = 2×32×8 |
| Eligible (claw / oc) | 254 / 256 | 239 / 256 |
| **Pass-rate delta (oc − claw)** | **+3.1 pp** | **−7.7 pp** |
| **90% paired-bootstrap CI** | **[+0.8, +6.3] pp** (excludes 0 → superior) | **[−13.1, −2.5] pp** (excludes 0 → worse) |
| Rule 0a.1 (non-inferiority) | **MET** | **NOT MET** |
| Median wall-clock (oc / claw) | 13.2 s / 21.7 s = **0.61×** | 23.5 s / 24.4 s = **0.96×** |
| Rule 0a.2 (≤ 1.5×) | **MET** | MET |
| Iteration median (claw / oc) | 5 / 5 | 8 / 9 |
| **Verdict** | **RETIRE** the claw rig | **KEEP** the claw rig |

Both CIs are **seed-stable** (a guard against a lucky bootstrap draw): tier-64 is
`[+0.8, +6.3]` identically across seeds `0xc0ffee / 0x1 / 0x3039`; tier-16 is
`[−13.1, −2.5] / [−13.0, −2.6] / [−13.2, −2.4]` — all exclude 0, all lower bounds far
below `−5 pp`. The independent #013 pairing gate confirms both arms bucket on all 32 tasks
(claw baseline **not** dropped to zero — the exact failure it guards against).

### 4.1 tier-64 texture — non-inferiority is the rock-solid claim; superiority is concentrated

OpenCode **matched or beat** claw on **all 32** tasks (4 wins, 28 ties, **0 regressions**;
worst per-task delta `+0.0 pp`). Of the 28 ties, 27 are 8/8↔8/8 and one is `two-bucket`
(7/8↔7/8). The aggregate is carried by a handful:
`expression-eval` **+50.0 pp** (claw context-overflowed/timed-out here; oc 8/8),
`wordy` **+25.0 pp**, and `book-store` / `deep-equal` **+12.5 pp** each. So while the CI
formally excludes 0 (statistically *superior* on this panel), the defensible headline is
**non-inferiority**: superiority rests on a few tasks where claw's serving path was fragile
(notably context-overflow on `expression-eval`), and should be stated as
task-concentrated, not as a broad capability win. Speed, by contrast, is unambiguous and
broad: oc median 13.2 s vs claw 21.7 s (**0.61×**, i.e. ~1.6× faster), holding even if
claw's two long context-overflow crashes are excluded (claw eligible-only median 21.6 s).

### 4.2 tier-16 texture — the regression, and where it lives

OpenCode **regressed on 13 tasks, won 4, tied 15** (re-derived from the rows — this
**corrects** the per-tier verdict doc and the brief, which both report "won 5"; an
off-by-one in the prose tally that changes **no** delta or CI, since the bootstrap operates
on the per-task deltas, not on the win count — but exactly the kind of slip the
"re-derive, don't trust summaries" guardrail exists to catch). Mean per-task pass-rate:
claw **84.3%** vs oc **76.6%**. The aggregate `−7.7 pp` is driven by:

| Driver (oc − claw) | delta |
|---|---|
| `two-bucket` | **−60.7 pp** |
| `eight-functions`, `subtle-broken-spec` | −37.5 pp each |
| `csv-parser` | −30.4 pp |
| `dependency-graph`, `ini-parser`, `json-schema-validate`, `wordy` | −25.0 pp each |

partly offset by OpenCode wins on `word-search` **+30.4**, `lru-cache` **+21.4**,
`adversarial-input` **+16.7**, `expression-eval` **+12.5**. Wall-clock is at **parity**
(0.96×), unlike tier-64 — the speed dividend that helped justify retiring at tier-64 simply
isn't present on the 9B, so even setting pass-rate aside there is no *speed* reason to
switch at this tier.

---

## 5. The thesis: scaffolding value is model-strength-dependent

The two verdicts are one mechanism read at two capability levels. Strip the bespoke
scaffold (grammar + system-prompt) and:

- the **strong** 35B-A3B MoE **does not regress** (matches/beats native serving) and runs
  **faster** without the bridge → the scaffold was **redundant**;
- the **weak** dense 9B **regresses 5.5–7.7 pp** → the scaffold was **load-bearing**.

The mechanism is concrete and follows directly from §1.1: the scaffold disciplines the
*form* of agentic behaviour — tool-call **wrapping** (the grammar) and tool-use **conduct**
(the system prompt: no duplicate calls, trust results, act-don't-narrate). A strong model
already does these reliably (the grammar's own header notes the model is "already reliable
on tool-name and arg-shape correctness"), so constraining them changes nothing and the
constraint's only measurable effect is the *cost* of the extra serving hop. A weak model is
exactly the one that mis-wraps tool calls, re-issues satisfied calls, and narrates instead
of acting; for it, the grammar and prompt convert would-be malformed or wasted turns into
valid actions, and removing them surfaces as lost pass-rate.

Two textures in our own data are consistent with (though not proof of) this account: (i)
the tier-16 regressions concentrate on *harder, longer-context* tasks (`two-bucket`,
`eight-functions`, `csv-parser`, the spec-compliance cluster), where a weak model's
tool-use discipline is most load-bearing and most likely to break under native parsing;
(ii) the same eligibility asymmetry that we correct for in §6.3 — claw's overflow-prone
tasks failing *typed* while OpenCode's fail as plain timeouts — is itself a fingerprint of
the bridge catching a failure mode the native path lets run to budget exhaustion.

A subtlety worth stating for review, because it sharpens rather than weakens the thesis:
"strength" here is **not** raw active-parameter count. The strong tier-64 model is an MoE
with only ~3B *active* parameters, fewer than the dense 9B's; what makes it the stronger
*tool-user* is its larger total capacity and (presumably) better post-training, not more
compute per token. The dependent variable is **agentic/tool-use competence**, and on that
axis the MoE dominates the dense 9B. §7 positions this against the related-work record on
scaffolding, constrained decoding, and capability-dependent prompting.

---

## 6. Threats to validity and scope limits (carried in full)

The decision is robust within its scope; the scope is narrow and stated precisely here. No
caveat below is load-bearing against either *pre-registered* verdict, but all bound the
*generalization*.

### 6.1 tier-16 is a CAPABILITY PROXY, not a 16 GB-hardware adoption call

The tier-16 sweep ran on the **64 GB M5 Max** with ~50 GB of headroom. It does **not**
reproduce 16 GB memory pressure or KV-cache eviction. It characterizes the *capability* of
the claw-bundle vs native serving on the **9B weights**, which is a legitimate and useful
question, but it is **not** a faithful 16 GB silicon verdict. A real 16 GB adoption decision
needs real 16 GB hardware (plan §0). This is the single most important reader caveat: the
"KEEP at tier-16" is a capability statement about the 9B, not "claw wins on small Macs."

### 6.2 Thinking-OFF harness mode, both tiers

Both arms are thinking-off (§2.2). **Production** claw-16 routes through `anthropic/claw`
(no override) and is therefore thinking-**on**; the harness route (`anthropic/claw-llama`)
is thinking-off. The skew is *behavioural*, not cosmetic (#017). This A/B is a valid
controlled comparison of "claw serving bundle, thinking-off" vs OpenCode — which is what the
plan intends — but its numbers should **not** be read as production claw-16's thinking-on
performance. A production-faithful, thinking-on sub-variant is deferred.

### 6.3 Eligibility asymmetry (tier-16) — and the now-computed normalized CI

There is a **measurement asymmetry** worth surfacing because it slightly favours claw. The
9B's "ran out of context/budget on a hard task" failure mode surfaces as **two different
terminal states** by serving stack:

- **claw** → LiteLLM returns a typed `BadRequestError` → `terminal_status = harness_error`
  → **dropped as ineligible** (17 rows, all `context_overflow`);
- **OpenCode** → no typed overflow; the run consumes its wall-clock budget →
  `terminal_status = timeout` → **eligible fail** (0 oc `harness_error`).

The pre-registered drop-`harness_error` rule (§0b) is symmetric **in definition** but the
*data* is asymmetric, so it removes claw failures from the denominator while keeping
OpenCode's. We quantify the effect by recomputing with claw's 17 overflows reclassified as
**eligible fails** (symmetric with OpenCode's timeouts), via
[`config-ab-normalized-ci.mjs`](../scripts/config-ab-normalized-ci.mjs) over the same #015
statistic:

| Treatment | Aggregate delta (oc − claw) | 90% paired-bootstrap CI |
|---|---|---|
| **Canonical** (drop overflow) — *pre-registered* | **−7.74 pp** | **[−13.06, −2.51] pp** |
| **Normalized** (overflow = eligible fail) — *post-hoc sensitivity* | **−5.47 pp** | **[−10.94, 0.00] pp** |

This **closes the loose end** the brief flagged (the `−5.5 pp` previously had a point
estimate but no CI). Two honest reads, both reported:

1. **The KEEP verdict is robust to the eligibility convention.** Non-inferiority (Rule
   0a.1) **fails under both** treatments — the CI lower bound is `−10.9 pp` even normalized,
   far below the `−5 pp` margin. The pre-registered decision does not move.
2. **But the *strength* of the secondary "statistically worse than parity" claim is
   convention-dependent.** The canonical CI excludes 0 (upper `−2.5`); the normalized CI's
   upper bound **reaches 0.0** ([−10.94, 0.00]). So under the symmetric convention we can no
   longer assert OpenCode is *strictly* worse-than-parity at the 90% level — only that it
   **fails the −5 pp non-inferiority bar**, which is the limb that actually drives the
   decision. The defensible statement is: *"OpenCode is worse on the 9B by roughly 5.5–7.7
   pp; non-inferiority fails at either end."* The canonical `−7.7` slightly overstates the
   gap.

### 6.4 tier-16 split provenance

The tier-16 dataset is assembled from **two driver runs**, not one phase-swap sweep: the
**claw-rig rows are Phase A** of the original sweep (clean; span 2026-06-07T04:09→09:33Z),
and the **opencode-a rows are a Phase-B-only re-run** (`SKIP_PHASE_A=1`; span
2026-06-07T11:31→16:14Z) after the port fix in §6.7. This is methodologically defensible:
§0a's unit of analysis is per-task pass-probability **paired by `test_id`** (not by
wall-clock), and the phase-swap design (§4.2) *already* collects the two arms
non-simultaneously and explicitly accepts phase-time confounds; the apples-to-apples
invariants are properties of the *config* and are verified identical across both runs in the
rows. Reuse was an operator choice to avoid re-burning ~5 h of valid claw runs and a second
production-downtime window. It is noted, not hidden; the discarded port-bug Phase B is
preserved for audit (`…230902.jsonl`).

### 6.5 Server prompt/decode timing parity — DEFERRED (not measured)

Both sweeps ran with `OPENCODE_SERVER_TIMINGS` **OFF**. The #021/#022 ordinal join has a
`count_mismatch`: OpenCode emits an extra **title-generation** server request (N+1 server
timings vs N harness iterations), which would misalign an ordinal server-decode split. The
fix is to key the join robustly (filter the title-gen call / match by content) and then run
a timings-on sweep. **Neither §0a rule needs it** — both are decided on pass-rate and
wall-clock alone — so this is an honest deferral, not a gap in the verdict.

### 6.6 Token parity — NOT in the registry schema

The `run_registry` schema carries **no token field**, so cross-harness token counts cannot
be derived from these rows (the renderer reports this as ABSENT rather than implying it).
Token parity needs the #021 transcript adapter's `iterations.jsonl` (which does capture
per-iteration tokens) joined to rows. Deferred.

### 6.7 The tier-16 port bug (fixed; instructive for the methods record)

The first tier-16 sweep's entire Phase B was a **degenerate 0%**: `opencode.json`
hard-coded the **tier-64** baseURL (`host.docker.internal:11436`), but #018 had stood up
the tier-16 *server* on `:11437` and never made the *client* config tier-aware. Every
tier-16 oc cell `ConnectionRefused`-looped to timeout (`iters=1`, 0 tokens, 0 tool calls).
A 0% OpenCode arm would have **falsely manufactured a KEEP**. It was caught in verification,
root-caused, fixed (`opencode.16.json` pointing at `:11437` + a tier-selectable
`${OPENCODE_CONFIG_JSON}` compose mount + driver wiring, `db90963`), verified end-to-end,
and re-run. This is the concrete reason the present report **re-derives every number from
the registries rather than trusting prior summaries** — a plausible-looking verdict can be
an artifact of a serving misconfiguration, and only re-derivation catches it.

---

## 7. Related work and external context

External claims below were gathered by a fan-out deep-research pass and **adversarially
verified** (3-vote, refute-by-default); 5 of 25 candidate claims were killed, including a
plausible-but-hallucinated, future-dated arXiv id (`2604.02547`) that would have been the
single most on-point support for the thesis. Its removal is *why* §7.7 frames the finding
as **novel-triangulated** rather than confirmed by a head-on prior. Citations the verifier
could not confirm are not used; contested claims are flagged in place.

### 7.1 Constrained/structured decoding vs. native tool-calling

Grammar-constrained decoding (GCD) masks each decoding step to the tokens a formal grammar
permits, **guaranteeing syntactically valid output by construction and without
finetuning** — Geng et al., *Grammar-Constrained Decoding for Structured NLP Tasks without
Finetuning*, EMNLP 2023 (arXiv:2305.13971). `claw.gbnf` is exactly this: a **wrapper-only**
grammar (the constraint is decoding-time, not prompt-injected), which is why it can enforce
tool-call *form* without touching tool *semantics* (§1.1). `llama.cpp` implements GCD via
its GBNF format (grammars/README.md) and exposes native OpenAI-style tool-calling on
`llama-server`, but only with a correct chat template (`--jinja`, per-model handlers + a
Generic fallback; function-calling.md).

Whether such format constraints **help or hurt task accuracy is genuinely debated**, and
our verification sharpened rather than settled it:

- *Let Me Speak Freely?* (Tam et al., EMNLP 2024 industry track, arXiv:2408.02442) is the
  locus of the concern that format restriction can affect performance. **Important
  honesty:** our verifiers **could not confirm** the paper's strongest reading (that
  JSON-mode/constrained decoding *substantially degrades reasoning*, e.g. large GSM8K
  drops) — that specific claim was refuted/contested (0–3) and is rebutted in industry work
  arguing the effect is an artifact of weak prompting/parsing rather than of constraint
  itself (dottxt, *Say What You Mean: A Response to "Let Me Speak Freely"*, 2024,
  non-peer-reviewed). The **robust, verified** takeaway is weaker and more useful to us:
  format restriction's effect is **non-uniform** — it can *help* on bounded tasks (Tam et
  al. report a classification case improving 41.6→60.3%) and need not help on others.
- Park et al., *Grammar-Aligned Decoding*, NeurIPS 2024 (arXiv:2405.21047), show GCD
  **distorts the model's distribution** (it samples grammatical but lower-likelihood
  continuations) — a measurable **KL/likelihood cost**, *not* a demonstrated task-accuracy
  regression. This is a clean mechanism for our tier-64 result: imposing a constraint a
  *strong* tool-user does not need can only add cost (here, a serving-latency cost), never
  benefit — consistent with the scaffold being redundant-and-slightly-costly at tier-64.
- The nearest-neighbour prior is a **model-*type*** effect, not a strength effect: Schall &
  de Melo (RANLP 2025, aclanthology 2025.ranlp-1.124) find constrained decoding affects
  **base vs. instruction-tuned** models differently. Useful as a precedent that "the same
  constraint, different model → different sign," but it is a different axis from ours (§7.7).

That `llama.cpp`'s **native** tool-call path is fragile — the exact failure the claw
grammar pre-empts — is well documented as a *persistent class* (pin a build, since the
parser churns: a Jan-2026 PEG refactor renamed enums): tool calls mis-serialized into the
content string (issue #14697); `tool_calls.arguments` returned as a JSON **object** that
crashes the OpenAI Python SDK (issue #20198, fixed in PR #20213); false-thinking leaking
into `reasoning_content` on a Qwen3-Instruct build (issue #20809). These are the upstream
analogues of the wrapping bug `claw.gbnf` exists to fix, and they motivate this lab's
thinking-off + template-correctness diligence (#017/§2.2). *(Our verifiers rejected a
stronger framing that the parse failure is non-deterministic at fixed config — cite the
fragility, not non-determinism.)*

### 7.2 Strength-dependent scaffolding — the positioning question

The cleanest comparable is the **opposite-direction** result: chain-of-thought is a
prompting *scaffold* whose benefit **grows with scale** — it helps large (~100B+) models
and can be neutral-to-harmful for small ones (Wei et al., *Chain-of-Thought Prompting
Elicits Reasoning in LLMs*, NeurIPS 2022, arXiv:2201.11903), part of the broader
"emergent abilities" scaling story (Wei et al., TMLR 2022, arXiv:2206.07682; whose
*abruptness* is itself contested as a metric artifact — Schaeffer, Miranda & Koyejo, *Are
Emergent Abilities a Mirage?*, NeurIPS 2023 Outstanding Paper, arXiv:2304.15004). Our
finding is the **mirror image**: a *format/discipline* scaffold whose benefit **shrinks
with capability**. The two are reconcilable — reasoning scaffolds need a capable substrate
to amplify; *formatting* scaffolds substitute for a competence the strong model already has
— but no surviving source states our direction on a model-*strength* axis directly (§7.7).

### 7.3 Qwen3 MoE "A3B" architecture

The lab's specific point versions (`Qwen3.5-9B`, `Qwen3.6-35B-A3B`) are **local builds we
could not externally verify**, so all architectural claims anchor to the verifiable
**Qwen3-30B-A3B**: a mixture-of-experts model with **30.5B total / 3.3B active** parameters
(128 experts, 8 active per token, 48 layers) — HF model card; Qwen3 Technical Report
(arXiv:2505.09388); Qwen3 blog (qwenlm.github.io/blog/qwen3). This anchors the report's key
architectural subtlety (§5): a larger-*total* MoE with **few active params** can be a
*stronger tool-user* than a dense 9B — Qwen3-30B-A3B scores ~69 on the Berkeley
Function-Calling Leaderboard v3 (OpenReview 2GmDdhBdDk), evidence for "strong tool-user"
beyond vendor phrasing (our verifiers flagged the unqualified "leading" claim as marketing,
2–1). The dense-vs-MoE inference tradeoff (more total capacity, constant active-FLOPs) is
the standard MoE rationale (Epoch AI, *MoE vs dense models*, secondary). The upshot for our
design: "strength" is **tool-use competence**, not active-parameter count — the MoE is the
strong arm despite fewer active params than the dense 9B.

### 7.4 OpenCode as an agentic harness

OpenCode is an open-source terminal coding agent that is **provider-agnostic** and talks to
any **OpenAI-compatible** endpoint with **native tool-calling** (opencode.ai/docs) — which
is exactly the configuration of Config B (a dedicated `llama-server` on the OpenAI-compatible
port, no LiteLLM bridge, native `<tool_call>`→`tool_calls`). It is the "vanilla" challenger
precisely because it imposes none of the bespoke serving layer the experiment puts on trial.

### 7.5 Coding-agent evaluation methodology

Functional-correctness eval via execution and the **pass@k** estimator originate with Chen
et al., *Evaluating Large Language Models Trained on Code* (HumanEval), 2021
(arXiv:2107.03374); agentic, repository-level eval with execution-based oracles is the
SWE-bench paradigm (Jimenez et al., ICLR 2024, arXiv:2310.06770) — our `/workspace`
post-script oracle (§2) is a small-scale instance of the same execution-grounded principle.
That small-model/agent evals are **variance-dominated** unless decoding, seeds, and prompt
formatting are controlled is the explicit message of Hochlehnert et al., *A Sober Look at
Progress in LM Reasoning: Pitfalls and Paths to Reproducibility*, 2025 (arXiv:2504.07086) —
direct external justification for our held-constant sampler, N=8 per cell, seeded bootstrap,
and full attrition accounting. The case for attaching **statistical uncertainty** to eval
numbers (resampling, clustered/question-level variance, **paired** differences for power) is
made by Miller, *Adding Error Bars to Evals*, 2024 (arXiv:2411.00640), which independently
motivates our move from a point pass-rate to a paired-bootstrap CI.

### 7.6 Paired non-inferiority testing

Non-inferiority framing — a **pre-specified margin**, a **one-sided** read of the CI bound,
and the asymmetry between "not worse by more than δ" and "better" — is standard in
biostatistics (D'Agostino, Massaro & Sullivan, *Non-inferiority trials: design concepts and
issues*, *Statistics in Medicine* 22(2):169–186, 2003, doi:10.1002/sim.1425; EMA, *Guideline
on the Choice of the Non-Inferiority Margin*). Our §0a rule is a direct transcription: a
`−5 pp` margin (the "pass-rate I will trade to delete the stack"), the **lower** bound of a
90% CI as the test statistic, and the deliberate refusal to require superiority. The
specific instrument — a **paired bootstrap** resampling the *unit of pairing* to detect
whether a small delta is real — has a close ML-evaluation precedent in Du et al., *When +1%
Is Not Enough: A Paired Bootstrap Protocol for Evaluating Small Improvements*, 2025
(arXiv:2511.19794). Pre-registering the decision rule before data collection (plan §0a) is
the eval-side analogue of trial pre-registration and is exactly the discipline Miller (2024)
and Hochlehnert et al. (2025) argue ML evaluation needs.

### 7.7 How this finding is positioned

The thesis — *format/grammar scaffolding value is model-strength-dependent* — is best
described as **novel-triangulated**, and we state that limitation plainly:

- **No head-on prior on the strength axis survived verification.** The nearest results are
  on *different axes*: capability-*increasing* scaffolds (CoT) run the **opposite**
  direction (§7.2), and the one constrained-decoding "different model → different effect"
  result is a base-vs-instruction *type* axis, not a strength axis (§7.1). The single
  source that would have matched our direction head-on was a **hallucinated citation caught
  in verification** — its absence is a result, not an omission.
- **The mechanism is independently supported even though the headline is not.** Each link in
  the causal chain has external grounding: GCD guarantees validity without finetuning
  (Geng 2023); constraint imposes a distributional cost a capable model needn't pay (Park
  2024); native tool-call parsing is a documented fragility class (llama.cpp #14697/#20198/
  #20809); and scaffolding benefit is known to be capability-*contingent*, just previously
  observed in the opposite direction (Wei 2022). Our contribution is to demonstrate the
  *under-documented* direction — scaffolding as a **substitute for capability** that a
  strong model renders redundant — in a controlled, pre-registered, execution-grounded
  local-agent A/B.

### 7.8 References

1. Geng et al. *Grammar-Constrained Decoding for Structured NLP Tasks without Finetuning.* EMNLP 2023. arXiv:2305.13971.
2. Tam et al. *Let Me Speak Freely? A Study on the Impact of Format Restrictions on LLM Performance.* EMNLP 2024 (industry). arXiv:2408.02442. *(strong reasoning-degradation reading unconfirmed/contested.)*
3. dotxt. *Say What You Mean: A Response to "Let Me Speak Freely".* 2024. blog.dottxt.ai/say-what-you-mean.html. *(industry blog; non-peer-reviewed.)*
4. Park et al. *Grammar-Aligned Decoding.* NeurIPS 2024. arXiv:2405.21047.
5. Schall & de Melo. *(constrained decoding: base vs. instruction-tuned.)* RANLP 2025. aclanthology.org/2025.ranlp-1.124.
6. `llama.cpp` docs: function-calling.md, grammars/README.md; issues #14697, #20198 (fix PR #20213), #20809. github.com/ggml-org/llama.cpp.
7. Wei et al. *Chain-of-Thought Prompting Elicits Reasoning in Large Language Models.* NeurIPS 2022. arXiv:2201.11903.
8. Wei et al. *Emergent Abilities of Large Language Models.* TMLR 2022. arXiv:2206.07682.
9. Schaeffer, Miranda & Koyejo. *Are Emergent Abilities of Large Language Models a Mirage?* NeurIPS 2023 (Outstanding Paper). arXiv:2304.15004.
10. Qwen Team. *Qwen3 Technical Report.* 2025. arXiv:2505.09388. · *Qwen3-30B-A3B* model card, huggingface.co/Qwen/Qwen3-30B-A3B · blog, qwenlm.github.io/blog/qwen3.
11. *Berkeley Function-Calling Leaderboard (BFCL).* OpenReview 2GmDdhBdDk.
12. Epoch AI. *MoE vs. dense models (inference).* epoch.ai/gradient-updates/moe-vs-dense-models-inference. *(secondary.)*
13. OpenCode documentation. opencode.ai/docs.
14. Chen et al. *Evaluating Large Language Models Trained on Code* (HumanEval, pass@k). 2021. arXiv:2107.03374.
15. Jimenez et al. *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* ICLR 2024. arXiv:2310.06770.
16. Hochlehnert et al. *A Sober Look at Progress in Language Model Reasoning: Pitfalls and Paths to Reproducibility.* 2025. arXiv:2504.07086.
17. Miller. *Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations.* 2024. arXiv:2411.00640.
18. D'Agostino, Massaro & Sullivan. *Non-inferiority trials: design concepts and issues.* Statistics in Medicine 22(2):169–186, 2003. doi:10.1002/sim.1425.
19. EMA. *Guideline on the Choice of the Non-Inferiority Margin.* European Medicines Agency.
20. Du et al. *When +1% Is Not Enough: A Paired Bootstrap Protocol for Evaluating Small Improvements.* 2025. arXiv:2511.19794.

---

## 8. Reproducibility

Every figure is rendered, not asserted; the bootstrap is seeded so CIs are bit-for-bit
reproducible.

```sh
# from repo root; node lives in the test image (no host node)
REG64="$PWD/host/test/.claw-runtime/run_registry.config-ab-20260606-165548.jsonl"
REG16="$PWD/host/test/.claw-runtime/run_registry.config-ab-20260607-062848.jsonl"
DR="docker run --rm -v $PWD:$PWD -w $PWD/host/test --entrypoint node mac-llm-lab-test:local"

$DR scripts/config-ab-verdict.mjs "$REG64" --tier 64   # tier-64 RETIRE
$DR scripts/config-ab-verdict.mjs "$REG16" --tier 16   # tier-16 KEEP
$DR scripts/config-ab-normalized-ci.mjs "$REG16" --tier 16   # §6.3 normalized CI
$DR scripts/config-ab-pairing-check.mjs "$REG64" --tier 64   # independent pairing gate
$DR scripts/config-ab-pairing-check.mjs "$REG16" --tier 16
```

- **Statistic:** [`lib/paired_bootstrap.js`](../lib/paired_bootstrap.js) (B=10000, seed
  `0xc0ffee`, mulberry32 PRNG, type-7 percentile).
- **Registries** (gitignored, under `host/test/.claw-runtime/`): tier-64 `…165548`,
  tier-16 `…062848`; discarded port-bug Phase B `…230902`.
- **Eligibility:** a row counts iff `passed` is boolean and `terminal_status ∉
  {harness_error, interrupted}`. All ineligible rows are enumerated by the renderer, never
  silently dropped.

---

## 9. Conclusion

On this Mac, with weights, engine, sampler, context, and thinking-mode held constant:

- **Retire the claw rig at tier-64.** Vanilla OpenCode's native serving path matches-or-
  beats the bespoke stack on every one of the 32 tasks and runs ~1.6× faster; the
  maintenance win of deleting the LiteLLM bridge + `claw.gbnf` + `system-prompt.md` is
  realized with no measured pass-rate cost (a small measured gain).
- **Keep the claw rig at tier-16.** On the weaker 9B the bespoke scaffold is load-bearing:
  removing it costs ~5.5–7.7 pp of pass-rate at mere wall-clock parity. Non-inferiority
  fails under both eligibility conventions.

The unifying claim is **model-strength-dependent scaffolding**: format/grammar scaffolding
buys little for a model already competent at tool-use and a lot for one that is not. The
practical corollary for local-agent operators is a **capability-gated** adoption policy —
go vanilla where the model is strong enough to discipline itself, keep the scaffold where it
is not — rather than a single global "is OpenCode good enough?" answer.

**Scope, restated:** tier-16 is a capability proxy on 64 GB silicon, both arms are
thinking-off, and the headline gaps are point estimates whose robust core is the
**non-inferiority direction** (tier-64 not-worse; tier-16 not-non-inferior), not the
task-concentrated magnitudes. **Future work**, in priority order: a real-16 GB-silicon
sweep; a production-faithful thinking-on sub-variant; the robustly-keyed server-decode
timing join (§6.5) and token parity (§6.6); and OpenCode config-(b) (its *default* model)
for the fully off-the-shelf verdict the plan defers.
