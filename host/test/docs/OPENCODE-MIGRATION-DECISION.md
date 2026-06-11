# DECISION: migrate the coding stack to OpenCode at every memory tier

**Status: DECIDED 2026-06-10.** Supersedes the per-tier verdicts in
[OPENCODE-AB-FINAL-REPORT.md](OPENCODE-AB-FINAL-REPORT.md) as the operative
plan. Evidence lineage: that report (#013–#019), then
[OPENCODE-SIDECAR-PORT-HANDOFF.md](OPENCODE-SIDECAR-PORT-HANDOFF.md) (probes,
wiring, and the 2026-06-10 sweep). Decided interactively (grill session);
each decision below records its rationale.

---

## 1. The decision

Retire the claw stack (claw-code bridge + LiteLLM + `claw.gbnf` + claw
llama-server) at **all** tiers and rebuild the coding harness on **OpenCode +
the ported discipline prompt**, container-first. The rewrite optimizes, in
order: **usefulness as a daily driver, architectural simplicity, resource
footprint** — with the eval harness preserved as a first-class *secondary*
capability.

### Evidence basis (and the one override, stated plainly)

| finding | number | source |
|---|---|---|
| tier-64: oc superior | +3.1pp [+0.8,+6.3], 0.61× wall | #019 |
| tier-16: bare oc inferior | −7.7pp [−13.1,−2.5] | #019 |
| grammar is non-portable AND redundant | null arm (overridden under `tools`) | handoff §1 |
| git-init alone | −8.1pp vs claw ≈ bare oc (wash) | sidecar sweep |
| **prompt effect (vs +git control)** | **+6.6pp [+3.1,+10.2]** | sidecar sweep |
| oc+prompt vs claw @16 (canonical) | −1.5pp [−6.4,+3.5] — §0a.1 missed by 1.4pp | sidecar sweep |
| oc+prompt vs claw @16 (symmetric overflow scoring) | +0.8pp [−3.9,+5.9] — non-inferior | sidecar sweep |
| oc+prompt wall-clock @16 | 0.85× claw | sidecar sweep |

**Override record.** The pre-registered §0a.1 rule at tier-16 was narrowly NOT
MET. We proceed anyway on totality of evidence: (a) the residual delta is
statistically indistinguishable from zero; (b) the canonical eligibility rule
is asymmetric in claw's favor (claw `context_overflow` rows dropped from its
denominator; oc's equivalent budget exhaustion counts as timeout-fail) and the
symmetric variant is MET; (c) the isolated prompt effect is real and large;
(d) simplification and speed accrue regardless. **Further sampling was
declined as uninformative** — the CI width is dominated by between-task
heterogeneity (per-task deltas span ±48pp), which larger N barely shrinks.

**Mechanism conclusion (thesis-relevant).** The bespoke stack's advantage is
model-strength-dependent and decomposes into: grammar — redundant under
llama.cpp's native tools-grammar; harness loop — no measurable advantage
(pre-registered ≈0 expectation was *about the prompt*, falsified: the prompt
is the moat); discipline prompt — portable as ten lines of committed
markdown. Nothing irreplaceable remains.

---

## 2. Resolved decisions (grill ledger)

1. **Purpose: daily driver first.** "Useful" = you reach for it for real
   work on this Mac; the eval substrate is retained but secondary.
2. **Claw fate: tag + delete.** Tag `claw-stack-final` at the last
   claw-green commit, then remove `client/claw-code`, `host/litellm`,
   `claw.gbnf`, claw llama-server plists, `lib/claw.js` and claw branches
   from the working tree. Git history is the archive; reproducing the
   baseline = check out the tag.
3. **Evidence preservation: commit the canonical registries.** Copy the
   tier-64 final, tier-16 final, and sidecar-port registries (~1 MB JSONL
   total) into a tracked `host/test/docs/data/` dir in the gut commit —
   deliberate, scoped exception to the `.claw-runtime`-is-gitignored
   convention so every published number stays re-derivable.
4. **Container-first everywhere (architectural, user-set).** Containers are
   not friction: they pin dependencies and — essentially — sandbox the
   weak-tier models, which are untrustworthy over long sessions. The walls
   protect everything *outside* the designated workspace; the mounted
   workspace itself is fair game by design (git is the safety net there).
5. **Serving: daily tier resident + on-demand, wizard-provisioned.** One
   launchd-managed llama-server for the daily tier (this box: tier-64
   35B-A3B, `:11436`-family ports); other tiers boot on demand via
   `opencode-server` and stop after. The wizard sets this up and installs
   **only the opencode stack** going forward (steps 48-litellm/49-clawcode
   retired); wizard scope remains the coding harness.
6. **Prompt delivery: global, probe-gated.** Ship `system-prompt.md` via
   global OpenCode config (`~/.config/opencode/AGENTS.md` or
   `instructions[]`), installed by the wizard — no per-repo pollution.
   **GATE:** re-run the strong-model injection oracle in a *git-rooted*
   workspace first (FINDING 2 only proved these mechanisms no-op in bare
   dirs; in git projects they are untested). Fallback if it no-ops:
   committed per-repo `AGENTS.md`. Injection failure is silent — whatever
   mechanism wins, the wrapper should assert it (e.g. probe on install).
   **GATE RESOLVED 2026-06-10 (#001): global `~/.config/opencode/AGENTS.md`
   wins — wire-level capture confirms it injects (git-rooted AND bare; the
   FINDING-2 bare-dir no-op was a behavioral false negative), `instructions[]`
   also injects, control clean.**
   *Oracle caveat (instrument of record):* the behavioral PROOF oracle
   failed its known-positive validation — the 35B obeys a "MANDATORY first
   action" instruction only stochastically (~20–60%) — so behavioral
   obedience must never be used as an injection oracle. The replacement is
   a wire-level capture oracle (in-container 127.0.0.1 mock recording
   `/v1/chat/completions` request bodies), validated both ways
   (rule present when committed, absent in control); `oc probe` implements
   it. Recorded here from the migration suite's #001 ticket before the
   completed suite was removed per repo convention (full tickets + worklog
   remain in git history at the suite-closure commit).
7. **Tier-32: adopt by extrapolation + functional smoke.** Tier-32 is the
   same 9B at Q5_K_XL, so the tier-16 finding transfers on model identity.
   With claw gone there is no comparative decision left — only serving
   validation (wizard smoke + a few oc+prompt cells). No comparative claim
   made.
8. **Harness: opencode-native + baked runner.** Delete claw halves;
   generalize `run-config-ab.sh` into a config-vs-config driver (the
   `--treatment/--baseline` machinery landed 2026-06-10 already supports
   arbitrary arms — future A/Bs: prompt variants, samplers, models); bake a
   test-runner image with node+git+docker preinstalled, killing the
   `apk add`-per-sweep waste.
9. **Thinking: off by default, documented toggle.** All collected evidence
   is thinking-off (#017 parity). Thinking-on remains explicitly unmeasured.
10. **Daily UX: wrapper CLI installed by the wizard.** One command (e.g.
    `oc`): asserts the resident server is green (starts it if not), mounts
    `$PWD` at `/workspace` + global prompt config, drops into the OpenCode
    TUI (`oc run "…"` for headless). The container is invisible plumbing.
11. **Sequencing: build → prove → gut** (see §3). Claw stays bootable until
    its replacement is the actual daily tool.
12. **This doc lives in `host/test/docs/`** with its evidence lineage;
    cross-link from the root README.

---

## 3. Rewrite plan (sequenced; tracer bullet first)

1. **Injection probe (gate).** Strong-model oracle: global
   `AGENTS.md`/`instructions[]` in a git-rooted workspace, tier-64. Decides
   decision 6's mechanism. (~10 min once the server is up.)
2. **Tracer bullet — the daily-driver slice.** Resident tier-64
   llama-server under launchd (adapt `opencode-server` + existing
   `com.mac-llm-lab.opencode-server.plist`) + `oc` wrapper + winning prompt
   mechanism, used end-to-end in a real repo. *Exit criterion: you do a
   real piece of work with it.*
3. **Wizard rewrite.** Replace steps 48/49 with: opencode image build,
   opencode config (per-tier `opencode.json`, thinking-off kwarg), global
   prompt install, launchd resident server, `oc` wrapper install; keep
   full-local/client-only topologies and tier slider; smoke step exercises
   `oc run`.
4. **The gut.** Tag `claw-stack-final`; commit canonical registries to
   `host/test/docs/data/`; delete claw-code, LiteLLM, grammar, claw plists,
   `lib/claw.js` + claw branches in harness/drivers/entrypoint; update
   README.
5. **Harness rewrite.** Opencode-native runAgent path, generic A/B driver,
   baked runner image; tier-eval panel and registry/reporter/bootstrap
   unchanged.
6. **Tier-32 smoke.** Wizard smoke + handful of oc+prompt cells at the
   tier-32 serving config.

## 4. Scope boundaries (so the record doesn't overclaim)

- Thinking-on: unmeasured at any tier.
- Tier-32: no comparative data; adopted by extrapolation (same 9B).
- Latency/prose-quality/tool-discipline probes from the old suite were
  claw-bridge-only (no registry rows); latency/prose-quality still have no
  OpenCode counterpart. **Tool-discipline gap CLOSED 2026-06-11** (issue
  #010, decision 2026-06-10, measurement-first): the Layer-A admission gate
  is now the live tool-call battery in `opencode-server probe` (N=6 —
  3 tool-demanding prompts × 1 repeat × non-stream+stream via
  validate-tool-calls.sh; pass = N/N parsed `tool_calls[]`, zero naked-XML
  leaks; seats: `probe`, `install`, wizard step 51), and registry rows now
  carry `tool_call_count` / `error_tool_call_count` /
  `truncated_tool_call_count` promoted from the run_summary sidecar
  (nullable, telemetry only — NO threshold, NO exclusion rule; threshold
  review deferred to issue #018).
- Token accounting: registry carries no token fields (#021/#022 partial).
- Tier-16/-32 remain **capability proxies** on 64 GB silicon, not
  memory-tier tests; thinking-off both arms; split provenance — caveats
  carried from OPENCODE-AB-FINAL-REPORT.md §6.

## 5. Parked (explicitly, user's call)

- N=16 confirmation sweep at tier-16 — declined as uninformative
  (between-task variance dominates).
- `book-store` / `two-bucket` transcript inspections (#020/#021 tooling) —
  flagged anomalies, not blocking migration.
- Thinking-on evaluation; latency/prose-quality probe ports — future
  experiments on the generic A/B driver.
