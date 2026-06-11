# Wizard install integrity: guard step 51, honest exit codes, canonical probe

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), finding 13/15 and cut-CL4 — inline comments
on <https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

Three wizard fixes, one PR:

1. **Guard step 51.** In `cmd_install`, `step_51_main` is invoked bare while
   steps 52/53/54 each carry `|| { fail ...; return 1; }`, and the wizard
   runs under `set -u` only. All of step 51's failure paths `return 1` and
   `fail()` is printf-only — so a failed serving install (GGUF missing,
   /health never green) prints one red ✗ and the wizard continues to a
   green "Done", exit 0, with no daemon. Add the same guard.

2. **Honest smoke exit.** `step_61_main || true` swallows the end-to-end
   smoke. Surface it in the exit code (or at minimum a non-swallowed FAIL
   summary line + nonzero exit) — an installer that exits 0 must mean
   everything it installed works.

3. **Call the canonical probe.** `step_51_probe` self-describes as a
   "curl-only twin of `opencode-server probe`" but asserts only 2 of
   cmd_probe's 3 template invariants — it was born missing the old-suite-#017
   per-request `enable_thinking:false` check, so a wizard-passing server can
   fail the canonical probe. The full-local flow already cd's into
   host/llama-server to run `opencode-server install` and even prints the
   canonical probe as its own debug hint; replace the twin with a direct
   `OPENCODE_TIER=$tier opencode-server probe` invocation.

## Acceptance criteria

- [x] With a forced step-51 failure (e.g. temporarily renamed GGUF), `wizard install` exits nonzero and does not print the final "Done" success block
- [x] With a forced step-61 smoke failure, `wizard install` exits nonzero
- [x] `grep -c chat_template_kwargs wizard/steps/51-opencode-server.sh` shows the twin is gone (probe delegated), and a wizard install at the current tier passes all three canonical invariants
- [x] A clean full-local `wizard install` still completes green end-to-end, exit 0

## Blocked by

None - can start immediately

## Result

Implemented 2026-06-10 (tranche 2 agent). Files changed: `wizard/wizard`
(cmd_install), `wizard/steps/51-opencode-server.sh` (step_51_probe +
step_51_main). Live runs captured in /tmp/wiz-ac{1,2,4}.out.

1. **Guard step 51** — `step_51_main` now carries the same
   `|| { fail ...; return 1; }` guard as 52/53/54.
2. **Honest smoke exit** — `step_61_main || true` replaced with a
   non-swallowed FAIL summary (`end-to-end smoke FAILED — stack installed
   but NOT verified` + log path) and `return 1`. Step 61's deliberate
   client-only "LAN host unreachable" SKIP still returns 0 (unchanged).
3. **Canonical probe** — the curl-only twin is gone; `step_51_probe` now
   delegates: `( cd "${REPO_ROOT}/host/llama-server" && OPENCODE_TIER="$1"
   ./scripts/opencode-server probe )`. It runs (and is load-bearing,
   `return 1` on failure) on BOTH the fresh-install path and the
   already-loaded+healthy skip path, so every full-local install verifies
   all 3 template invariants against the live server.

Per-AC evidence:

- **AC1** (forced 51 failure): scratch state (`WIZARD_STATE_FILE=/tmp`,
  tier 32 on-demand) + `LLAMA_SERVER=/nonexistent/llama-server` — chosen
  over a GGUF rename because step 46 would re-download a renamed GGUF
  before step 51 ever saw it missing, and this forcing touches zero disk
  state. Run: `✗ tier-32 on-demand serving config incomplete` → `✗
  opencode serving install failed — no working tier server`, **exit 1**,
  zero `Done` blocks (/tmp/wiz-ac1.out). Resident untouched.
- **AC2** (forced 61 failure): under the resident lock, `~/.local/bin/oc`
  temporarily re-pointed at /usr/bin/false (step 54's never-clobber rule
  leaves a "foreign" oc alone; deterministic, no sibling-owned files
  touched). Run: `✗ injection probe FAILED` → `✗ end-to-end smoke FAILED —
  stack installed but NOT verified`, **exit 1**, no Done block
  (/tmp/wiz-ac2.out, wizard log install-20260610-222813.log). Symlink
  restored to client/opencode/bin/oc immediately after.
- **AC3**: `grep -c chat_template_kwargs wizard/steps/51-opencode-server.sh`
  → `0`. Both AC2 and AC4 runs show the canonical probe's three PASS lines
  on the live tier-64 resident (`system-not-first`, `thinking-off launch
  default`, `thinking-off #017 per-request`) + `probe: all checks passed
  (tier-64, http://127.0.0.1:11436)`.
- **AC4** (clean run): under the lock, real state, piped defaults
  (full-local / tier 64): **exit 0**, green `Done`; canonical probe 3/3
  PASS; `oc probe` injection PASS (wire-capture sentinel); `oc run`
  artifact verified (`smoke.txt contains WIZARD-OC-SMOKE-67942`)
  (/tmp/wiz-ac4.out, wizard log install-20260610-222829.log). The sibling
  oc edits did not interfere — no deferral needed.

End-state: resident :11436 green + launchd loaded; :11437/:11438 quiet (as
found); oc symlink restored; lock released; no leftover smoke workspaces;
wizard/.state values unchanged.
