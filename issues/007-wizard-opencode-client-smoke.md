# Wizard: opencode client steps + end-to-end smoke

**Type**: AFK

**Status:** ✅ Done (2026-06-10)

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

- [x] Fresh-install simulation (or doctor-verified converge on this machine) ends with the smoke step green: `oc run` artifact created AND injection PROOF observed
- [x] Second `wizard install` run is fully idempotent (transcript in Result)
- [x] `oc` on PATH and working from an arbitrary directory after install
- [x] client-only topology installs image+config+wrapper pointed at the LAN host and smoke passes against it (or is explicitly skipped with a reason if no LAN host available, noted in Result)

## Blocked by

- #003
- #006

## Result

**Done 2026-06-10.** Four new steps, numbered after #006's 51 and alongside
the legacy smoke 60 (all claw/litellm steps untouched, per #008 scoping):

- **`wizard/steps/52-opencode-client.sh`** — `opencode:local` image
  (idempotent: present + `OPENCODE_VERSION` pin matches → already done; the
  pin is read back from buildkit layer history, lenient when undeterminable
  so we never rebuild blind; mismatch → rebuild via plain `docker build`, not
  compose, so a missing `client/opencode/.env` can't break `${WORKSPACE}`
  interpolation). Tier configs are repo files that `oc` mounts at runtime —
  verified, never edited: each must exist, pin `"autoupdate": false` (#003
  TUI self-update finding) and dial its own tier port (#019 bug class).
  Client-only: prompts once for `OPENCODE_HOST` (state-cached), renders
  gitignored `opencode.remote{,.16,.32}.json` with `host.docker.internal`
  swapped for the LAN host (derived files: content-compared, re-rendered on
  host change — never stale).
- **`wizard/steps/53-opencode-prompt.sh`** — installs
  `host/llama-server/docs/system-prompt.md` → `~/.config/opencode/AGENTS.md`
  (the #001 winner, decision §2.6). Idempotent by content compare (`cmp`).
  Existing DIFFERENT file → **warn + leave as-is** (the .env never-clobber
  convention); empty/missing source → hard fail (no null prompt); non-regular
  file at the destination → hard fail (a directory would mount over the
  container path and inject nothing).
- **`wizard/steps/54-opencode-oc.sh`** — symlinks `~/.local/bin/oc` →
  `client/opencode/bin/oc` (the step-42 llama-server convention). Foreign
  `oc` at the target → warn + leave; dangling symlink → replaced; verifies
  `oc help` post-link; warns if `~/.local/bin` is off PATH.
- **`wizard/steps/61-opencode-smoke.sh`** — the new-stack smoke, both
  assertions through the installed wrapper: (1) **`oc probe`** — the #001
  deterministic wire-capture injection oracle (in-container mock captures the
  request body; greps `Instructions from: /root/.config/opencode/AGENTS.md`)
  — a fresh install cannot ship a null prompt; (2) **`oc run`** of a trivial
  file-write in a git-inited `mktemp -d` workspace, asserting
  `smoke.txt` contains a per-run token (scratch removed on pass, kept on
  fail). Client-only: smokes against `OPENCODE_HOST:OPENCODE_PORT` via the
  rendered remote config + `OC_SERVER_HOST`; unreachable LAN host → explicit
  `SKIPPED` with reason, rc=0.

Wiring: `cmd_install` runs 52/53/54 after 49 (hard-fail — a broken client
install must not be papered over), 61 after 60 (`|| true`, the step-60
precedent). `cmd_doctor` gained a read-only **"OpenCode client"** section:
image+pin, oc symlink target, prompt presence/content-match vs repo source,
tier configs. `wizard/README.md` "Files written" updated.

### Two `oc` (#003) fixes shipped alongside (in `client/opencode/bin/oc`)

1. **Symlink self-location bug (real, caught by the first smoke run):** #003
   claimed "symlink or copy to PATH both work", but `dirname BASH_SOURCE`
   resolved to the symlink's dir (`~/.local/bin`), breaking every
   COMPOSE_DIR path (`open ~/.local/docker-compose.yml: no such file`).
   Fixed with a readlink-following loop; `oc status/run/probe` verified
   through the symlink from `/tmp`.
2. **`OC_SERVER_HOST` (client-only enabler, additive/default-unchanged):**
   `green()` now checks `http://$OC_SERVER_HOST:$PORT/health`
   (default 127.0.0.1); a non-local host is health-checked but never
   lifecycled (red remote → exit 3 with guidance — oc can't launchctl
   another Mac).

### Fresh-install transcript (client half fresh: AGENTS.md + oc removed first; smoke green)

```
OpenCode client (image + tier configs)
  ✓ already done — opencode:local image present (pin 1.16.2)
  ✓  tier configs OK (autoupdate:false, ports 11436/11437/11438)
OpenCode global prompt (~/.config/opencode/AGENTS.md)
  ▸  installing repo system-prompt.md -> /Users/nigel/.config/opencode/AGENTS.md
  ✓  global prompt installed (1379 bytes)
oc wrapper on PATH (~/.local/bin/oc)
  ▸  symlinking /Users/nigel/.local/bin/oc -> .../client/opencode/bin/oc
  ✓  oc installed (`oc help` OK)
...
OpenCode smoke (injection probe + oc run)
  ▸  oc probe — asserting the global prompt reaches the agent system prompt
oc: probe PASS — agent system prompt contains 'Instructions from: /root/.config/opencode/AGENTS.md'
  ✓  injection PASS (wire capture saw the AGENTS.md attribution line)
  ▸  oc run (tier 64) — create smoke.txt in /tmp/wizard-oc-smoke.A8r6Ix
  ✓  oc run artifact verified — smoke.txt contains WIZARD-OC-SMOKE-38243
Done
```

(The image act path wasn't re-exercised live — `opencode:local` pin 1.16.2
was already correct; rebuild-on-mismatch is covered by selftest stubs.)

### Idempotent re-run (second `wizard install`, 17 "already done" lines)

```
  ✓ already done — opencode:local image present (pin 1.16.2)
  ✓ already done — AGENTS.md installed and matches repo system-prompt.md
  ✓ already done — oc -> /Users/nigel/Desktop/bench/mac-llm-lab-1/client/opencode/bin/oc
  ✓ already done — com.mac-llm-lab.opencode-server already loaded and healthy on :11436
... (smokes re-run by design, both green: injection PASS + WIZARD-OC-SMOKE-38642)
```

### oc from an arbitrary directory

`cd /tmp/oc-cli-test-007 && oc run "create ... OC-PATH-TEST-007"` → resolved
via PATH (`/Users/nigel/.local/bin/oc`), exit 0, `from-tmp.txt` =
`OC-PATH-TEST-007` on the host.

### client-only topology — VERIFIED (not skipped)

There is no second Mac in the lab, but the resident daemon binds `*:11436`,
so this machine's own LAN address (`192.168.1.209`) is a reachable "LAN
host" from inside a container (verified: `curl http://192.168.1.209:11436/health`
→ 200 from `opencode:local`). Install run with topology=client-only pointed
at it:

```
  ✓ already done — client-only topology — opencode serving lives on the host
  ▸  rendering client/opencode/opencode.remote.json (server host: 192.168.1.209)   (+ .16/.32)
OpenCode smoke (injection probe + oc run)
     client-only: smoking against LAN host 192.168.1.209:11436
oc: probe PASS ...
  ▸  oc run against 192.168.1.209:11436 — create smoke.txt ...
  ✓  oc run artifact verified — smoke.txt contains WIZARD-OC-SMOKE-39108
```

Rendered configs dialed `http://192.168.1.209:1143{6,7,8}/v1` — the
container's request genuinely traversed the LAN address, though client and
host are the same physical machine (honest caveat). The no-LAN-host SKIP
path is selftest-covered. State/configs restored afterward via a final
full-local run (smoke green again, `WIZARD-OC-SMOKE-39452`); remote configs
and `OPENCODE_HOST` removed.

### Tester suite

`wizard/tester/run-tests.sh`: +20 tests (image pin matrix, config
verification incl. missing-autoupdate rejection, remote render + idempotency
+ host-change re-render, prompt install/idempotency/never-clobber/null-source,
oc symlink install/idempotency/never-clobber/dangling-replace, smoke
preconditions + client-only explicit SKIP, 61-content gate in section 8).
Hot-sim hardened: `docker build` added to the REFUSED mutation list; curl
shim now echoes `200` (oc's `green()` reads `-w %{http_code}`). One latent
suite bug fixed: section 3 leaves `REPO_ROOT` pointing at a scratch dir —
reset at the top of the #007 block. **Selftest: 92/92 pass.**

### End state

claw :11435 = 200, litellm :4000 = 200, opencode tier-64 :11436 = 200 —
resident daemon **pid 31147 before and after every run** (never bounced);
:11437/:11438 quiet; `~/.config/opencode/AGENTS.md` = repo system-prompt.md
(1379 bytes); `~/.local/bin/oc` → repo wrapper; `wizard/.state` restored to
full-local tier-64; /tmp scratch cleaned. `wizard doctor` all-green on the
new client section.
