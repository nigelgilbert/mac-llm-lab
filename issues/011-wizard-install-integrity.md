# Wizard install integrity: guard step 51, honest exit codes, canonical probe

**Type**: AFK

**Status:** 🔲 Not started

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

- [ ] With a forced step-51 failure (e.g. temporarily renamed GGUF), `wizard install` exits nonzero and does not print the final "Done" success block
- [ ] With a forced step-61 smoke failure, `wizard install` exits nonzero
- [ ] `grep -c chat_template_kwargs wizard/steps/51-opencode-server.sh` shows the twin is gone (probe delegated), and a wizard install at the current tier passes all three canonical invariants
- [ ] A clean full-local `wizard install` still completes green end-to-end, exit 0

## Blocked by

None - can start immediately
