# Remove the discipline prompt from the production stack (+ retire the runnable eval arms)

**Type**: AFK (single coherent change; touches the daily driver + decision docs — verify live before close)

**Status:** 🔲 Not started

## Parent

[OPENCODE-PROMPT-HALVES-VERDICT.md](../host/test/docs/OPENCODE-PROMPT-HALVES-VERDICT.md)
(2026-06-12, G1 FAILED). The discipline prompt's sole justification was the
tier-16 **+6.6pp** effect ([OPENCODE-SIDECAR-PORT-HANDOFF.md](../host/test/docs/OPENCODE-SIDECAR-PORT-HANDOFF.md)).
On the current harness that effect is **+0.1pp, 90% CI [−3.4, +3.9]** —
indistinguishable from zero, and the prompt arm costs **1.67× wall-clock**.
Cross-sweep diff shows the bare control rose +9.5pp [+5.6, +13.6] to meet the
prompt arm: the #020–#029 harness refactor subsumed whatever the prompt was
doing. The tier-64 daily driver was never measured prompt-on/off, but the
tier-64 winning config (`opencode-a`, +3.1pp over claw) never used the prompt,
and the prompt's only positive evidence has now evaporated. Burden-of-proof is
on keeping it; it fails. Decision taken via grill session 2026-06-12 (lab
owner): **remove.**

## Decisions locked (grill 2026-06-12)

- **Full removal** of the live prompt AND the source files
  (`host/llama-server/docs/system-prompt.md` + `.h1.md` + `.h2.md`). Git history
  is the archive (same pattern as the claw `tag + delete`).
- **Unblocked** — proceed now on simplicity / burden-of-proof. A tier-64
  prompt-on/off measurement is an OPTIONAL, non-blocking follow-up (file
  separately); re-add from git only if the daily driver visibly regresses.
- **`oc` drops prompt plumbing entirely** — prompt-less is the only mode.
- **`config_id` enum entries are DEMOTED, not deleted.** The committed
  registries under `host/test/docs/data/` carry rows stamped
  `opencode-a+git/+prompt/+prompt-h1/+prompt-h2`; deleting these from the schema
  enum / `VALID_CONFIGS` would break registry validation and the #025 goldens.
  Treat them exactly like `claw-rig`: readable/historical, not runnable.

## What to build

1. **`client/opencode/bin/oc` — remove prompt plumbing.** Delete
   `resolve_prompt`/`assert_prompt`, the `CONTAINER_PROMPT_PATH` read-only
   bind-mount, the `OC_PROMPT_FILE` env, the `WIZARD_PROMPT`/`REPO_PROMPT_SOURCE`
   resolution, and the **exit-2 prompt-precondition** (PROMPT PRECONDITION
   FAILED). `oc run`/TUI must run clean with no global prompt and never
   reference `AGENTS.md`. (The exit-2 existed because injection is silent — moot
   once nothing is injected.) Update `oc status` to stop reporting a resolved
   prompt. Renumber the exit-code table.
2. **`host/llama-server/scripts/opencode-server` `probe` (and
   `validate-tool-calls`/wizard 51 seats) — drop the prompt-injection
   assertion** from the admission probe; **KEEP the #010 tool-call battery**
   (N=6 parsed, 0 leaks) untouched — that is a separate gate.
3. **Wizard:**
   - Delete `wizard/steps/53-opencode-prompt.sh` (the global-prompt install) and
     its registration in the step list.
   - `wizard/steps/61-opencode-smoke.sh` — flip the oracle from "prompt IS
     injected" to **"prompt is NOT injected"** (negative wire-capture: the
     captured `/v1/chat/completions` body carries no `Instructions from:` /
     no AGENTS.md content) AND a clean prompt-less `oc run` exits 0.
   - Add an **uninstall** of the host `~/.config/opencode/AGENTS.md` **only when
     it byte-matches the repo `system-prompt.md`** (a wizard-installed copy);
     **never clobber a user-customized file** (symmetric with step 53's old
     never-clobber rule) — warn and leave it.
4. **Eval arms — demote to historical-only:**
   - `host/test/lib/config.js`: remove `opencode-a+git`, `opencode-a+prompt`,
     `+prompt-h1`, `+prompt-h2` from **`OPENCODE_CONFIGS`** (runnable set);
     **leave them in `VALID_CONFIGS`** with a historical-only note (cf.
     `claw-rig`). Delete `OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER` +
     `OPENCODE_PROMPT_HALF_MODEL_CONFIG_ID_BY_TIER`. After: the only runnable
     opencode config is `opencode-a` (tiered via `TIER`).
   - `host/test/lib/runAgent.js`: delete `AGENTS_MD_SOURCE_BY_CONFIG`,
     `SYSTEM_PROMPT_PATH`, the `seedWorkspaceGit` prompt-plant + git-init seeding
     branch (only the prompt/git arms used it), and the `selectRunner` routing
     for the demoted arms (selecting them for execution now throws, like
     `claw-rig`).
   - `host/test/lib/schemas/run_registry.schema.json`: **keep** the enum entries
     (registry validation); update the description to mark them historical-only.
   - `host/test/lib/model_configs.json`: the `...-opencode-prompt[-h1/-h2]`
     entries — keep iff any committed registry row references them as
     `model_config_id` (check; demote-don't-delete if so), else remove.
   - Delete `host/test/__tests__/lib/prompt-halves.contract.test.js` (it asserts
     the now-deleted half files are verbatim subsets — it cannot survive the
     file deletion). Trim `config-selector.test.js` cases that execute the
     demoted arms; keep cases asserting they're non-runnable.
5. **Delete the source files:** `host/llama-server/docs/system-prompt.md`,
   `system-prompt.h1.md`, `system-prompt.h2.md`.
6. **Decision-doc updates** (so the record doesn't contradict the tree):
   - `OPENCODE-MIGRATION-DECISION.md` §1 ("OpenCode + the ported discipline
     prompt"), §2.6 (prompt delivery global/probe-gated), §2.10 (oc mounts the
     global prompt), §6 — amend with a dated note pointing at the halves verdict
     (G1 failed) and this issue; the prompt is no longer part of the stack.
   - `OPENCODE-PROMPT-HALVES-VERDICT.md` — one-line "Acted on: prompt removed
     from production, #030".
   - README / any `oc`/wizard docs mentioning the global prompt.
7. **File the optional follow-up** (separate issue, non-blocking): tier-64
   `opencode-a` vs a prompt-bearing arm, N=8, current harness — only to decide
   whether the 35B daily driver wants the prompt back; re-add = git revert.

## Acceptance criteria

- [ ] `oc run "<task>"` against the resident tier-64 server exits 0 with **no
      prompt present and no exit-2**; `oc status` reports no prompt.
- [ ] **Wire-capture oracle (negative #001):** a captured `oc run` request body
      contains no injected AGENTS.md / no `Instructions from:` line. (Wire
      capture is the oracle — never behavioral.)
- [ ] Selecting any demoted arm for execution throws (like `claw-rig`); only
      `opencode-a` is runnable.
- [ ] Committed registries under `docs/data/` still schema-validate; the **#025
      goldens + every published CI re-derive verbatim** (sidecar +6.6pp,
      halves +0.1pp, etc. — the enum demotion must not move a number).
- [ ] Full containerized suite green (0 fail) on the **rebuilt baked image**
      (`docker compose build test`); the only count delta is the deleted
      prompt-halves contract test + trimmed selector cases — no new failures.
- [ ] Clean full-local `wizard install` green with step 53 gone and step 61
      asserting prompt **absence**; a pre-existing wizard-installed
      `~/.config/opencode/AGENTS.md` is removed, a user-customized one is left
      with a warning.
- [ ] No reference to `system-prompt.md` remains in any runnable code path
      (`grep` clean outside git history + the historical-only doc notes).
- [ ] Decision docs amended; tier-64 follow-up issue filed and linked.

## Blocked by

None — proceed now (grill decision). Coordinate only with the optional tier-64
follow-up (informational, non-blocking).
