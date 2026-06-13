# Finish the claw-era doc housekeeping (audit Tiers 1/2/4)

**Type**: AFK (mechanical deletions + claw-mention strips; no architectural or
scientific judgment — every disposition was already decided in the audit)

**Status:** 🔲 Not started

## Parent

[research/docs-audit-defunct-20260610.md](../research/docs-audit-defunct-20260610.md)
(grill-resolved 2026-06-13, lab owner). Executes the audit's still-valid,
claw-only tiers, which this issue then retires.

## What to build

Execute the audit's claw-era housekeeping — the tiers untouched by the thesis
falsification (the claw stack is still gone; these docs are still defunct).
Pure janitorial; the dispositions are already specified in the audit.

- **Tier 1 (delete):** `TODO-GRAMMAR-PRELUDE.md`,
  `research/claw-code-behavioral-fixes.md`, `OPENCODE-AB-SYNTHESIS-BRIEF.md`,
  `host/llama-server/docs/V2-LEVERS.md`.
- **Tier 2 (delete + small rewrite):** replace `host/llama-server/README.md`
  with a short current-stack README (salvage the llama.cpp build-from-source
  steps); delete `claw.Modelfile` + drop the `claw` rows from the two
  `Modelfiles/`/`ollama` READMEs; remove the `claw` profile from
  `mac-llm-lab-hostctl` and its doc together.
- **Tier 4 (edit in place):** strip stale `claw`/LiteLLM-bridge mentions from
  root `README.md`, `MANIFESTO.md`, `spec.md`, `client/README.md`; add the
  "implemented 2026-06-10" banner to `OPENCODE-QWEN36-SETUP-GUIDE.md`.

Hard boundaries: **do not touch** `system-prompt.md` (parked → prompt-removal)
and **do not touch any falsified-claim wording** (that's #033 — the
"prompt is the moat" surfaces, the VERDICT, MIGRATION-DECISION §1, the
evidence docs). Tier 3 (issue-suite deletion) is out of scope — verify
separately. This issue retires the audit doc when done.

## Acceptance criteria

- [ ] Tier-1 files deleted (the four named above); `git status` shows them removed
- [ ] Tier-2 done: `host/llama-server/README.md` describes the current opencode-server/templates/system-prompt stack (build-from-source steps retained); `claw.Modelfile` gone; no `claw` rows remain in the Modelfiles/ollama READMEs; hostctl `claw` profile removed from script **and** doc
- [ ] Tier-4 claw/LiteLLM mentions stripped from root README, MANIFESTO.md, spec.md, client/README.md; setup-guide banner present
- [ ] `grep -rniE "\bclaw\b|litellm bridge" --include=*.md .` returns only intentional historical references (the `claw-stack-final` archive tag, the correction plan, #033/#034) — no live "claw is the coding stack" prose
- [ ] `host/llama-server/docs/system-prompt.md` is byte-unchanged by this issue (`git diff` shows it untouched)
- [ ] `git diff` for this issue contains **no** edits to MIGRATION-DECISION §1, the prompt-halves VERDICT, or the evidence docs' claim text (those belong to #033)
- [ ] `docs-audit-defunct-20260610.md` retired (deleted; superseded by the parent plan + git history)

## Blocked by

None - can start immediately (disjoint file surface from #033)
