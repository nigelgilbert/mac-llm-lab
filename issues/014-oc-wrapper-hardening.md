# oc wrapper hardening: config path resolution, flag-safe prompts, content-true injection oracle

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 xhigh review (2026-06-10), cut findings C14, C12, CL6 — verified during
the review of <https://github.com/nigelgilbert/mac-llm-lab/pull/6> (C14/C12
not posted; details below are the canonical statement).

## What to build

Three fixes to `client/opencode/bin/oc` (one touches
`host/test/lib/opencode.js` too):

1. **Absolutize OPENCODE_CONFIG_JSON.** `assert_config` validates a relative
   path against the caller's cwd, but compose
   (`--project-directory client/opencode`) resolves the same unabsolutized
   value against the compose dir — so a relative override existing only in
   the caller's cwd passes the check yet bind-mounts a nonexistent path,
   which docker auto-creates as an empty directory over
   `/root/.config/opencode/opencode.json`: the silent wrong-config run the
   assertion exists to prevent. The script already absolutizes PROMPT_FILE
   for exactly this reason ("absolute path for the docker -v mount") —
   apply the same `cd dirname && pwd` treatment to CONFIG_JSON before
   asserting and exporting.

2. **Flag-safe prompt pass-through.** Both oc's `run_container opencode run
   "$@"` and the harness's `dockerComposeArgv` place the prompt directly
   after `opencode run` with no `--` separator, so a dash-leading prompt is
   parsed as CLI flags. All harness prompts are fixed non-dash literals
   today, so the exposure is the user-facing oc path — verify in-container
   whether `opencode run -- "<prompt>"` is honored and add the separator to
   both call sites (or reject dash-leading prompts loudly if upstream
   doesn't support `--`).

3. **Content-true injection oracle.** `oc probe`'s wire-capture assertion
   greps only OpenCode's incidental attribution string
   (`Instructions from: /root/.config/opencode/AGENTS.md`) and never checks
   that any `$PROMPT_FILE` content reached the captured request body — so a
   truncated injection passes, and an upstream rewording of the attribution
   line fails the probe (and the install-gating wizard step 61) on the next
   `OPENCODE_VERSION` bump while injection actually works. The mock already
   captures the full request body: plant a unique sentinel in the probe's
   prompt file and grep the capture for the sentinel (keep the attribution
   grep as a secondary diagnostic if useful).

## Acceptance criteria

- [ ] From a foreign cwd, `OPENCODE_CONFIG_JSON=./tier.json oc run ...` with `./tier.json` present resolves and mounts that file (verify the in-container config matches); with it absent, oc exits 2 before docker runs
- [ ] `oc run "--weird prompt"` either delivers the literal prompt to the model (verified via wire capture) or exits with an explicit dash-leading-prompt error — no silent flag-parse
- [ ] `oc probe` passes by finding the planted sentinel in the captured request body; doctoring the capture to contain only the attribution line makes it fail
- [ ] Wizard step 61 still green end-to-end after the oracle change

## Blocked by

None - can start immediately
