# Plan — claw-rig vs OpenCode, **same model** (config (a) / apples-to-apples)

**Goal (adoption):** can I retire the bespoke claw serving stack (LiteLLM bridge +
`claw.gbnf` + `system-prompt.md` + sampler/template tuning) and run *the same local
model* under vanilla OpenCode **without losing eval performance** — on this Mac, at
tier-64 and tier-16?

The eval harness (`runAgent` + registry + reporter) is the durable asset and is
reused unchanged. The **claw serving/prompt/grammar stack is the thing on trial for
retirement.** OpenCode is a challenger run *under the same harness*.

The two setups, end-to-end:

- **Config A — `claw-rig`:** ClawCode → LiteLLM Anthropic bridge → tuned
  `llama-server` (llama.cpp), `claw.gbnf` grammar, `system-prompt.md`.
- **Config B — `opencode-(a)`:** OpenCode → a **second, OpenCode-dedicated
  `llama-server`** (llama.cpp, own port), **same GGUF**, corrected Jinja template,
  **no** `claw.gbnf`, native `<tool_call>` parsing. No LiteLLM. See
  [OPENCODE-QWEN36-SETUP-GUIDE.md](OPENCODE-QWEN36-SETUP-GUIDE.md).

---

## 0. Decisions locked (grill session 2026-06-05)

- **Driver = adoption** ("can I retire the claw rig?"), not "is my engineering
  justified" and not a reviewer-facing benchmark. Bundle-level attribution is fine.
- **Config (a)-only.** Same tuned GGUF per tier, **llama.cpp on both sides**. The
  earlier (a)/(b) ladder is collapsed; **(b) [OpenCode's own default model] is
  deferred**, available later if we want the "fully off-the-shelf" verdict.
- **Tiers: 64 + 16.**
  - tier-64: native on this M5 Max / 64 GB. Incumbent **Qwen3.6-35B-A3B
    UD-Q4_K_XL** (~21 GB). Clean.
  - tier-16: **Qwen3.5-9B IQ4_XS** (~5 GB). **Capability proxy only** — running
    `TIER=16` on a 64 GB box loads the small model with ~50 GB headroom; it does
    **not** reproduce 16 GB memory pressure / KV eviction. A faithful 16 GB verdict
    needs real 16 GB silicon.
- **Thinking parity:**
  - tier-64 — **both OFF**, CONFIRMED. claw forces it via the `claw-llama` LiteLLM
    route (`extra_body.chat_template_kwargs.enable_thinking=false`,
    [litellm-config.yaml](../../litellm/litellm-config.yaml); see
    `model_configs.json:475` "thinking suppressed via litellm route"). OpenCode
    forces it via `--chat-template-kwargs '{"enable_thinking":false}'`. The setup
    guide's "matches claw's suppression" claim is vindicated.
  - tier-16 — **RESOLVED 2026-06-06 (issue #017): both OFF.** See
    [TIER16-THINKING-PARITY-DECISION.md](TIER16-THINKING-PARITY-DECISION.md). claw-16
    runs thinking **OFF** under the harness: it routes through `anthropic/claw-llama`
    (`enable_thinking:false`), and a live `/apply-template` probe on the tier-16 GGUF
    (`Qwen3.5-9B-IQ4_XS`) + pinned build `b1-5594d13` confirms the per-request override
    **wins** over the server's launch-time `true` (closed `<think></think>` prefill).
    The manifest "enable_thinking forced true" note describes the *server launch flag*,
    which the route overrides — no real contradiction. OpenCode-16 matches with
    `--chat-template-kwargs '{"enable_thinking":false}'` (consumed by #018; verify via
    `/apply-template` since OpenCode has no grammar backstop). **Skew noted:**
    *production* claw-16 (`anthropic/claw` route, no override) is thinking-**ON** — the
    A/B characterizes the harness (off) mode, not production.

---

## 0a. Decision rule — pre-registered

Adoption is a stopping decision; commit the rule **before** seeing data.

- **Framing: non-inferiority** (not superiority). We're deciding whether OpenCode is
  *not meaningfully worse*, because retiring the LiteLLM bridge + `claw.gbnf` +
  `system-prompt.md` has standalone maintenance value.
- **Unit of analysis:** per-task pass-probability, **paired by task**, **bootstrapped
  over the 35 tasks** (not 280 pooled Bernoulli trials — tasks aren't iid). Seeds
  can't be matched across harnesses (different tokenization/prompt), so **N=8**
  samples each cell's stochastic pass-distribution per task.
- **Rule — retire the claw rig at a tier iff:**
  1. lower bound of the **90% paired-bootstrap CI** on `(OpenCode − claw)` aggregate
     pass-rate is **> −5 pp** (non-inferiority margin = 5 pp), **and**
  2. OpenCode **median wall-clock ≤ 1.5×** claw's.
- Report **per-task deltas** alongside the aggregate so one regressed task is visible,
  not averaged away.
- The 5 pp margin is the one subjective knob: "pass-rate I'll trade to kill the
  bespoke serving stack." Evaluated **per tier independently** (a tier-64 retire and
  a tier-16 keep is a valid outcome).

---

## 0b. Measurement & fairness

- **Pass oracle = `/workspace` post-script only** (`post.status === 0`),
  config-agnostic. **Drop `agent.code === 0` from the pass definition** on both sides
  (it's a claw-ism; `opencode run` exit semantics are unconfirmed and could false-fail
  a correct workspace). Keep the agent exit code as **recorded telemetry** + a
  "crashed before finishing" diagnostic — not a pass gate. Any pure-`agent.code` test
  needs a workspace oracle added before it's A/B-eligible.
- **Consequence — re-measure claw, don't reuse history:** historical claw registry
  rows used the `agent.code===0 && post.status===0` oracle. The claw side of the A/B
  must be **re-run fresh in the same phase-swap sweep under the workspace-only
  oracle** — never compared against old rows. The phase-swap driver re-runs both
  sides anyway, so this is free; just don't shortcut it with cached claw numbers.
- **Budget: equalize wall-clock only.** `runAgent` already passes the same
  `timeoutMs` to any `runner`, so per-task wall-clock is equal by construction. **No
  imposed iteration cap** on either side — iteration count is native-harness behavior;
  **record it, don't gate on it** (KISS).
- **Eligibility — context overflow (UPDATED 2026-06-10, issue #002, Option A,
  lab owner):** a mid-run llama-server context overflow is re-typed
  `terminal_status: 'harness_error'` / `passed: null` and **excluded from
  pass-rate denominators** (`paired_bootstrap.isEligible`), restoring the
  Sprint-1.20 Layer-A taxonomy for the opencode-native stack. Oracle: the
  server's own n_ctx-exceeded log line in the run's per-run capture window
  (pinned against build `b1-5594d13`; mechanism + attribution rule in
  [OPENCODE-SERVER-TIMINGS.md](OPENCODE-SERVER-TIMINGS.md) §"#002
  context-overflow detection"). **This is a semantics change relative to the
  published oc verdicts** — OPENCODE-AB-TIER16-VERDICT counted overflows as
  eligible model failures ("0 oc `harness_error`"); see the dated note there.
  Two caveats: (1) re-typing rides `OPENCODE_SERVER_TIMINGS=1` — flag-off
  sweeps have no capture window and keep the old overflow-counts-as-eligible
  semantics, so comparison sweeps must run flag-on; (2) future published
  comparisons are opencode-vs-opencode only (claw-rig rows replication-only),
  so the convention is symmetric by construction.

---

## 1. Framing — weights-fixed harness isolation

This is **not** the "product comparison, model differs" experiment the first draft
described. With (a), **the model and the inference engine are held constant**
(same GGUF, llama.cpp both sides). The only moving parts are:

> agent harness (ClawCode vs OpenCode) + serving *config*
> (LiteLLM + `claw.gbnf` + `system-prompt.md`  vs  corrected-Jinja +
> native-tool_call + OpenCode defaults).

So a delta is attributable to **that bundle of engineering around the model** — not
to the model. This is a tighter isolation than a product bake-off; it still is *not*
"pure harness" (the serving config genuinely differs), so describe wins as
"claw serving+harness bundle vs OpenCode serving+harness bundle, weights fixed."

**Exact boundary — what's on trial vs held constant:**

| On trial (removed in B → OpenCode's native path) | Held constant (kept both sides) |
|---|---|
| LiteLLM Anthropic bridge | GGUF weights |
| `claw.gbnf` grammar | llama.cpp engine + `context_limit` |
| `system-prompt.md` | **tuned sampler** (`v6-antiloop` / `v7-noreppen`, mirrored onto OpenCode's `llama-server`) |
| Anthropic-API tool path (→ native `<tool_call>`) | thinking-off |

Clean statement: *"Same model, same engine, same sampler, same thinking-mode — does
OpenCode's native harness + tool-path match claw's bridge + grammar + system-prompt?"*
The sampler is held constant because adopting OpenCode doesn't force abandoning it
(you set temp/top-p/penalties on OpenCode's `llama-server` directly); equalizing it
makes a delta credit exactly the four on-trial components, not sampler luck.

Consequences:

- **OpenCode does NOT go through LiteLLM.** It talks to its own `llama-server`
  directly via the OpenAI-compatible endpoint.
- Same engine both sides means **server prompt/decode timings are available on both
  sides** (revises §4.4 — server-decode split is *recoverable* for B, not lost).

---

## 2. The model decision — DECIDED: (a)

**(a) Same GGUF, OpenCode's native path.** Holds weights + engine constant; the
comparison is "my serving/prompt/grammar engineering vs OpenCode's defaults" with
the model fixed. Chosen because the investment under evaluation is the harness/serving
stack, not the model.

**(b) OpenCode's default model — DEFERRED.** Truly out-of-box, but answers a
different question (can I go fully off-the-shelf *including* the model?). Not in v1.
Revisit only if (a) shows OpenCode is competitive and we then want the model-too
verdict.

---

## 3. What each config brings (the thing being compared)

| Layer | `claw-rig` (Config A) | `opencode-(a)` (Config B) |
|---|---|---|
| Agent | ClawCode (Rust) | OpenCode (Go) |
| Engine | llama.cpp (`llama-server`) | llama.cpp (`llama-server`) — **same** |
| Model | tuned tier GGUF | **same tuned tier GGUF** |
| Serving path | `llama-server` → LiteLLM bridge → claw | 2nd `llama-server` → OpenCode (no bridge) |
| Tool path | `claw.gbnf` constrained wrapper | native `<tool_call>` → OpenAI `tool_calls` |
| Template | stock Qwen template | corrected Jinja (HTTP-500 fix) |
| Thinking | off (64) / matched (16) | off (64) / matched (16) |
| Prompt | `system-prompt.md` | OpenCode defaults |

Config A is the engineering investment on trial. Config B is "the same weights, but
served and driven the way vanilla OpenCode would."

---

## 4. Work items

### 4.1 Container — `client/opencode/`
- `Dockerfile` mirroring `client/claw-code/Dockerfile`, simpler (OpenCode ships
  prebuilt binaries — no Rust build stage). Pin version via build arg.
- `docker-compose.yml`: mount `${WORKSPACE}:/workspace`; point OpenCode at the
  **second `llama-server`** via `host.docker.internal:<port>/v1` (per setup guide,
  e.g. `:8080/v1`). No `ANTHROPIC_BASE_URL` plumbing on this side.
- `opencode.json` (provider = `@ai-sdk/openai-compatible`, model id) baked or mounted
  — see setup guide.
- Confirm headless one-shot: `opencode run "<prompt>"` exits with a clean code and
  doesn't orphan its client-server process in the container.

### 4.2 Model staging + memory
- Config A: existing claw `llama-server` launchd + tier GGUF (unchanged).
- Config B: a **second `llama-server`** on its own port, same GGUF, OpenCode-serving
  config (corrected template, no grammar, thinking-off).
- **Memory topology — DECIDED: phase-swap, both tiers.** One `llama-server` up at a
  time, `trap`-restore like `run-backend-ab.sh`. Each side runs with full memory
  headroom (faithful to an adoption wall-clock); avoids the tier-64 ~50 GB
  co-residence pressure confound; rejects the single-shared-server option because it
  would run claw on the corrected template (no longer production claw).
- **Consequence:** no per-task A/B interleave — all tasks under A, swap, all under B.
  Phase-time effects (thermal drift, background load) are confounded with config;
  mitigate by interleaving at the suite/repeat level if precision later matters.

### 4.3 Runner — `lib/opencode.js`
- **Injection mechanism (corrected from first draft):** the suite does NOT branch on
  a `CONFIG` env *inside test files*. Post-#5, tests call
  [`runAgent`](../lib/runAgent.js) with a pluggable `runner` (default `defaultRunner`
  → `runClaw`). Add `runOpenCode` and have a process-level selector (env, e.g.
  `CONFIG=opencode`) choose which runner `defaultRunner` resolves to — test files
  stay byte-identical.
- `runOpenCode({ prompt, signal, timeoutMs }) → RunnerResult` must match the `Runner`
  typedef and the `{ code, stdout, stderr, elapsedMs, runDir, terminal_status }`
  shape, reusing the combined-signal + **timeout-resolves-not-rejects** pattern.
- **Critical integration cost:** `runAgent` emits the `runDir` diagnostic the
  registry reporter needs to write a row. `runOpenCode` MUST produce a `runDir` with
  the sidecar artifacts the reporter expects, or **no registry row is written**. This
  — not pass/fail plumbing — is the real work (see §4.4/§4.5).

### 4.4 Telemetry — REVISED (B is llama.cpp too)
- **Still gone for B:** the `_bridge.jsonl` LiteLLM time-window join (`lib/claw.js`)
  — OpenCode bypasses LiteLLM.
- **But server prompt/decode split is NOT lost:** B's `llama-server` emits the same
  `timings.prompt_ms` / `timings.predicted_ms`. Recoverable via the server's own
  logs or a thin logging proxy. So **server-decode timing can be rendered for BOTH**
  (revises §4.7) if we choose to build it — deferred for the outcome-only v1.
- **OpenCode iteration/token counts:** from OpenCode's own session log (dir + JSON
  shape unknown — inspect). Build a transcript adapter normalizing into the existing
  iteration schema; tool-name → workspace-mutation map (analog of
  `WORKSPACE_CHANGED_BY_TOOL`).
- **Cross-config metrics that hold:** pass-rate, wall-clock, total tokens, tool-call
  / iteration count, and (if built) server prompt/decode split.

### 4.5 Registry — `config_id` + model identity
- Add `config_id` (`claw-rig` | `opencode-a`) in `lib/run_row.js` + the schema
  (`additionalProperties:false` today) **before** collecting data.
- **DECIDED: new `model_config_id` per (tier, B).** Same `model_id` / quant /
  `context_limit` / `sampler_config_id` as the tier (weights + sampler held constant),
  but a note describing B's actual serving: corrected Jinja, no grammar, native
  tool-call, thinking-off via `chat-template-kwargs`. Two new manifest entries.
  Rationale: `model_config_id` is the serving-provenance fingerprint; reusing claw's
  would stamp B's rows with claw's litellm/grammar note (false). `config_id` is the
  coarse bundle label; the two are complementary. Every row stays self-documenting.

### 4.6 Driver + suites
- `run-config-ab.sh` modeled on `run-backend-ab.sh`: Phase A = claw-rig, Phase B =
  opencode-(a), with `llama-server` swap + `trap`-restore to production.
- **v1 task set = the 35 `runAgent`-based Family A/B tasks.** Exclude the 4
  `frontier/` tasks: they bypass `runAgent` and call `runClaw` + `writeAssertionResult`
  directly (claw-wired), so they need porting before they can run under OpenCode.
- Reuse those 35 unchanged (assertions check `/workspace` via post-scripts,
  config-agnostic). Audit for any hidden claw-output assumptions.

### 4.7 Report template
- Provenance line per side: model (same) + serving config + prompt.
- Headline pass-rate, then wall-clock; token/iteration counts secondary.
- Server prompt/decode split is **renderable for both** if built (revised); until
  then, omit rather than imply.

---

## 5. Known gotchas / open questions
- **tier-16 thinking parity** (§0) — **RESOLVED** (issue #017): both OFF;
  [TIER16-THINKING-PARITY-DECISION.md](TIER16-THINKING-PARITY-DECISION.md). Harness
  claw-16 = thinking-off (verified by live `/apply-template` probe); production claw-16
  = thinking-on (skew noted). OpenCode-16 flag: `--chat-template-kwargs
  '{"enable_thinking":false}'`, verified on OpenCode's server in #018.
- OpenCode session-log **location + format** unknown → blocks the §4.4 adapter.
- `opencode run` exit-code + process-cleanup semantics unconfirmed → verify before
  wiring `runOpenCode`.
- Corrected Qwen3.6 Jinja template must be sourced + vendored in-repo (setup guide).
- llama.cpp **args-type regression #20198** (`tool_calls.arguments` object vs string)
  — verify the local build before trusting B's tool calls.
- **Do NOT equalize system prompts / tool schemas** — that asymmetry is part of what
  each side *is*, intentionally in scope. (The model, engine, and thinking-mode ARE
  equalized; the harness/serving-config is not.)

---

## 6. Suggested sequencing
1. Stand up the second `llama-server` + `opencode.json` + container at **tier-64**;
   validate tool-calls actually work end-to-end (the three setup-guide fixes).
2. `runOpenCode` (outcome-only, produces `runDir`+sidecar) → first tier-64 pass-rate
   / wall-clock. Cheap, high-signal: answers the core retire-the-rig question.
3. Registry `config_id` dimension → make the numbers groupable.
4. **tier-16**: resolve thinking parity, stage the 9B second server, repeat.
5. Transcript adapter → iteration/token parity; optional server-decode proxy.
6. `run-config-ab.sh` + report template with provenance discipline.
