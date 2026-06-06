# Corrected Qwen3.5/3.6 chat templates (Config B / OpenCode serving)

Vendored chat templates for the **OpenCode-dedicated `llama-server`s**
(Config B in the [OpenCode A/B plan](../../test/docs/OPENCODE-HARNESS-AB-PLAN.md)),
one per tier. Each fixes its stock template's mishandling of a request whose
**system message is not first** — the request shape OpenCode produces — while
leaving the native `<tool_call>` emission and `enable_thinking` behaviour
byte-identical to stock.

- **tier-64** `qwen36-corrected.jinja` (#004) — stock silently *drops* the system message.
- **tier-16** `qwen35-corrected.jinja` (#018) — stock *raises HTTP 500*; opposite
  `enable_thinking` default polarity.

Issues: [#004](../../../issues/004-vendor-corrected-jinja-template.md) (tier-64),
[#018](../../../issues/018-tier16-opencode-serving.md) (tier-16).
Consumed by [#005](../../../issues/005-second-llama-server-config.md) via
`--chat-template-file host/llama-server/templates/qwen3{5,6}-corrected.jinja`.

> This is the **Config B** template only. The production **claw** path (Config A,
> `:11435`) reads the template **embedded in the GGUF** and is unaffected — claw is
> not served with `--chat-template-file`. Don't point the claw launchd plist at
> this file.

| | tier-64 | tier-16 |
|---|---|---|
| Vendored template | [`qwen36-corrected.jinja`](qwen36-corrected.jinja) | [`qwen35-corrected.jinja`](qwen35-corrected.jinja) |
| Reproducible verifier | [`verify-template.sh`](verify-template.sh) | same (`TEMPLATE=…/qwen35-corrected.jinja`) |
| Applies to | `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` | `Qwen3.5-9B-IQ4_XS.gguf` |
| Issue | [#004](../../../issues/004-vendor-corrected-jinja-template.md) | [#018](../../../issues/018-tier16-opencode-serving.md) |
| Served by | `opencode-server` (`:11436`) | `OPENCODE_TIER=16 opencode-server` (`:11437`) |

> **Tier-16 (`qwen35-corrected.jinja`, #018):** same two-region system-not-first fix, but
> the 9B fails *harder* than the 35B — stock **HTTP 500**s (`raise_exception('System message
> must be at the beginning.')`) where the 35B silently dropped. The 9B's `enable_thinking`
> branch also has the **opposite default polarity** (closed-think default), preserved
> byte-for-byte. Which of the 3 tier-64 fixes the 9B actually needed + the live tool-call
> validation: [docs/TOOL-CALL-VALIDATION-TIER16.md](../docs/TOOL-CALL-VALIDATION-TIER16.md).

---

## Provenance

- **Base:** the `tokenizer.chat_template` metadata embedded in
  `~/.ollama/gguf/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` (the unsloth GGUF named in
  [`models.conf`](../models.conf) tier-64). Its trailing comment self-identifies as
  the *"Unsloth fixes - developer role, tool calling"* variant. Extracted with
  `llama.cpp/gguf-py` (`GGUFReader.get_field('tokenizer.chat_template')`).
- **Engine of record:** the lab's `llama-server` build `version: 1 (5594d13)`
  (`~/src/llama.cpp/build/bin/llama-server`, libggml 0.10.0) — the same commit the
  [llama-server README §9](../README.md) pins. The template is rendered by this
  build's **minja** engine, not Python Jinja2; all verification below runs through
  it via `/apply-template` (template formatting only, no inference).
- **Why a corrected template is needed at all:** flagged by the spike sources in the
  [setup guide](../../test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md) (`[aayushgarg]`,
  `[njannasch]`) — *"Stock Qwen3.5/3.6 template returns HTTP 500 when a request's
  system message isn't strictly first."* We took that as a claim to validate on our
  hardware, not to trust blind (see next section).

---

## The bug — characterised on our build (not assumed)

The stock template hoists a system message into the top block **only if it sits at
`messages[0]` (or `[1]`)**, and the main render loop **skips every `system`/
`developer` role**. So a system message anywhere else is never emitted.

What that produces depends on the engine/variant:

- **Community reports (upstream official template):** a hard **HTTP 500**.
- **Our build + this GGUF's embedded Unsloth variant:** **HTTP 200 but the system
  message is silently dropped** — arguably worse than a crash, since the agent's
  system prompt vanishes with no error. Reproduced via `/apply-template`:

  ```
  # request: [user "hi"], [system "SYSTEM_SENTINEL_42"], [user "2+2?"]
  STOCK     -> <|im_start|>user\nhi ... <|im_start|>user\n2+2? ...   # no system block
  CORRECTED -> <|im_start|>system\nSYSTEM_SENTINEL_42<|im_end|> ...  # preserved
  ```

  (`./verify-template.sh --diff` regenerates this side-by-side.)

Either way the conclusion is the same: **a system message not at the front is
mishandled**, and the corrected template must render it.

---

## The exact fix

Two regions changed; everything else is byte-identical to stock.

**1. System collection (was `messages[0]`/`[1]` only → now all, in order).**

```jinja
{#- STOCK #}
{%- set num_sys = 0 %}
{%- set merged_system = '' %}
{%- if messages[0].role == 'system' or messages[0].role == 'developer' %}
    {%- set first = render_content(messages[0].content, false, true)|trim %}
    {%- if messages|length > 1 and (messages[1].role == 'system' or messages[1].role == 'developer') %}
        {%- set merged_system = first + '\n' + second %}{# + num_sys=2 #}
    {%- else %}
        {%- set merged_system = first %}{# + num_sys=1 #}
    {%- endif %}
{%- endif %}

{#- CORRECTED #}
{%- set sys_ns = namespace(text='') %}
{%- for message in messages %}
    {%- if message.role == 'system' or message.role == 'developer' %}
        {%- set piece = render_content(message.content, false, true)|trim %}
        {%- if piece %}
            {%- if sys_ns.text %}{%- set sys_ns.text = sys_ns.text + '\n' + piece %}
            {%- else %}{%- set sys_ns.text = piece %}{%- endif %}
        {%- endif %}
    {%- endif %}
{%- endfor %}
{%- set merged_system = sys_ns.text %}
```

**2. Main-loop role guard (drop the now-redundant index gate).**

```jinja
{#- STOCK     #}  {%- if loop.index0 >= num_sys and message.role != "system" and message.role != "developer" %}
{#- CORRECTED #}  {%- if message.role != "system" and message.role != "developer" %}
```

Rationale:

- Every system/developer message is collected wherever it appears and merged into
  the single top system block — preserving Qwen's *one-system-block-at-the-top*
  architecture (system content is fused with the tools block when tools are
  present, exactly as stock does) while losing nothing regardless of position.
- The `\n` separator matches stock's two-leading-system merge, so the
  **system-first output is unchanged** (verified — see regression check).
- `num_sys` existed only to skip the already-hoisted leading system messages; the
  `message.role != "system"` guard already excludes them, so the index gate is
  removed with it.

**Deliberately untouched** (so native tool calling and thinking are preserved
exactly): the `# Tools` block, the `<tool_call>\n<function=NAME>\n<parameter=...>`
emission format the peg-native parser expects, the `<tool_response>` handling, and
the `add_generation_prompt` / `enable_thinking` block.

---

## Verify (on our hardware)

```sh
./host/llama-server/templates/verify-template.sh          # assert; exits non-zero on any fail
./host/llama-server/templates/verify-template.sh --diff   # stock vs corrected, side by side
```

It boots a throwaway `llama-server` on **port 18080** (its own port — it refuses to
run if 18080 is busy and **never touches the production claw server on :11435**),
renders a battery of shapes through `/apply-template`, and tears the server down on
exit. Template rendering is weight-independent, so it loads the smallest GGUF on
disk as a vehicle; override with `MODEL=`, `PORT=`, `TEMPLATE=`.

Last run (this commit) — **13 passed, 0 failed**:

- system-not-first → HTTP 200, system content preserved, `<|im_start|>system` emitted
- tools + system-not-first → HTTP 200, system content preserved
- native tool call → `<tool_call>` / `<function=write_file>` / `<parameter=path>` / `<tool_response>`
- `enable_thinking:false` → `<think>\n\n</think>` prefill; `:true` → open `<think>` prefill
- regression: system-first output unchanged

---

## Notes for #005 (serving) and #006 (tool-call validation)

- **#005 serving is implemented** — the second, OpenCode-dedicated `llama-server`
  (tier-64, `:11436`) is brought up/down by
  [`../scripts/opencode-server`](../scripts/opencode-server)
  (`start|stop|status|health|probe`; `install`/`uninstall` for a login-persistent
  launchd agent — [`com.mac-llm-lab.opencode-server.plist`](../launchd/com.mac-llm-lab.opencode-server.plist)).
  `opencode-server probe` re-asserts the system-not-first fix and the closed
  `<think></think>` thinking-off prefill against the live server via `/apply-template`.
- Launch with `--jinja --chat-template-file .../qwen36-corrected.jinja` and **no
  `claw.gbnf`** (Config B uses native `<tool_call>` parsing, not the grammar).
- Thinking-off is set at serve time via `--chat-template-kwargs '{"enable_thinking":false}'`
  (the template reads `enable_thinking`). This build prints a deprecation notice
  preferring `--reasoning off`; the kwarg still works. The setup guide's flag is
  retained for parity with its recipe — revisit if a later build drops the kwarg.
- The args-type regression [llama.cpp#20198] (`tool_calls.arguments` object vs
  string) is a **parser** concern, not a template one — validate it in #006 against
  live generation; it's out of scope for this template.
  **DONE (#006):** on `b1-5594d13` `arguments` is a **STRING** (OpenAI-strict), no
  shim needed; and native `tool_calls[]` parse cleanly (no naked-XML freeze) in both
  streaming and non-streaming. See
  [docs/TOOL-CALL-VALIDATION.md](../docs/TOOL-CALL-VALIDATION.md) +
  [scripts/validate-tool-calls.sh](../scripts/validate-tool-calls.sh).
