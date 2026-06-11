# Docs audit: defunct & outdated context after the OpenCode migration

**Date:** 2026-06-10 · **Branch:** `experiment/opencode` (38 commits ahead of
`main`) · **Status:** research spike — **no deletions executed**; this is the
proposed disposition list for review.

## Scope & method

Every tracked markdown file in the repo (~100) was read and classified against
the post-migration ground truth: claw stack deleted (#008, archive tag
`claw-stack-final`), harness opencode-native (#010), tier-32 smoke complete
(#011, today — the full 001–011 suite is now ✅). The operative architecture
record is [OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md).
Leftovers flagged out-of-scope by #008 (hostctl claw profile, `claw.Modelfile`,
MANIFESTO/spec/research mentions) were verified on disk.

**Disposition principle** (from decision §2.2): *git history is the archive*.
"Keep for history" alone does not justify a working-tree file. A doc earns its
place only if it is (a) operationally current, (b) evidence lineage for a
published number, or (c) methodology/findings feeding the next research
tranche. Category (c) items are inventoried in the companion doc,
[research-salvage-next-tranche-20260610.md](research-salvage-next-tranche-20260610.md).

---

## Tier 1 — DELETE (defunct, no salvage step needed)

| File | Why defunct |
|---|---|
| `host/llama-server/docs/TODO-GRAMMAR-PRELUDE.md` | Proposes capping the `claw.gbnf` prelude. The grammar is deleted and was proven **redundant** under llama.cpp's native tools-grammar (decision §1, "mechanism conclusion"). The one prior attempt it records (CLAUDE.md plant, reverted 2026-04-27) is in git history. |
| `research/claw-code-behavioral-fixes.md` | Three proposed claw fixes, none implemented, all moot: (1) grammar prelude — grammar deleted; (2) TTFT bridge-attribution diagnostic — there is no bridge; (3) `context_overflow` failure class — already landed in the harness (Sprint 1.20, `pickTerminalStatus`). |
| `host/test/docs/OPENCODE-AB-SYNTHESIS-BRIEF.md` | Interim context-handoff brief written *for* the synthesis agent; fully absorbed by `OPENCODE-AB-FINAL-REPORT.md` (commit 2b9f8e1 records the synthesis landing). Pure working scaffolding, zero unique evidence. |
| `host/llama-server/docs/V2-LEVERS.md` | Empty per-class scaffold awaiting a W4 classification pass that never ran (program parked pre-migration). The only unique content is one paragraph of per-class lever hints — fold into `W4-TAXONOMY.md` if revived (see salvage doc §4); the scaffold itself is regenerable. |

## Tier 2 — DELETE + small rewrite (defunct body, salvageable fragment)

| File | Disposition |
|---|---|
| `host/llama-server/README.md` | Body is the HISTORICAL claw setup (grammar, `:11435`, bridge reconfig, launchd plists — all deleted by #008) behind a RETIRED notice. **Replace** with a short README for what actually lives there now: `scripts/opencode-server` (tiers/ports contract), `templates/` (corrected Jinja), `docs/system-prompt.md`. Salvage the llama.cpp build-from-source steps (§1) — still needed to stand up the serving binary. |
| `host/ollama/Modelfiles/claw.Modelfile` + the `claw` rows in `Modelfiles/README.md` and `host/ollama/README.md` | Stated keep-rationale was (a) rollback and (b) `run-backend-ab.sh` A/B — **both dead**: rollback is `git checkout claw-stack-final`, and `run-backend-ab.sh` no longer exists. README's claim that discipline rules are "planted as workspace CLAUDE.md" is also stale (now global `~/.config/opencode/AGENTS.md`). Delete the Modelfile, drop the claw rows. |
| `host/scripts/README.md` claw sections + `mac-llm-lab-hostctl` claw profile (code) | hostctl still carries 10 `claw` references routing `warm claw` to a llama-server that no longer exists at `:11435` (#008 flagged this leftover explicitly). Remove the profile from the script and the doc together. |

## Tier 3 — DELETE on suite closure (process docs that finished their job)

The migration suite is **complete as of today** (#011 ✅). This repo's
convention is to remove finished suites (commit `feb8e6c`, "Remove completed
issues suite").

- `issues/001…011` (12 ticket files incl. `004-acceptance-log.md`) +
  `issues/WORKLOG.md` — delete in the suite-closure commit, **after** one
  salvage step: the WORKLOG "deviations/corrections registry" contains two
  findings that outlive the suite and live nowhere else —
  1. the **behavioral PROOF oracle is invalid** (failed known-positive
     validation; the wire-capture oracle is the instrument of record), and
  2. the **FINDING-2 correction**: global AGENTS.md injects even in bare
     dirs (the earlier no-op was a behavioral false negative).
  Both belong as a short addendum in OPENCODE-MIGRATION-DECISION.md (§2.6
  already half-records the gate resolution) or in `oc probe`'s doc. The #004
  acceptance evidence is summarized in the GO entry; the per-keystroke log
  doesn't need to survive.

## Tier 4 — EDIT in place (kept, but carries stale claw context)

| File | Stale bits |
|---|---|
| `README.md` | One line still describes the code stack as "via claw-code through LiteLLM bridge". Migration note + decision-doc cross-link (decision §2.12) are already correct. |
| `MANIFESTO.md` | Three references: claw-code/LiteLLM as the coding substrate, and `claw` listed in the profile roster. The thesis content is untouched by the migration. |
| `spec.md` | Same two patterns (claw in prose + profile list). Spec correctly scopes only the OWUI chat stack; just strip claw. |
| `client/README.md` | Accurate but now ambiguous — add a header line: this is the OWUI **chat** client orchestration, not the coding path (`oc`). |
| `host/test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md` | Written as a prescriptive spike guide ("not yet validated on our hardware"); all three fixes are now implemented and validated. Add a banner: implemented as of 2026-06-10, retained for the *why* behind each serving fix. |
| `host/test/docs/OPENCODE-SERVER-TIMINGS.md` | Spec for a deferred feature (#022, needs the #021 transcript adapter). Add a "deferred / post-v1, see salvage doc" banner so it isn't mistaken for shipped behavior. |
| `host/test/docs/base/TIER-EVAL-V2-SPRINT-PLAN.md` | Plan is the live roadmap for Sprints 2–4, but predates the migration: rows referencing claw-bridge-only probes (latency/prose-quality/tool-discipline — emit no registry rows, decision §4) need a "no OpenCode counterpart yet; rebuild on the generic driver" annotation pass. |

## Tier 5 — local hygiene only (untracked; not a repo decision)

- `host/test/logs/OVERNIGHT-SCREEN-*.md` (8 files) — **not in git** (only
  `T32-TUNING-PROGRESS.md` and `TIER-EVAL-V2-SPRINT-1-BASELINE.md` are
  tracked). Local sweep-session scratch pointing at gitignored
  `.claw-runtime/` registries; discard locally whenever.
- `client/opencode/.opencode-runtime/phase-ws/AGENTS.md` — untracked runtime
  artifact, already covered by gitignore convention.

## Explicitly KEPT (verified, no action)

- **Evidence lineage** (all published numbers re-derivable from
  `host/test/docs/data/`): `OPENCODE-AB-FINAL-REPORT.md`, both per-tier
  verdicts, `OPENCODE-SIDECAR-PORT-HANDOFF.md`,
  `TIER16-THINKING-PARITY-DECISION.md`, `data/README.md`. Also
  `OPENCODE-HARNESS-AB-PLAN.md` — superseded as a plan but it *is* the
  pre-registration record (the −5pp margin and 1.5× wall-clock rule the
  verdicts are scored against); deleting it would weaken the audit trail.
- **Operative docs**: `OPENCODE-MIGRATION-DECISION.md`,
  `OPENCODE-WORKSPACE-CONTRACT.md`, `wizard/README.md`,
  `client/opencode/README.md` + its two `docs/` findings (load-bearing for
  the runner's timeout-kill design and the future #021 adapter),
  `host/llama-server/docs/system-prompt.md` (the production prompt — the
  moat), `templates/README.md`, both `TOOL-CALL-VALIDATION*.md`,
  `host/test/README.md`, `profiles.md`, `host/README.md`,
  `host/ollama/README.md` (minus claw rows per Tier 2).
- **Eval substrate methodology** (harness-agnostic, in active use):
  `EVAL-DESIGN.md`, `HIDDEN-HOLDOUT-POLICY.md`, the difficulty-pack set
  (PLAN/README/good-tests/mutations/canonicals/memos), usability-pack memos,
  `standardtest-helper.md`, `W2-W4-ANALYSIS-METHODS-LIBRARY.md`,
  `scripts/_attic/` (correctly archived with forward pointer).
- **Research-value historicals** — inventoried with revival paths in the
  companion salvage doc rather than re-listed here: the W1–W5
  iteration-distribution program docs, W4 taxonomies, tier-eval memos &
  calibration reports, `productivity-grader-notes.md`,
  `tool-use-and-mac-tier-scorecard.md`, `T32-TUNING-PROGRESS.md`,
  `classifier-prompt*.md`.

## Tally

| Disposition | Count |
|---|---|
| Delete now (Tier 1) | 4 |
| Delete + fragment rewrite (Tier 2) | ~3 files + 2 code edits |
| Delete at suite closure (Tier 3) | 13 (issues/ + WORKLOG) after one salvage addendum |
| Edit in place (Tier 4) | 7 |
| Local-only cleanup (Tier 5) | 9 untracked files |
| Keep as-is | everything else (~60) |

The repo's docs are in genuinely good shape: the migration-era docs
self-labeled their own obsolescence (RETIRED notices, "historical" markers,
status lines), so the defunct set is small and crisply bounded. The single
largest deletion is the completed issue suite, which is convention, not
judgment.
