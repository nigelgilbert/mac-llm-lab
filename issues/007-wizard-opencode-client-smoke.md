# Wizard: opencode client steps + end-to-end smoke

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.6, §2.10, §3.3.

## What to build

The client half of the wizard rewrite, same idempotent style:

- build/pull the OpenCode container image,
- install the per-tier opencode config(s) and the prompt-delivery mechanism
  chosen by #001 (global config install, or the per-repo seeding helper),
- install the `oc` wrapper (#003) onto PATH,
- rewrite the smoke step to exercise the new stack end-to-end: `oc run` a
  trivial task against the resident server and assert the artifact, plus the
  PROOF-oracle injection assertion so a fresh install can't silently ship a
  null prompt.

After this issue, a fresh `wizard install` produces the complete new coding
stack without touching litellm/clawcode steps (removed in #008).

## Acceptance criteria

- [ ] Fresh-install simulation (or doctor-verified converge on this machine) ends with the smoke step green: `oc run` artifact created AND injection PROOF observed
- [ ] Second `wizard install` run is fully idempotent (transcript in Result)
- [ ] `oc` on PATH and working from an arbitrary directory after install
- [ ] client-only topology installs image+config+wrapper pointed at the LAN host and smoke passes against it (or is explicitly skipped with a reason if no LAN host available, noted in Result)

## Blocked by

- #003
- #006
