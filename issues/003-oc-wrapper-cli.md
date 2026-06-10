# `oc` wrapper CLI: one command from any repo to the agent

**Type**: AFK

**Status:** ✅ Complete (2026-06-10) — `client/opencode/bin/oc`; see [Result](#result)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.10, §3.2.

## What to build

A small wrapper command (`oc`) that makes the containerized OpenCode feel
native:

- asserts the resident tier-64 server is green (starts it via the launchd
  service if not), then
- runs the OpenCode container with `$PWD` mounted at `/workspace`, the
  tier-matched opencode config, and the prompt-delivery mechanism chosen by
  #001 — interactive TUI by default, `oc run "<prompt>"` for headless,
- selects tier via flag/env (`oc -t 16 …` boots the on-demand tier first),
- **fails loud if prompt injection preconditions are missing** (e.g. not in a
  git repo when the per-repo mechanism is in play) — injection failure is
  silent in OpenCode, so the wrapper owns the assertion.

Container-first is architectural (decision 4): the wrapper hides the
container, it does not replace it. The sandbox walls protect everything
outside the mounted workspace; the workspace itself is the agent's to edit.

## Acceptance criteria

- [x] From an arbitrary git repo: `oc run "create hello.txt containing hi"` produces the file, with the resident server, in one command with no manual setup
- [x] TUI session opens via bare `oc` and tool calls operate on `$PWD`
- [x] Prompt injection verified end-to-end once via the PROOF oracle through the wrapper itself — *per #001's correction the flaky behavioral PROOF check was replaced by the deterministic wire-capture oracle; implemented as `oc probe` (see Result)*
- [x] `oc -t 16` boots the tier-16 server on demand and runs against it; server stopped after (or documented as left up) — **stopped after** (iff `oc` started it; `OC_KEEP_SERVER=1` to keep)
- [x] Running outside the preconditions (per #001's mechanism) exits non-zero with an explanatory message

## Blocked by

- #001
- #002

## Result

**Shipped: [`client/opencode/bin/oc`](../client/opencode/bin/oc)** (bash, no deps
beyond docker/curl/launchctl; PATH-installable by #007 as a symlink or copy —
it resolves its own location, so both work). Plus
[`opencode.32.json`](../client/opencode/opencode.32.json) (tier-32 :11438
config, previously missing) and `"autoupdate": false` in all three tier
configs (see finding below). All verified with real runs on 2026-06-10.

### Interface

```
oc                       interactive TUI on $PWD            (needs a TTY; exit 1 otherwise)
oc run "<prompt>" [...]  headless one-shot                  (args passed to `opencode run`)
oc probe                 injection wire-capture oracle      (no llama-server needed)
oc status                tier server health + resolved prompt/config
oc -t 16|32|64 …         tier select (env OPENCODE_TIER; flag wins; default 64)
oc --ports …             publish compose ports (8080) — off by default (claw holds 8080 until #008)
```

Env: `OC_PROMPT_FILE` (prompt source override), `OPENCODE_CONFIG_JSON`
(config escape hatch for probes/sweeps), `OC_KEEP_SERVER=1`.
Exit codes: `0` ok / opencode passthrough; `1` usage / no TTY; `2` prompt-injection
precondition failed; `3` server not green.

Prompt source resolution (host side): `OC_PROMPT_FILE` →
`~/.config/opencode/AGENTS.md` (wizard-installed, decision §2.6) if present →
repo source `host/llama-server/docs/system-prompt.md`. The resolved file is
bind-mounted read-only at `/root/.config/opencode/AGENTS.md` (the #001
winner), alongside the tier `opencode.json` mount. Banner line states tier,
port, workspace and prompt origin on every run.

Server semantics: tier-64 green → untouched; red+launchd-loaded → **wait**
for green (never bootout a live service); red+not-loaded →
`opencode-server install`. Tiers 16/32: green → left untouched (not ours);
red → `opencode-server start`, and an EXIT trap **stops it after the
session** iff `oc` started it (decision §2.5 "boot on demand, stop after").

Fail-loud preconditions (all exit 2 with an explanation): prompt source
missing, unreadable, **empty (0 bytes)**, or **a directory** (both mount
cleanly and inject nothing — identified silent modes); tier/override config
missing (compose would silently fall back to the tier-64 config and dial the
wrong port — the #019 bug class). Not-a-git-repo is a *note*, not a failure:
#001's bonus finding showed global AGENTS.md injects in bare dirs too.

### Verification evidence (all through the wrapper, real runs)

1. **Headless from an arbitrary git repo** — fresh `/tmp/oc-test-repo`
   (`git init` + seed commit), `oc run "create hello.txt containing hi"`:
   exit 0 in **2.7 s**, `hello.txt` = `hi` on the host, resident `:11436`
   served it (launchd pid 31147, fresh `slot release` in its log; server
   never restarted). Re-verified after the `autoupdate:false` config change.
2. **TUI on `$PWD`** — PTY-driven via `expect`: bare `oc` enters the
   alternate screen (`ESC[?1049h` captured), titlebar `OpenCode`, status line
   shows the mounted tier-64 config ("Qwen3.6 35B-A3B Q4_K_XL (tier-64,
   alias: opencode)"); typing `create tui.txt containing tui-hi` + Enter ran
   a `Write tui.txt` tool call and **`/tmp/oc-test-repo/tui.txt` = `tui-hi`
   appeared on the host**. Limitation honestly noted: scripted PTY, not a
   human session; interactive feel not assessed (that's §3.2's "real work"
   exit criterion). Bare `oc` without a TTY exits 1 with guidance.
3. **Injection end-to-end** — `oc probe` (the #001 deterministic wire-capture
   oracle, substituted for the flaky behavioral PROOF check per #001's
   Result): temp workspace + temp config dialing an in-container
   `127.0.0.1:9099` node mock that records `/v1/chat/completions` bodies;
   same compose service + same AGENTS.md mount as normal runs;
   `opencode run "say hi"` → capture contains
   `Instructions from: /root/.config/opencode/AGENTS.md` → **PASS**, exit 0.
   Probe needs no llama-server (model-independent by design).
4. **`oc -t 16`** — booted tier-16 on `:11437` on demand (green in-run),
   `hello16.txt` = `hi16` created by the 9B, then the wrapper **stopped the
   server on exit**: `:11437` → 000, pidfile gone. Documented behavior:
   stop-after iff oc started it; `OC_KEEP_SERVER=1` keeps it; a pre-existing
   green tier-16 server is left untouched.
5. **Fail-loud** — four simulated precondition failures, each exit 2 with an
   explanatory message: `OC_PROMPT_FILE=/tmp/does-not-exist.md` (missing),
   empty file, directory path, and `OPENCODE_CONFIG_JSON=/tmp/nope.json`
   (missing config). No container was started in any failure case.

### Finding: TUI self-update broke the version pin (fixed)

First TUI session popped an "Update Available — update now?" modal which
swallowed the Enter keystroke and self-updated OpenCode to **v1.17.3 inside
the pinned-1.16.2 container** ("Please restart the application"), silently
un-pinning the image mid-session (ephemeral — `--rm` discards it — but every
TUI session would re-update and first-keystroke-hijack). Fixed with
`"autoupdate": false` in `opencode.json` / `opencode.16.json` /
`opencode.32.json`; banner absent and typed prompt executed correctly on the
re-run. Headless `opencode run` was never affected.

### End state (lab as found)

claw `:11435` green; resident `:11436` green (same launchd pid 31147
throughout — never bounced); `:11437`/`:11438` free; no opencode containers;
`/tmp` test workspaces, probe dirs and PTY captures removed (probe cleans its
own dir on pass, keeps it on fail for debugging). Tier-32 is wired
(config + port + on-demand path share the tier-16 code path) but was not
booted here — tier-32 smoke is rewrite-plan §3.6 / wizard scope.
