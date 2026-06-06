# Native tool-call validation — Qwen3.6-35B-A3B on llama.cpp (tier-64, Config B)

**Issue [#006](../../../issues/006-tool-call-validation-tier64.md) · 2026-06-06 ·
build `b1-5594d13` · server `:11436` ([#005](../../../issues/005-second-llama-server-config.md))**

> This is the single biggest empirical risk in the OpenCode A/B effort: prove
> native tool-calls fire **end-to-end** on this model + OS **before** any
> container/runner work depends on it. Re-runnable proof lives in
> [`../scripts/validate-tool-calls.sh`](../scripts/validate-tool-calls.sh); this
> doc records the verdict, the transcripts, and two findings that need human eyes.

## Verdict — acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Raw `/v1/chat/completions` + tool spec → **parsed `tool_calls[]`**, not raw XML in `content` | ✅ **PASS** — 39/39 live generations |
| 2 | No prose-before-`<tool_call>` parse failure (thinking-off effective) | ✅ **PASS** — and stronger than required (see Finding 2) |
| 3 | `#20198` arguments-type documented; shim applied or confirmed unnecessary | ✅ **STRING** (OpenAI-strict) → **no shim needed** (Finding 1) |
| 4 | Reproducible transcript / command recorded | ✅ this doc + the committed script |

**Bottom line: tool-calls fire natively and cleanly. The effort is de-risked on
the model+engine+OS axis.** Two findings below need human judgment (HITL) — one
is good news that *weakens a stated premise*, so it's flagged rather than buried.

## How to reproduce

```sh
host/llama-server/scripts/opencode-server start          # boot :11436 (#005)
host/llama-server/scripts/validate-tool-calls.sh         # battery, both modes
#   REPEATS=3 …                                           # more samples/prompt
#   SAVE_DIR=/tmp/tc006 …                                 # dump every raw response
```

The script POSTs **real generations** (not `/apply-template` — that only checks
template formatting, which [#004](../../../issues/004-vendor-corrected-jinja-template.md)
already covered) with a 3-tool spec and a forcing prompt, in **both** non-streaming
and streaming (`stream:true`) mode, ×`REPEATS`. It sends **no sampler overrides**
(uses the server's tuned tier-64 sampler) so a flaky freeze can't hide behind
temp=0. Exit 0 iff every run emits a parsed `tool_calls[]` with no XML leak.

Single hand-check (the request shape OpenCode sends):

```sh
curl -s http://127.0.0.1:11436/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"opencode","tool_choice":"auto",
       "messages":[{"role":"user","content":"Create a file x.py containing print(1)"}],
       "tools":[{"type":"function","function":{"name":"write_file",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},
           "content":{"type":"string"}},"required":["path","content"]}}}]}' \
  | python3 -m json.tool
```

## Transcripts

**Non-streaming** — `content` empty, call **parsed** into `tool_calls[]`,
`finish_reason: tool_calls`, `arguments` is a **JSON string**:

```json
{ "choices": [ { "finish_reason": "tool_calls", "index": 0, "message": {
  "role": "assistant", "content": "",
  "tool_calls": [ { "type": "function",
    "function": { "name": "write_file",
                  "arguments": "{\"path\":\"x.py\",\"content\":\"print(1)\"}" },
    "id": "kSGVQ…" } ] } } ],
  "system_fingerprint": "b1-5594d13", "object": "chat.completion",
  "usage": { "completion_tokens": 42, "prompt_tokens": 509, "total_tokens": 551 } }
```

**Streaming** (`stream:true`, the OpenCode path) — the call arrives as
OpenAI-standard `delta.tool_calls[]` fragments, **never** as `<tool_call>` text in
`delta.content`; arguments reassemble to a valid JSON string:

```
data: {"choices":[{"delta":{"role":"assistant","content":null},...}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"Gazd…","type":"function","function":{"name":"write_file","arguments":"{"}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"path\":\""}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"x"}}]}}]}        # …".py", "\"", "," …
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}
data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}},...]}
data: [DONE]
```

## Finding 1 — `arguments` is a STRING (no `#20198` regression) → no shim

On build `b1-5594d13`, `tool_calls[].function.arguments` is a **JSON-encoded
string** (`"{\"path\":\"x.py\",…}"`), exactly as the OpenAI spec requires — both
non-streaming and reassembled-from-stream. The `[llama.cpp#20198]` regression
(arguments as a bare JSON **object**, which breaks strict `@ai-sdk/openai-compatible`
clients) **does not occur here.** Verified on every one of the 39 generations.

**Decision: no compatibility shim is required** for Config B's runner. If a future
llama.cpp bump regresses this, the validator will catch it (it asserts the type and
prints `arguments type … object  <-- #20198`), and the shim would be a one-liner in
`runOpenCode` (`JSON.stringify` arguments when `typeof !== 'string'`). Not needed today.

## Finding 2 — the "naked-XML freeze" did NOT reproduce on this build (HITL)

The setup guide frames thinking-off as **required to make tool-calling work at
all**: *"the 35B-A3B `peg-native` parser is `root ::= tool-call`; any prose before
`<tool_call>` fails to parse → the naked-XML freeze"* ([llama.cpp#20260],
[opencode#24316]). **We could not reproduce that failure on build `b1-5594d13`.**

A counterfactual sweep deliberately tried to trigger it:

| Condition | Runs | Result |
|---|---|---|
| Thinking **OFF**, simple forcing prompt (the production config) | 18 | clean parsed call, every time |
| Thinking **ON** (per-request `chat_template_kwargs.enable_thinking:true`) | 7 | reasoning → `reasoning_content`; call still **parsed** |
| Thinking **OFF** + prompt explicitly begging for step-by-step **prose** | 6 | model wrote prose in `content`, **then still emitted a parsed `tool_calls[]`** |
| Thinking **ON** + prose-begging prompt (worst case for a `root::=tool-call` parser) | 8 | reasoning up to ~5k chars **and** prose in `content`; call still **parsed** |

In **0 of 39** runs did raw `<tool_call>`/`<function=>` XML land in `content`
(streaming or not). With thinking ON, the server's reasoning parser (`thinking = 1`
in the launch log) extracts the `<think>` block into `reasoning_content`; with a
prose-demanding prompt the model emits prose into `content` and the parser **still
recovers the trailing `<tool_call>`**. So on this build the parser tolerates
preceding text — it is **not** the strict `root ::= tool-call` the guide describes.

**Why this matters / what to do with it (for the human):**

- **Thinking-off is not load-bearing for tool-call *parsing* on `b1-5594d13`.** It
  stays in the config anyway — but for the *other, still-valid* reason recorded in
  [plan §0](../../test/docs/OPENCODE-HARNESS-AB-PLAN.md): **claw-parity.** claw forces
  thinking-off via the LiteLLM route, so Config B matching it keeps the A/B
  apples-to-apples. That justification is untouched; only the guide's *mechanism*
  claim ("required or tools break") is stronger than this build warrants.
- **Suggested doc hygiene:** soften fix #2 in
  [OPENCODE-QWEN36-SETUP-GUIDE.md](../../test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md)
  from "required-to-function" → "required for claw-parity; also avoids the
  `#20260` freeze reported on other builds, which did not reproduce on `b1-5594d13`."
  Flagged, not yet applied — it's a judgment call about how much to trust one build.
- **Risk register:** the effort's stated #1 empirical risk (naked-XML freeze) is
  **substantially retired** for this model+engine+OS+build.

### Honest boundary of this claim

This validates the **server + model + build** directly (`curl` → `:11436`),
single-turn, across streaming and non-streaming. It does **not** yet exercise
**OpenCode the client** end-to-end: the community freeze reports are specifically
*via OpenCode*, whose real traffic differs in ways I did not reproduce here —
multi-turn histories carrying prior `tool`/`tool_response` messages, OpenCode's own
tool schemas, and its client-side stream parsing. Those are lower-risk now (the
server clearly emits clean OpenAI-shaped calls) but **not zero**, and they close
when OpenCode actually drives this server in the container/runner work
([#007](../../../issues/) onward). A multi-turn tool-response round-trip is the
obvious next probe if we want to shrink that gap before then.

## Operational notes surfaced en route

- **Per-request `chat_template_kwargs` overrides the launch default** — sending
  `{"enable_thinking":true}` on a single request flips thinking on (confirmed:
  `reasoning_content` appears). Useful control surface; our config still pins it off
  at launch.
- **Thinking-off ≠ empty `content`.** Thinking-off suppresses the `<think>` block,
  *not* the model's willingness to write prose in `content` when a prompt demands it.
  The happy-path agentic prompts yield empty `content`; a "explain then act" prompt
  yields prose `content` **plus** a parsed call. Tool parsing survives either way on
  this build, but don't assume "thinking-off guarantees content is empty before the call."
- **A throwaway probe harness lied once:** piping a captured response through
  `echo "$resp" | python3` made `echo` interpret the JSON's escaped `\n`, producing a
  bogus "Invalid control character" parse error that looked like a server bug. It
  wasn't — the saved raw bytes were valid JSON. The committed validator avoids this
  by writing `curl -o` straight to a file and parsing the file. Noted so nobody
  re-trips it.

---

*39 asserted live generations: 18 via the committed validator (6 non-stream-only +
12 both-mode) + 21 in the counterfactual sweep (14 non-stream + 7 streaming). An
earlier 5-call probe that the server answered correctly was discarded only because
the throwaway harness mis-parsed it (see last bullet). Raw responses re-dumpable via
`SAVE_DIR=…`.*
