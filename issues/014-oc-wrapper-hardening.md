# oc wrapper hardening: config path resolution, flag-safe prompts, content-true injection oracle

**Type**: AFK

**Status:** ✅ Complete

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

- [x] From a foreign cwd, `OPENCODE_CONFIG_JSON=./tier.json oc run ...` with `./tier.json` present resolves and mounts that file (verify the in-container config matches); with it absent, oc exits 2 before docker runs
- [x] `oc run "--weird prompt"` either delivers the literal prompt to the model (verified via wire capture) or exits with an explicit dash-leading-prompt error — no silent flag-parse
- [x] `oc probe` passes by finding the planted sentinel in the captured request body; doctoring the capture to contain only the attribution line makes it fail
- [x] Wizard step 61 still green end-to-end after the oracle change

## Blocked by

None - can start immediately

## Result

All three fixes landed (2026-06-10). Files changed: `client/opencode/bin/oc`
(all three fixes) and `host/test/lib/opencode.js` (the one surgical
`dockerComposeArgv` edit). Verified end-to-end with real container runs; the
live `oc run` legs ran under the `/tmp/oc-resident.lock.d` lock.

**Upstream `--` finding (decides fix 2's shape):** verified in-container on
opencode 1.16.2 via the wire-capture mock — `opencode run -- "--weird prompt
SENTINEL"` exits 0 and the literal prompt appears in the captured
`/v1/chat/completions` body; without `--` the same prompt yargs-parses as
flags (usage dump, exit 1, NO request ever sent — and a prompt like
`--demo x` would silently flip a real flag). So the separator was added at
both call sites: `run_container opencode run -- "$@"` in oc (and the probe's
in-container `opencode run -- "say hi"`), and
`'opencode', 'run', '--', prompt` in `dockerComposeArgv`.

**AC1 (relative config absolutized):** from foreign cwd
`/tmp/oc-foreign.AzThFw` with `./tier.json` carrying a unique model name
(`ac1-foreign-model`) and a baseURL only it knows
(`host.docker.internal:9099`, host-side capture mock):
`OPENCODE_CONFIG_JSON=./tier.json oc run "...MARKER-AC1-PRESENT-55917"`
→ rc=0, both captured request bodies show `model: ac1-foreign-model` + the
prompt marker — the in-container effective config IS the caller-cwd-relative
file. Absent case: fresh empty cwd, docker shimmed via PATH logger →
`oc: PROMPT PRECONDITION FAILED: opencode config missing/unreadable:
./tier.json`, rc=2, shim log empty (no docker invocation).

**AC2 (flag-safe prompt):** `oc run "--weird prompt MARKER-AC2-DASH-66120"`
through the real oc path → rc=0, literal dash-leading prompt present in both
captured request bodies. Harness side carries the same `--`.

**AC3 (content-true oracle):** `oc probe` now copies the resolved prompt to
`$ws/AGENTS.probe.md`, appends a unique tail sentinel
(`OC-PROBE-SENTINEL-<epoch>-<pid>-<rand>`), mounts the copy, and gates
PASS/FAIL on the sentinel reaching the captured body (attribution grep
demoted to a non-gating diagnostic). Live run: PASS on sentinel
`OC-PROBE-SENTINEL-1781148537-68292-20250`. Doctored copy of oc whose mock
records only the attribution line: probe FAIL, rc=2, with the
"attribution line IS present without the sentinel — prompt content
truncated/dropped in flight" diagnostic (the pre-#014 oracle would have
passed this capture).

**AC4 (wizard step 61):** ran `step_61_main` under the resident lock (wizard
libs + steps sourced exactly as `cmd_install` does; sibling's mid-flight
edits were in `wizard/wizard`/`steps/51`, step 61's file untouched) → both
legs green, rc=0: probe PASS on sentinel
`OC-PROBE-SENTINEL-1781148611-68424-15533`, and the real
`oc run` (through the new `--` path, tier-64 resident :11436) produced
`smoke.txt` containing `WIZARD-OC-SMOKE-68411`. This run is also the
ordinary-prompt sanity check.

**Known follow-up (file outside this issue's ownership):**
`host/test/__tests__/lib/opencode.contract.test.js` pins the pre-`--` argv
with `assert.deepEqual` in two places (lines ~145–149 and ~180:
`['opencode', 'opencode', 'run', <prompt>]` → needs
`['opencode', 'opencode', 'run', '--', <prompt>]`); the `args.at(-1)`
assertion at ~163 is unaffected. Left untouched per the tranche's file
ownership — apply at the orchestrator boundary.
