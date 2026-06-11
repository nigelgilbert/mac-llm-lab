# Tier-16 OpenCode serving + tool-call validation — Qwen3.5-9B on llama.cpp

**Issue [#018](../../../issues/018-tier16-opencode-serving.md) · 2026-06-06 ·
build `b1-5594d13` · server `:11437` · model `Qwen3.5-9B-IQ4_XS`**

> Tier-16 analogue of the tier-64 work ([#005](../../../issues/005-second-llama-server-config.md)
> serving, [#006](../../../issues/006-tool-call-validation-tier64.md) validation). The
> central question: **the three tier-64 (35B-A3B) serving fixes may not all transfer to the
> 9B — which are actually needed, determined empirically, not assumed.** Plus the
> load-bearing re-test: the "naked-XML freeze" is filed upstream against the *35B-A3B*;
> whether the *9B* shares it was UNVERIFIED. Re-runnable proof lives in
> [`../scripts/validate-tool-calls.sh`](../scripts/validate-tool-calls.sh) (shared with #006,
> pointed at `:11437 MODEL=opencode-16`) and
> [`../templates/verify-template.sh`](../templates/verify-template.sh).

## Verdict — which tier-64 fixes the 9B needed

| Tier-64 fix | Needed on 9B? | Evidence |
|---|---|---|
| **A. Corrected Jinja template** (system-not-first) — #004 | ✅ **YES, and harder** | Stock 9B **HTTP 500**s on system-not-first (vs the 35B's silent HTTP-200 drop). Vendored [`qwen35-corrected.jinja`](../templates/qwen35-corrected.jinja). |
| **B. Thinking-off flag** `--chat-template-kwargs '{"enable_thinking":false}'` — #017 | ✅ **YES** | Without it the 9B serves thinking-**ON** (llama.cpp injects `enable_thinking=true`). With it, plain requests render closed `<think></think>`. |
| **C. Generous `-n`** (avoid tool-call arg truncation) | ➖ **Carried over unchanged** | `-n 8192` (same as tier-64); no 9B-specific tuning needed, no truncation in 18/18 runs. |
| **D. Naked-XML freeze absent + `arguments` STRING** (#006 finding) | ✅ **Transfers** | 18/18 parsed `tool_calls[]`, no XML leak, `arguments` is a JSON STRING (no #20198 shim). The 9B is **not** subject to the freeze either. |
| **E. Sampler** | 🔀 **tier-16 values, differ from tier-64** | `TIER_16_*` from `models.conf` (temp 0.6 / top_p 0.95 / top_k 20 / repeat 1.1 / presence 0) — distinct from tier-64 (0.7 / 0.8 / 20 / 1.0 / 1.5). Same plumbing, different numbers. |

**Bottom line:** **2 of the 3 fixes (A template, B thinking-off) are required on the 9B;
the 3rd (C generous `-n`) carries over untouched.** The tier-64 tool-call result (D: clean
native parsing, no freeze, STRING args) **reproduces on the 9B.** Two 9B-specific wrinkles
worth knowing (below): the template failure is a hard 500 (not a silent drop), and the 9B's
`enable_thinking` branch has the **opposite default polarity** from the 35B.

## Acceptance criteria (issue #018)

| # | Criterion | Result |
|---|---|---|
| 1 | Second `llama-server` serves the tier-16 GGUF on its own port, green `/health`, sampler mirroring tier-16 | ✅ `:11437`, alias `opencode-16`, ctx 65536, `TIER_16_*` sampler (confirmed via `/props`) |
| 2 | Thinking mode set to match the #017 parity decision (both OFF) | ✅ launch-default **and** per-request `/apply-template` both render closed `<think></think>` |
| 3 | A raw request returns parsed `tool_calls[]` on the 9B (naked-XML freeze absent/mitigated) | ✅ **18/18** live generations, both modes, no XML leak |
| 4 | Which tier-64 fixes are/aren't needed for the 9B documented | ✅ this doc |

## How to reproduce

```sh
# 1. boot the tier-16 OpenCode server (claw :11435 + opencode-64 :11436 untouched)
OPENCODE_TIER=16 host/llama-server/scripts/opencode-server start      # green /health on :11437

# 2. assert the template fix + thinking-off (load-bearing — no claw.gbnf backstop)
OPENCODE_TIER=16 host/llama-server/scripts/opencode-server probe      # 3 checks, all PASS

# 3. live tool-call battery (3 prompts x 3 repeats x 2 modes = 18 generations)
BASE=http://127.0.0.1:11437 MODEL=opencode-16 REPEATS=3 SAVE_DIR=/tmp/tc018 \
  host/llama-server/scripts/validate-tool-calls.sh                    # RESULT: PASS (18/18)

# template-only re-verification (weight-independent, throwaway server on :18080):
TEMPLATE=host/llama-server/templates/qwen35-corrected.jinja \
  host/llama-server/templates/verify-template.sh                      # 13 passed, 0 failed
STOCK_GGUF=~/.ollama/gguf/Qwen3.5-9B-IQ4_XS.gguf \
TEMPLATE=host/llama-server/templates/qwen35-corrected.jinja \
  host/llama-server/templates/verify-template.sh --diff               # stock 500/empty vs corrected
```

## Detail A — the template fix is NEEDED, and the 9B fails harder than the 35B

The stock Qwen3.5-9B template (embedded `tokenizer.chat_template`, unsloth GGUF) hoists a
system message into the top block **only if it is `messages[0]`**; the main render loop then
contains an explicit guard:

```jinja
{%- elif message.role == "system" %}
    {%- if not loop.first %}
        {{- raise_exception('System message must be at the beginning.') }}
    {%- endif %}
```

So a system message anywhere but first **raises → HTTP 500**. Confirmed via `/apply-template`
on `b1-5594d13`:

```
# request: [user "hi"], [system "SYSTEM_SENTINEL_42"], [user "2+2?"]
STOCK     -> HTTP 500  "While executing CallExpression at line 85 … raise_exception(
                        'System message must be at the beginning.')"   # empty prompt
CORRECTED -> HTTP 200  <|im_start|>system\nSYSTEM_SENTINEL_42<|im_end|> … (preserved)
```

This is **strictly worse than the tier-64 35B**, whose unsloth variant returned HTTP 200 but
silently dropped the system message ([#004](../../../issues/004-vendor-corrected-jinja-template.md)).
OpenCode emits a system-not-first request shape, so the fix is required.

**The fix** ([`qwen35-corrected.jinja`](../templates/qwen35-corrected.jinja)) is the same
two-region surgical change as #004, adapted to the 9B's structure:
1. **System collection:** `messages[0]`-only hoist → collect *every* system message in order
   into the single top block (`sys_ns` loop).
2. **Main-loop system guard:** the `'System message must be at the beginning.'` raise becomes
   a **no-op skip** (system content is already hoisted above).

Everything else — the `# Tools` block, the `<tool_call>/<function=…>/<parameter=…>` emission
format, `<tool_response>` handling, and the `enable_thinking` branch — is **byte-identical to
stock**. Proven two ways:
- `verify-template.sh` → **13/13 ACs PASS** (system-not-first fixed, tool-call emission +
  thinking branches intact, system-first regression unchanged).
- A direct **byte-equivalence** check: corrected vs stock render **IDENTICAL** output on all
  six non-fix shapes (system-first, no-system, multi-turn tool-call, thinking on/off,
  tools+system-first). Only system-not-first behavior changed (500 → correct).

> The 9B stock has **no `developer` role** support (it `raise`s `'Unexpected message role'`);
> the 35B unsloth variant did. The corrected 9B template deliberately keeps the 9B's
> system-only scope (OpenCode's failure mode is *system*-not-first), so `qwen35-corrected.jinja`
> collects `system` only, where `qwen36-corrected.jinja` collects `system` + `developer`.
> This is the one intentional structural divergence between the two corrected templates.

## Detail B — thinking-off is NEEDED, with an inverted default polarity

The 9B's `add_generation_prompt` block has the **opposite** `enable_thinking` polarity from
the 35B:

| | Branch | Default (kwarg absent in template) |
|---|---|---|
| **35B (qwen36)** | open `<think>` unless `enable_thinking is false` | thinking **ON** |
| **9B (qwen35)** | closed `<think></think>` unless `enable_thinking is true` | thinking **OFF** |

But the *template default* is moot in practice: **llama.cpp injects `enable_thinking=true`**
into the render context when no kwarg is supplied. Measured directly — a throwaway 9B server
launched with **no** thinking flag renders a plain `/apply-template` request as an **OPEN**
`<think>\n` (thinking ON). So the 9B serves thinking-**ON** by default and the explicit flag
is required to flip it OFF.

With `--chat-template-kwargs '{"enable_thinking":false}'` at launch (per #017), the live
`:11437` server renders **closed** `<think>\n\n</think>\n\n` for:
- a **plain** request (no per-request kwargs — what real OpenCode traffic sends), **and**
- an explicit per-request `chat_template_kwargs.enable_thinking:false` (the #017 mandatory form).

Both asserted by `opencode-server probe` (checks 2 + 3) and the #017 one-liner. This is
**load-bearing**: OpenCode has no `claw.gbnf` backstop, so a stray prefilled `<think>` would
reach the native parser unguarded. The deprecation warning
(`Setting 'enable_thinking' via --chat-template-kwargs is deprecated`) concerns the launch-flag
syntax only — the kwarg still functions on `b1-5594d13`; switch to `--reasoning off` if a
future build drops it (re-run the probe to confirm).

The corrected template **preserves the 9B's own polarity** byte-for-byte — it does not import
the 35B's inverted branch.

## Detail D — naked-XML freeze does NOT reproduce on the 9B

The upstream "naked-XML freeze" reports ([llama.cpp#20260](https://github.com/ggml-org/llama.cpp/issues/20260),
[opencode#24316](https://github.com/anomalyco/opencode/issues/24316)) are filed against the
**35B-A3B**, and #006 already found they did not reproduce there on `b1-5594d13`. The 9B is a
**different model with a different (Qwen3.5) grammar**, so that result was not assumed to
transfer. It does:

- **18/18** live generations emitted a **parsed `tool_calls[]`** — never raw
  `<tool_call>`/`<function=>` XML in `content` (or `delta.content` when streaming).
- Both **non-streaming** and **streaming** (`stream:true`, the path OpenCode uses).
- Correct tool **selection** every run (write_file / read_file / run_command from a 3-tool spec).
- `finish_reason: tool_calls`, `content` clean (empty).
- `tool_calls[].function.arguments` is a **JSON STRING** (OpenAI-strict) in every run, both
  modes — the `[llama.cpp#20198]` object-vs-string regression does **not** occur. **No shim
  needed** for the tier-16 runner, same conclusion as tier-64.

Sent with the server's tuned tier-16 sampler (no overrides), so a lucky temp-0 pass can't mask
a flaky freeze. Raw responses dumpable via `SAVE_DIR=`.

### Honest boundary (same as #006)

This validates **server + model + build** directly (`curl` → `:11437`), single-turn, both
modes. It does **not** yet exercise **OpenCode the client** end-to-end (multi-turn histories
with prior `tool`/`tool_response` messages, OpenCode's own tool schemas, its client-side stream
parsing). Those are lower-risk now but not zero; they close when OpenCode actually drives this
server in the runner work.

## Standing caveat — tier-16 is a capability proxy on a 64 GB box

Per [plan §0](../../test/docs/OPENCODE-HARNESS-AB-PLAN.md), running `TIER=16` on this 64 GB M5
Max loads the 9B with ~50 GB headroom; it does **not** reproduce 16 GB memory pressure / KV
eviction. A faithful 16 GB verdict needs real 16 GB silicon. This doc characterizes the
**serving config + tool-call mechanics**, which are memory-pressure-independent.

## Evidence index

- Serving control: [`../scripts/opencode-server`](../scripts/opencode-server)
  (`OPENCODE_TIER=16`), launchd [`com.mac-llm-lab.opencode-server-16.plist`](../launchd/com.mac-llm-lab.opencode-server-16.plist)
- Template: [`../templates/qwen35-corrected.jinja`](../templates/qwen35-corrected.jinja),
  verifier [`../templates/verify-template.sh`](../templates/verify-template.sh)
- Validator: [`../scripts/validate-tool-calls.sh`](../scripts/validate-tool-calls.sh)
  (shared with #006; `BASE=:11437 MODEL=opencode-16`)
- Thinking parity: [TIER16-THINKING-PARITY-DECISION.md](../../test/docs/TIER16-THINKING-PARITY-DECISION.md) (#017)
- Tier-64 prior art: [TOOL-CALL-VALIDATION.md](TOOL-CALL-VALIDATION.md) (#006)
- Live build: `b1-5594d13` (Apple M5 Max), model `Qwen3.5-9B-IQ4_XS.gguf`
