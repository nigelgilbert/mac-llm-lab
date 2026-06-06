# Tier-16 thinking parity — determination & decision

**Issue:** [issues/017-tier16-thinking-parity.md](../../../issues/017-tier16-thinking-parity.md)
**Parent:** [OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) §0, §5
**Status:** RESOLVED 2026-06-06. Gating prerequisite for trusting tier-16 A/B numbers.
**Decision:** tier-16 A/B runs **both OFF** (claw-16 and OpenCode-16 both thinking-off).

---

## TL;DR

- **Under the test harness, claw-16 runs with thinking OFF.** Proven by config-trace
  *and* a live `/apply-template` probe on the actual tier-16 model + pinned build.
- The apparent contradiction ("route forces false" vs manifest "forced true") dissolves
  once you separate the **server launch default** (true) from the **per-request route
  override** (false): the per-request override **wins**, verified empirically.
- **Parity decision: both OFF.** It is the pre-registered default, it is what claw-16
  actually does under the harness, and OpenCode-16 *functionally requires* thinking-off
  (no grammar to catch a stray `<think>` → naked-XML tool-call freeze).
- **OpenCode-16 flag (for [#018](../../../issues/018-tier16-opencode-serving.md)):**
  `--chat-template-kwargs '{"enable_thinking":false}'` on OpenCode's dedicated
  `llama-server`, **with a mandatory `/apply-template` verification** (see §5).
- **Production ≠ harness skew exists and is behavioral**, not cosmetic: production
  claw-16 (`anthropic/claw` route) is thinking-**ON**; the harness (`anthropic/claw-llama`)
  is thinking-**OFF**. The A/B measures the harness mode. See §4.

---

## 1. The contradiction, stated precisely

Two repo facts looked irreconcilable:

1. **Route forces false.** The harness routes *every* tier through
   `clawModel = 'anthropic/claw-llama'` ([lib/tier.js:13](../lib/tier.js#L13) →
   [lib/runAgent.js:266](../lib/runAgent.js#L266) → `claw --model anthropic/claw-llama`
   in [lib/claw.js:86](../lib/claw.js#L86)). That LiteLLM route injects
   `extra_body.chat_template_kwargs.enable_thinking: false`
   ([litellm-config.yaml:71-78](../../litellm/litellm-config.yaml#L71-L78)).
2. **Manifest says forced true.** The tier-16 model-config notes say
   *"enable_thinking forced true via --chat-template-kwargs"*
   ([model_configs.json:177](../lib/model_configs.json#L177) for the Qwen3.5-9B sweep
   lineage; the archived 32k tier-16 entry [:338](../lib/model_configs.json#L338) says
   *"enable_thinking forced true"*).

These describe **two different layers**. The manifest note refers to the **server
launch flag** — `--chat-template-kwargs '{"enable_thinking":true}'` in the production
launchd plist ([com.mac-llm-lab.llama-server.plist:106-107](../../llama-server/launchd/com.mac-llm-lab.llama-server.plist#L106-L107))
and the Sweep-2 variant plist ([com.mac-llm-lab.llama-server-qwen35.plist:78-79](../../llama-server/launchd/com.mac-llm-lab.llama-server-qwen35.plist#L78-L79)).
The route note refers to a **per-request override**. The whole question is which wins.

---

## 2. Determination: claw-16 under the harness = thinking OFF

Five independent lines of evidence, in descending order of decisiveness.

### 2.1 Live `/apply-template` probe — the per-request override wins (DECISIVE)

The skeptical objection worth taking seriously: precedence ("per-request false beats
launch-time true") was documented only for **Qwen3.6 / tier-64**, and upstream llama.cpp
reports `enable_thinking=false` being *ignored* on **Qwen3.5** specifically
([llama.cpp#20182](https://github.com/ggml-org/llama.cpp/issues/20182),
[#20409](https://github.com/ggml-org/llama.cpp/issues/20409)), with the
`--chat-template-kwargs enable_thinking` mechanism **deprecated** in recent builds. So
this was verified directly, on **this lab's pinned build (`b1-5594d13`)** and the
**exact tier-16 GGUF** (`Qwen3.5-9B-IQ4_XS.gguf`), via the weight-independent
`/apply-template` endpoint, on a throwaway server launched with
`--chat-template-kwargs '{"enable_thinking":true}'` to mirror production:

| Request | Rendered assistant prefill (tail) | Meaning |
|---|---|---|
| default (launch `true` only) | `…assistant\n<think>\n` | open think → **ON** |
| per-request `enable_thinking:false` | `…assistant\n<think>\n\n</think>\n\n` | closed empty think → **OFF** |
| per-request `enable_thinking:true` | `…assistant\n<think>\n` | open think → ON |

The per-request `enable_thinking:false` flips the render from an **open** `<think>` to a
**closed, empty** `<think></think>` prefill — i.e. it **overrides the launch-time
`true`** and suppresses reasoning. Verified identically on the live tier-64 Qwen3.6
server. The deprecation warning in the server log
(`Setting 'enable_thinking' via --chat-template-kwargs is deprecated…`) concerns the
**launch-flag syntax**, not the per-request body kwarg, which still functions on this
build. This is the same behavior the repo's own acceptance test asserts
([templates/verify-template.sh:133-142](../../llama-server/templates/verify-template.sh#L133-L142)).

**Conclusion:** the harness route's `enable_thinking:false` is honored on Qwen3.5/tier-16
and wins over the server's launch default. The upstream "ignored on Qwen3.5" reports do
not reproduce on this build.

### 2.2 Routing — every recorded run used the thinking-off route

All **748** `run_summary.json` records under
[host/test/.claw-runtime/](../.claw-runtime/) carry `model_id: "anthropic/claw-llama"`
(`model_id` = the `clawModel` passed to `runClaw`, per `buildRunSummary` in
[lib/claw.js](../lib/claw.js)). The only places `CLAW_MODEL_OVERRIDE` is ever set are two
attic sweep scripts, and they point exclusively at `anthropic/claw-llama` /
`anthropic/claw-llama-deterministic` — **both** of which also pin
`enable_thinking:false` ([litellm-config.yaml:84-101](../../litellm/litellm-config.yaml#L84-L101)).
No harness path uses the thinking-on production route. The Sprint 1.19/1.20 tier-16
sweeps were driven by `run-overnight-screen.sh` with `CLAW_MODEL_OVERRIDE` unset → the
`tier.js` default route.

### 2.3 Empirical output — no reasoning, terse turns

Across the on-disk session transcripts there are **0 `<think>` blocks** and no
`thinking`/`reasoning` block type in **15,521** message blocks; per-turn output is terse
(bridge `output_tokens` median 62, p90 186, max 277). Consistent with thinking-off.
(*Weight this as corroboration, not proof — see 2.4.*)

### 2.4 Grammar — a partial, not total, backstop

`claw.gbnf` defines `prose-char ::= [^<] | "<" [^t]`
([grammars/claw.gbnf](../../llama-server/grammars/claw.gbnf)), so the model can never
**spontaneously generate** a fresh `<think>` opener (the `<t…` prefix is reserved for
`<tool_call>`). This is why §2.3's "no `<think>`" is **corroboration, not independent
proof** — a stray reasoning block is grammar-blocked regardless of the thinking setting.
Note the limit precisely: the grammar blocks an *unprompted* `<think>`, but it does **not**
block reasoning when the *template prefills* an open `<think>\n` (the model can emit
reasoning prose then `</think>`, both grammar-legal). So the load-bearing suppressor under
the harness is the route override of §2.1, not the grammar.

### 2.5 Documentary corroboration

[QWEN3.6-MODEL-REPORT.md](base/QWEN3.6-MODEL-REPORT.md) ("the model never emits a
`<think>` block on the claw path"); production plist FUTURE-MODEL HINT
([:85-88](../../llama-server/launchd/com.mac-llm-lab.llama-server.plist#L85-L88)) — "the
per-request override wins against the server-side default"; setup guide
[§2](OPENCODE-QWEN36-SETUP-GUIDE.md).

---

## 3. Parity decision: both OFF

Recorded per [OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) §0 (pre-registered
default: "both OFF unless claw-16 is proven ON"). claw-16 is proven **OFF** under the
harness (§2), so the default stands. Rationale:

1. **Faithful to what the A/B actually runs.** The harness is the unit of comparison
   (plan §0b); claw-16-harness is thinking-off, so both-off is the apples-to-apples
   choice and keeps thinking-mode in the "held constant" column of the plan §1 boundary
   table.
2. **OpenCode-16 de-risked by off.** OpenCode uses native `<tool_call>` parsing
   with **no `claw.gbnf` backstop**. Thinking-on lets a `<think>`/prose prefix reach the
   peg-native parser → the "naked-XML freeze" (setup guide §2,
   [opencode#24316](https://github.com/anomalyco/opencode/issues/24316),
   [llama.cpp#20260](https://github.com/ggml-org/llama.cpp/issues/20260)). Both upstream
   reports are **OPEN as of 2026-06** and mechanistically sound, but both are filed against
   the **35B-A3B (tier-64)**; whether the tier-16 9B shares the same `root ::= tool-call`
   peg-native grammar is **unverified** and is #018's empirical question (its AC #3:
   "naked-XML freeze absent or mitigated"). Either way, thinking-off pre-emptively removes
   the dominant prefix trigger, so off is not a handicap imposed on B — it matches A and
   de-risks B regardless of how that question resolves.
3. **Non-inferiority framing** (plan §0a): equalizing thinking-mode credits a delta to
   the on-trial bundle (LiteLLM + grammar + system-prompt + tool-path), not to a
   thinking-mode mismatch.

*Alternative considered — "production-faithful both-ON":* run claw-16 via the
`anthropic/claw` route (thinking-on, §4) and OpenCode-16 thinking-on. **Not adopted:**
it diverges from the pre-registered plan, and thinking-on for OpenCode would first require
confirming the tier-16 9B is not subject to the naked-XML freeze (#018; open upstream on the
35B-A3B, unverified on the 9B). Available as a future sub-variant if a production-faithful
verdict is later wanted (plan §5 "one-flag A/B sub-variant").

---

## 4. Production-vs-harness skew (acceptance criterion #4)

The skew is real and **behavioral**, not just a label:

| | Route | Per-request override | Effective template | Reasoning emitted? |
|---|---|---|---|---|
| **Harness** claw-16 | `anthropic/claw-llama` | `enable_thinking:false` | closed `<think></think>` prefill | **No** (thinking OFF) |
| **Production** claw-16 | `anthropic/claw` | *(none)* | open `<think>\n` prefill (launch `true`) | **Yes** (thinking ON) |

Production claw-code invokes `claw --model anthropic/claw`
([client/claw-code/repl:3](../../../client/claw-code/repl#L3)); that route has **no**
`extra_body` override ([litellm-config.yaml:53-57](../../litellm/litellm-config.yaml#L53-L57)),
so it inherits the launch-time `enable_thinking:true`. Per §2.1 the template then prefills
an **open** `<think>\n`, and (per §2.4) the grammar does **not** suppress reasoning that
continues from a prefilled think block. So **production tier-16 reasons; the harness does
not.**

**Implications:**
- The tier-16 A/B (and all historical tier-16 sweep numbers, which ran through the harness
  route) characterize the **thinking-off** configuration. They do **not** describe
  production claw-16's thinking-on behavior. Adoption verdicts from this A/B are valid for
  "claw serving bundle, thinking-off" vs OpenCode — which is the controlled comparison the
  plan intends — but should not be read as "this is how production claw-16 performs."
- The manifest tier-16 *"enable_thinking forced true"* notes ([:177](../lib/model_configs.json#L177),
  [:338](../lib/model_configs.json#L338)) describe the **server launch flag** and therefore
  **mislabel the recorded N=8 numbers**, which were produced thinking-**off** via the route.
  The current production entry [:384](../lib/model_configs.json#L384) wisely carries
  neither phrase. Annotated (see commit) rather than rewritten, to preserve provenance.

---

## 5. OpenCode-16 flag to match (consumed by #018)

Launch OpenCode's dedicated tier-16 `llama-server` with:

```
--chat-template-kwargs '{"enable_thinking":false}'
```

Verified to yield the closed `<think></think>` thinking-off prefill on
`Qwen3.5-9B-IQ4_XS.gguf` + build `b1-5594d13` (§2.1).

**Mandatory verification in #018 (load-bearing for B in a way it is not for A):** OpenCode
has **no `claw.gbnf` backstop**, so it relies entirely on the template suppression actually
working. #018 must assert it on OpenCode's own server before trusting numbers:

```
curl -s http://<opencode-llama-host>/apply-template \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"chat_template_kwargs":{"enable_thinking":false}}' \
| python3 -c 'import sys,json;p=json.load(sys.stdin)["prompt"];assert p.rstrip().endswith("</think>"),p[-80:];print("OK: thinking-off prefill")'
```

Caveats for #018:
- The `--chat-template-kwargs` **launch-flag syntax is deprecated** on this build (warning
  only; still functional). If a future build honors the deprecation and ignores the flag,
  switch to `--reasoning off` (startup-only on current builds) — re-run the probe above to
  confirm.
- Use the corrected Qwen3.5 Jinja template (the tier-16 analogue of issue #004's
  `qwen36-corrected.jinja`); confirm it preserves the `enable_thinking` branch.

---

## 6. Evidence index

- Routing: [lib/tier.js:13](../lib/tier.js#L13), [lib/runAgent.js:266](../lib/runAgent.js#L266),
  [lib/claw.js:86](../lib/claw.js#L86)
- Route overrides: [litellm-config.yaml:53-57](../../litellm/litellm-config.yaml#L53-L57)
  (production, no override), [:71-78](../../litellm/litellm-config.yaml#L71-L78) /
  [:84-101](../../litellm/litellm-config.yaml#L84-L101) (test routes, `false`)
- Launch flag: [com.mac-llm-lab.llama-server.plist:85-88,106-107](../../llama-server/launchd/com.mac-llm-lab.llama-server.plist#L85-L107),
  [com.mac-llm-lab.llama-server-qwen35.plist:78-79](../../llama-server/launchd/com.mac-llm-lab.llama-server-qwen35.plist#L78-L79)
- Server flag requirement: [models.conf:15,33-36](../../llama-server/models.conf#L33-L36)
- Grammar: [grammars/claw.gbnf](../../llama-server/grammars/claw.gbnf)
- Template AC test: [templates/verify-template.sh:133-142](../../llama-server/templates/verify-template.sh#L133-L142)
- Production client: [client/claw-code/repl:3](../../../client/claw-code/repl#L3)
- Live probe build: `b1-5594d13` (Apple M5 Max), model `Qwen3.5-9B-IQ4_XS.gguf`
- Empirical artifacts: [host/test/.claw-runtime/](../.claw-runtime/) — 748 `run_summary.json`
  (all `anthropic/claw-llama`), 0 `<think>` across transcripts, `_bridge.jsonl`
- Upstream caveats (do **not** reproduce on this build): [llama.cpp#20182](https://github.com/ggml-org/llama.cpp/issues/20182),
  [#20409](https://github.com/ggml-org/llama.cpp/issues/20409),
  [#20260](https://github.com/ggml-org/llama.cpp/issues/20260),
  [opencode#24316](https://github.com/anomalyco/opencode/issues/24316)

> Local artifacts under `.claw-runtime/` are gitignored; paths are recorded for
> reproducibility, not as committed files.
