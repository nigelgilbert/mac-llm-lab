# Cheap-sidecar → OpenCode port — investigation handoff

## RESULT (2026-06-10) — the prompt ports; it recovers most of the tier-16 gap

Sweep: 32 tasks × N=8 × {`opencode-a+git`, `opencode-a+prompt`} at tier-16,
appended to a copy of the #019 registry
(`.claw-runtime/run_registry.sidecar-port-20260610.jsonl`, claw rows reused via
`SKIP_PHASE_A`); §0a statistic throughout (paired bootstrap by `test_id`,
B=10000, seed `0xc0ffee`, 90% CI); harness `212546f`; both gates PASS; zero
harness errors in the new arms (claw's 17 `context_overflow` rows are the known
#019 attrition).

| comparison | aggregate Δ | 90% CI | reading |
|---|---|---|---|
| `opencode-a` − `claw-rig` (replication) | −7.7pp | [−13.1, −2.5] | #019 reproduced exactly in this registry |
| `opencode-a+git` − `claw-rig` (control) | −8.1pp | [−13.9, −2.3] | git-init alone is a wash (≈ bare oc) |
| **`opencode-a+prompt` − `opencode-a+git`** | **+6.6pp** | **[+3.1, +10.2]** | **prompt effect real — CI excludes 0** |
| `opencode-a+prompt` − `claw-rig` (canonical) | −1.5pp | [−6.4, +3.5] | §0a.1 NOT MET by 1.4pp on the CI bound |
| `opencode-a+prompt` − `claw-rig` (normalized: claw overflow=fail) | +0.8pp | [−3.9, +5.9] | non-inferior under the #019 sensitivity rule |

Wall-clock: `+prompt` median 20.8s vs claw 24.4s (0.85×, §0a.2 MET). Iteration
parity: both medians 8.

**The §4 pre-registered expectation (`+prompt ≈ 0`, "the moat is the harness
loop") is FALSIFIED.** Planting claw's `system-prompt.md` verbatim as a
git-committed `AGENTS.md` recovers ~6.2pp of the −7.7pp deficit — the tier-16
claw advantage is mostly the *discipline prompt*, not the agent loop. The
residual vs claw is −1.5pp [−6.4, +3.5]: parity is inside the CI, but the
pre-registered §0a.1 retire bar is missed by 1.4pp under canonical eligibility
(and met under the normalized rule that scores claw's context-overflows as
fails, exactly as #019 reported its own sensitivity). Formal verdict at the
pre-registered rule: **KEEP@16 stands, narrowly**; the honest summary is
"+prompt brings tier-16 OpenCode to statistical parity with claw, with the
decision rule left just unresolved at N=8". A deciding follow-up (if wanted):
re-sweep both `+prompt` and claw tier-16 at larger N to shrink the ±5pp CI, or
pre-register the normalized rule and call it.

Per-task notes: gains concentrate in discipline-shaped tasks (`ini-parser`
+37.5pp vs control, `cascading-bugs`, `eight-functions`); `lru-cache` is
+prompt's best task vs claw (+46.4pp); worst vs claw −48.2pp (`book-store`,
which also collapsed under `+git` — 1/8 vs claw 5/8 — the one place git-init
itself may interfere; at N=8 this is a flag, not a finding). Scope caveats
carry over verbatim from OPENCODE-AB-FINAL-REPORT.md §6 (tier-16 = capability
proxy on 64 GB silicon, thinking-off both arms, split provenance).

---

**Status: wiring COMPLETE + smoke GREEN (2026-06-09); tier-16 sweep launched.**
Probe phase findings (§1, §2) stand. The `+prompt` arm is wired per §4's design
default — plus an `opencode-a+git` control arm so the prompt effect is isolated
from the git-init confound. Single-cell smoke (deep-equal, tier-16): PASS; row
emitted with `config_id=opencode-a+prompt`,
`model_config_id=...-opencode-prompt`; OpenCode's own session snapshot contains
the committed `AGENTS.md` and its project row records `/workspace` as vcs=git
(the FINDING-2 injection precondition reproduced in the wired path — note the
system prompt itself is NOT persisted in OpenCode's sqlite, so per-run injection
evidence is state-level, behavioral proof remains the §2 strong-model oracle).
Lab left clean (claw `:11435` green, oc servers stopped by the driver's trap).

Wiring delta vs the §4 plan (all landed):
- `lib/config.js` — `VALID_CONFIGS` += `opencode-a+git`, `opencode-a+prompt`;
  `isOpenCodeConfig()`; `modelConfigIdFor` maps `+prompt`→`...-opencode-prompt`
  (tier-16 only) and `+git`→ the tier's plain `...-opencode-a` fingerprint
  (serving byte-identical; git-init is harness provenance carried by config_id).
- `lib/runAgent.js` — `seedWorkspaceGit()` after seed write/before runner:
  git init + (for `+prompt`) plant `system-prompt.md` verbatim as `AGENTS.md` +
  `git add -A` + commit (`--allow-empty`), every step fail-loud. `selectRunner`
  routes all opencode configs to `runOpenCode`.
- `lib/schemas/run_registry.schema.json` — config_id enum extended.
- `lib/model_configs.json` — new `qwen35-9b-...-opencode-prompt` entry
  (prompt_pack_version `pp01+agentsmd-v1`).
- `run-config-ab.sh` — Phase B loops `OC_CONFIGS` (default `opencode-a`); `git`
  added to the docker:cli `apk add` (the §4 gotcha); gate runs per arm with
  `--treatment`.
- `config-ab-verdict.mjs` / `config-ab-pairing-check.mjs` /
  `config-ab-normalized-ci.mjs` — `--treatment/--baseline` flags (defaults
  unchanged); verdict prints a mechanism-comparison line (not §0a RETIRE/KEEP)
  when baseline ≠ claw-rig.
- `__tests__/lib/config-selector.test.js` — extended; all lib unit tests green
  (137 pass).

This continues the OpenCode-vs-claw A/B (parent: [OPENCODE-AB-FINAL-REPORT.md](OPENCODE-AB-FINAL-REPORT.md)). Prior verdict:
**RETIRE@tier-64** (oc +3.1pp), **KEEP@tier-16** (oc −7.7pp; normalized −5.5pp).

---

## 0. The question that started this

User hypothesis: *"could we port a tool-coherence sidecar (the cheap parts of the claw
stack — `claw.gbnf` grammar + `system-prompt.md` discipline) onto tier-16 OpenCode and
rectify the −7.7pp delta? Some sidecar elements seem highly effective on the weak tier."*

Decision taken (user picked **option A**): drop the dead grammar idea if probes kill it,
**verify the `+prompt` injection path, then wire `opencode-a+prompt` and sweep tier-16**
under the same pre-registered §0a rule. Frame correction already agreed: tier-16 is a
**capability proxy** (weak 9B on 64 GB silicon), not a memory-tier test, and the effect
is **model-strength-dependent**, not memory-dependent.

---

## 1. FINDING 1 — the grammar is NOT portable (it would be a NULL arm). Do not run it.

**Mechanism.** The claw server runs `--grammar-file claw.gbnf` **without** `--jinja`
(plist: grammar + `--chat-template-kwargs` only) — it constrains *raw text* and
LiteLLM/claw parse the `<tool_call>` wrapper downstream. The OpenCode server runs
`--jinja` + corrected template and relies on **llama.cpp's own** tool-call parsing.
Stacking a global `--grammar-file` on the `--jinja` path is **silently overridden
whenever the request carries `tools`** — and agentic traffic carries `tools` every turn.

**Evidence (reproducible).** Added an opt-in flag + two probes:
- [scripts/opencode-toolcall-probe.py](../../llama-server/scripts/opencode-toolcall-probe.py)
  — parse-safety: grammar-on does NOT break `tool_calls` (GREEN, baseline + grammar-on
  both 4/4: name ok, `arguments` is a JSON string (#20198 ok), no `<tool_call>` leak).
- [scripts/opencode-grammar-active-probe.py](../../llama-server/scripts/opencode-grammar-active-probe.py)
  — activity discriminator using `claw.gbnf` line 44 (`prose-char ::= [^<] | "<" [^t]`,
  i.e. `<t` is illegal in prose). Result, grammar-on:
  - G1 **no tools**: asked to echo `<title>` → model emitted `<Hello/>` (the `<t` was
    masked) ⇒ grammar **active**.
  - G2 **with tools**: same request → model echoed `<title>` faithfully ⇒ grammar
    **inactive**. Self-controlling: G2 proves the model wants to echo it, G1 proves the
    grammar stops it.

**Implication.** `opencode-a` already has native tool-call constraint (that's why the
weak 9B parsed clean tool calls); `claw.gbnf` is both redundant and unreachable there.
The tier-16 gap is **not** the wrapping. → Report refinement (no verdict number changes):
`opencode-a` is *"llama.cpp's native tools-grammar instead of `claw.gbnf`"*, not
*"no grammar"*. The flag (`OPENCODE_USE_GRAMMAR` in `opencode-server`) is kept only as
evidence; default-off = boot byte-identical to today's `opencode-a`.

---

## 2. FINDING 2 — `+prompt` injection requires a GIT-ROOTED workspace

OpenCode (v**1.16.2**, image `opencode:local`) runs headless as
`opencode run "<prompt>"` in `/workspace`. Its rules/instructions discovery **no-ops in a
bare directory**. Verified model-independently using the **strong tier-64 35B-A3B as an
oracle** (a capable model reliably obeys a clear `AGENTS.md` rule *iff* it's injected):

AGENTS.md rule = *"MANDATORY: your FIRST action must be to create `PROOF_<token>.txt`."*
Run a trivial task, check whether `PROOF` appears.

| mechanism (strong model, tier-64) | PROOF created? | injected? |
|---|---|---|
| bare `/workspace` + project `AGENTS.md` | no | ✗ |
| bare `/workspace` + `instructions:["/workspace/AGENTS.md"]` in config | no | ✗ |
| bare `/workspace` + global `~/.config/opencode/AGENTS.md` mount | no | ✗ |
| **`git init`+commit `AGENTS.md` in `/workspace`** | **YES** | **✓** |

**Root cause:** OpenCode establishes a "project" via a git root; rules discovery
no-ops without `.git` (docs describe project `AGENTS.md` as the one *"committed to Git"*).

**This corrected an earlier wrong read:** a tier-16 action-sentinel "failed," which I
first attributed to the weak model ignoring discipline (thesis-consistent) — but it was a
**bare workspace**, so nothing was injected. The strong-model oracle caught it before a
silent null arm got wired. (Capture instruments — a mock OpenAI endpoint and a logging
proxy — both failed for **environment** reasons: mock caused an OpenCode init-stall;
macOS firewall blocks the container→host Python port `:18099` while `:11437`/llama-server
is allowed. Neither is informative about injection; the behavioral oracle is.)

---

## 3. Artifacts created this session (all uncommitted)

| path | what | keep? |
|---|---|---|
| `host/llama-server/scripts/opencode-server` (MODIFIED) | opt-in `OPENCODE_USE_GRAMMAR` → `--grammar-file` splice (bash-3.2-safe `${arr[@]+...}` guard). Default unset = unchanged boot. | evidence; optional revert |
| `host/llama-server/scripts/opencode-toolcall-probe.py` (NEW) | tool_calls parse-safety gate | yes (evidence) |
| `host/llama-server/scripts/opencode-grammar-active-probe.py` (NEW) | grammar-active discriminator (`<t` test) | yes (evidence) |

`/tmp` capture scaffolding (mock server, proxy, throwaway configs) was deleted.

---

## 4. REMAINING WORK — wire `opencode-a+prompt` + sweep tier-16

**Design default (decided — user delegated; proceed on this, don't block):** to isolate
the *prompt* effect from the *git-init* confound, git-init **both** arms — compare
`opencode-a+prompt` (git WS + `AGENTS.md` = discipline) against an `opencode-a` control
that is **also** git-init'd but with no/empty `AGENTS.md`, with `claw-rig` as the
headline baseline. This means **re-running an `opencode-a(git)` control**, not reusing
the original bare-workspace `opencode-a` rows (those conflate git-init with the prompt —
see §6.3). The arm is **prompt-only**: the original "grammar+prompt hybrid" collapses to
prompt-only because the grammar is a null arm (§1) — do **not** add a grammar arm.

**Wiring steps (file pointers):**
1. `host/test/lib/config.js` — add `'opencode-a+prompt'` to `VALID_CONFIGS` (line 24);
   extend `modelConfigIdFor` (currently returns undefined unless `configId==='opencode-a'`,
   line 72) to map `opencode-a+prompt` → a new tier-16 fingerprint.
2. `host/test/lib/runAgent.js` — `selectRunner` (~line 282): route `opencode-a+prompt`
   to `runOpenCode` (same runner as `opencode-a`).
3. `host/test/lib/schemas/run_registry.schema.json` — add `"opencode-a+prompt"` to the
   `config_id` enum (lines 66-68) **or rows fail schema validation**.
4. `host/test/lib/model_configs.json` — clone the `...-opencode-a` tier-16 entry (line
   499) to `...-opencode-prompt` with a note documenting the AGENTS.md discipline.
5. **Workspace seeding hook (the crux) — CONFIRMED location:** in
   `host/test/lib/runAgent.js`, **after the seedFiles write (line ~173) and before the
   runner call (line ~186)** — i.e. just after `workspace.reset()` (line 170) so the
   plant survives the reset. Guard it: `if (resolveConfigId(env) === 'opencode-a+prompt')
   { git init; write AGENTS.md ← system-prompt.md; git add -A && git commit }`. The
   workspace is `workspace.WORKSPACE` = `/workspace`, which is the host `H`
   (`HOST_WORKSPACE`) the OpenCode sibling also bind-mounts — so the plant is visible to
   OpenCode. The **pass oracle is blind to it**: it only runs the post-script and checks
   `post.status === 0` (runAgent.js ~204-217, ~250-255) — no directory enumeration, so a
   stray `.git/` + `AGENTS.md` do not affect pass/fail. (All verified read-only by a
   pickup agent.)
   - **GOTCHA (must handle):** in Phase B the cell loop runs inside the `docker:cli`
     container whose `apk add` installs `nodejs docker-cli-compose coreutils` but **NOT
     `git`** (`run-config-ab.sh` ~324). So either (a) add `git` to that `apk add` for the
     +prompt phase, or (b) FIRST TEST whether a bare `.git` dir is enough for OpenCode's
     project detection — try `mkdir <ws>/.git` or `git init` *without* a commit (my
     verified positive used full `git init`+commit; the minimal trigger is untested and
     would avoid the git-binary dependency entirely). Read `system-prompt.md` at runtime
     via `fs.readFileSync` of its absolute repo path (the repo is path-matched-mounted
     `-v $REPO_DIR:$REPO_DIR`, so it resolves inside the container).
6. `host/test/run-config-ab.sh` — add a Phase C (`CONFIG=opencode-a+prompt`) mirroring
   Phase B (lines 263-348). Reuse `SKIP_PHASE_A=1` + `REGISTRY_OUT` to pair against
   existing claw rows without re-burning Phase A (see §0b gotchas).
7. Sweep tier-16 (N=8, the 32 A/B tasks) then render:
   `config-ab-verdict.mjs <reg> --tier 16` with treatment `opencode-a+prompt` vs
   baselines `claw-rig` and `opencode-a`.

**Expectation to set:** prior `CLAUDE.md`-plant gave ≈ +0 at tier-32
(recorded in TODO-GRAMMAR-PRELUDE.md, deleted 2026-06-10; in git history). If `+prompt`
also lands ≈0 at tier-16, the tier-16 claw advantage lives in the **harness loop / tool
path** (not a droppable-in scaffold) → KEEP@16 is robust and there is **no cheap
retire-the-bridge win at tier-16**. That is itself the answer to the user's question.

---

## 5. Repro / gotchas (read before touching anything)

- **Servers:** `OPENCODE_TIER=16|64 host/llama-server/scripts/opencode-server start|stop`.
  tier-16 → `:11437` (9B), tier-64 → `:11436` (35B-A3B). **claw prod `:11435` — never
  touch** (assert green on exit). GGUF `~/.ollama/gguf/Qwen3.5-9B-IQ4_XS.gguf`; build
  `b1-5594d13`.
- **One OpenCode run:** `WORKSPACE=<dir> OPENCODE_CONFIG_JSON=./opencode.16.json docker
  compose -f client/opencode/docker-compose.yml run --rm -T --name <n> opencode opencode
  run "<prompt>"`. `models.dev` is black-holed in the compose (expected `ConnectionRefused`
  in logs, non-fatal).
- **Strong-model injection oracle:** MANDATORY "create `PROOF_<token>.txt` first" in
  `AGENTS.md`, **git-init the workspace**, run a trivial task tier-64, check the file.
- **Host has no `gtimeout`/`timeout`** → guard hangs with a `( sleep N; docker rm -f
  <name> ) &` watchdog (subshell sleep is fine; top-level `sleep` is blocked in this CLI).
- **macOS default bash is 3.2** → array-under-`set -u` needs `${arr[@]+"${arr[@]}"}`.
- **§0a rule:** RETIRE iff 90% paired-bootstrap CI lower bound on (treatment − claw)
  pass-rate > **−5pp** AND treatment median wall ≤ **1.5×** claw. Paired by `test_id`,
  B=10000, seed `0xc0ffee` (`lib/paired_bootstrap.js`). Per-tier independent.
- **`run-config-ab.sh` footguns** (memory): don't set `REGISTRY_OUT` outside
  `.claw-runtime/` (split-file bug → gate sees claw=0); `PHASE_SWAP=1` downs prod claw
  (HITL); `SKIP_PHASE_A=1` reuses existing claw rows (needs an existing `REGISTRY_OUT`).
- **SECRET:** `host/litellm/.env` is untracked — never commit/expose.
- A/B task set is **32** runAgent tasks (not 35); latency/prose-quality/tool-discipline
  are claw-bridge probes that emit no registry row.

---

## 6. Considerations & judgment calls (recorded; no user decision pending)

1. **Prompt-only, not "grammar+prompt".** The original hybrid idea is dead on the grammar
   side (§1 — overridden under `tools`, and redundant with OpenCode's native tools-grammar).
   The only live lever is the discipline prompt. Don't re-introduce a grammar arm.
2. **A null result is the deliverable, not a failure — pre-register it.** Prior
   `CLAUDE.md`-plant ≈ +0 at tier-32. If `opencode-a+prompt` ≈ `opencode-a(git)` at
   tier-16, that *confirms* the tier-16 claw advantage is the **harness loop / tool path**,
   not the cheap scaffold → KEEP@16 robust, **no cheap retire-the-bridge win at tier-16**.
   That is a clean answer to the user's question. Write it up as such; don't treat ≈0 as
   "the experiment didn't work."
3. **`git init` may change agent behavior beyond rules discovery** (OpenCode can use git for
   snapshots/checkpoints/diffs). That is the whole reason to git-init **both** arms (§4
   default). If anyone reuses the original bare `opencode-a` rows instead, the delta
   conflates git-init with the prompt — flag it loudly and treat it as a lower-confidence
   comparison.
4. **`system-prompt.md` was authored for claw's Anthropic tool path** (rules like "one tool
   call per response", "trust tool results — don't re-call", "ACT, do not narrate"). On
   OpenCode's native OpenAI tool path some rules may be redundant or mismatched (OpenCode
   may batch tools / handle results differently). Default: **plant it verbatim** as
   `AGENTS.md` (cleanest apples-to-apples "port" of the exact claw artifact). If you adapt
   it instead, record the diff — an adapted prompt is a different, non-comparable treatment.
5. **Carry the parent report's scope caveats** into any writeup of the result: tier-16 is a
   **capability proxy** on 64 GB (not a memory-tier test), **thinking-off** both arms, split
   provenance — identical to [OPENCODE-AB-FINAL-REPORT.md](OPENCODE-AB-FINAL-REPORT.md) §6.
6. **Feed Finding 1 back into the final report even if the sweep never runs.** Refine §2/§5
   wording: `opencode-a` is *"llama.cpp's native tools-grammar instead of `claw.gbnf`"*, not
   *"no grammar"*; and add that the grammar scaffold is **non-portable** to the `--jinja`
   path (silently overridden under `tools`). No verdict numbers change; it sharpens the
   mechanism claim and is a standalone, low-effort improvement.
7. **Artifacts are uncommitted by design.** The `OPENCODE_USE_GRAMMAR` flag in
   `opencode-server`, the two probe scripts, and this doc. Reasonable bundle to commit as a
   documented negative result (grammar non-portable) + the injection-mechanism finding. The
   flag itself can alternatively be reverted (grammar is dead) keeping only the two probes +
   this doc as evidence — either is fine; not blocking.
8. **Cost of the sweep:** one tier-16 run of the 32 A/B tasks × N=8 × the arms you choose
   (≥ `opencode-a+prompt` and `opencode-a(git)` control; `claw-rig` rows can be reused via
   `SKIP_PHASE_A` if a clean tier-16 claw registry exists). Budget ~ the tier-16 capability
   proxy is cheap (9B); the gate is `config-ab-verdict.mjs` + the §0a rule.
