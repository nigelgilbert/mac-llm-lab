# opencode-server lifecycle correctness: start waits green, restart grace, install parity, STARTED_OC ordering

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), findings 7/15, 14/15 and cut-C11 — inline
comments on <https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

Four defects in the `opencode-server` launcher and its driver interplay, all
one PR on `host/llama-server/scripts/opencode-server` +
`host/test/run-config-ab.sh`:

1. **`start` on a loading server hard-fails.** The already-running branch
   calls `cmd_health`, which `exit 1`s when /health isn't green yet — so
   `start` against a pidfile-live, still-loading server dies instead of
   waiting, while the fresh-boot path polls `wait_green` up to
   HEALTH_TIMEOUT. Make the already-running branch wait green too.

2. **Driver stops a server it never started.** run-config-ab.sh sets
   `STARTED_OC=1` *before* invoking start on the preflight-non-200 path;
   when (1) fires, `err` exits, and the trap's `STARTED_OC` check runs
   `opencode-server stop` against another owner's mid-load server via the
   shared per-tier pidfile — violating the stop-iff-I-started-it contract.
   Set STARTED_OC only after a start this driver performed succeeds.

3. **`restart` races itself.** `cmd_stop` is kill + pidfile-rm with no wait,
   so `cmd_start`'s lsof preflight sees the dying multi-GB server still on
   the port and dies "port already in use" — reliably failing and leaving
   nothing running. cmd_install's 10×1s port-release grace loop is in-repo
   acknowledgment of the lingering port; give stop a bounded `kill -0` wait
   (or restart the same grace loop).

4. **`install` render/poll parity.** The plist sed-render has no
   PORT/HOST placeholders (plists hardcode 11436/11437) while install's
   conflict check and `wait_green` use the `OPENCODE_LLAMA_PORT/HOST`
   overrides honored by cmd_start — so an install with a port override boots
   a healthy daemon on the default port and falsely dies polling the
   override. Either render the overrides into the plist or refuse overrides
   at install time with a clear message. (The validated-but-unrendered
   `OPENCODE_USE_GRAMMAR` knob points at a deleted GBNF — drop it or render
   it; dropping is consistent with the retired grammar arm.)

## Acceptance criteria

- [x] `start` invoked while a tier server is mid-load (pidfile live, health red) waits and exits 0 once green, instead of exiting 1
- [x] With a foreign-owned mid-load server, a failing driver preflight path does NOT stop that server (STARTED_OC stays 0; verify via the trap log)
- [x] `OPENCODE_TIER=16 opencode-server restart` on a loaded server succeeds end-to-end (old pid gone, new pid green) in one invocation
- [x] `OPENCODE_LLAMA_PORT=<nondefault> opencode-server install` either renders a plist that binds the override port and goes green, or fails fast pre-bootstrap with an explicit unsupported-override error — no 180s false-death
- [x] `grep OPENCODE_USE_GRAMMAR` returns only the chosen behavior (rendered or removed), with no reference to the deleted claw.gbnf

## Blocked by

None - can start immediately

## Result

Implemented 2026-06-10, all live evidence gathered against tiers 16/32 (resident
tier-64 on :11436 never touched — health-checked only, before/after: green, same
launchd pid 31147). bash 3.2.57 syntax-checked (`bash -n`), plists `plutil -lint` OK.

**Files changed**

- `host/llama-server/scripts/opencode-server` — defects 1, 3, 4 + grammar-knob removal
- `host/test/run-config-ab.sh` — defect 2 only (STARTED_OC ordering; surgical)
- `host/llama-server/launchd/com.mac-llm-lab.opencode-server{,-16}.plist` — comment-only:
  documents the no-port/host-placeholder choice; reworded deleted-claw.gbnf mention

**Design choices**

- Defect 4: **refuse** OPENCODE_LLAMA_PORT/HOST overrides at install time (pre-bootstrap,
  pre-preflight `die`) rather than render them — the launchd identity is fixed at the
  tier defaults by design; direct-boot `start` remains the override-friendly path.
  Implementation: `[[ "$PORT" != "$DEF_PORT" || "$HOST_BIND" != "0.0.0.0" ]]` (an
  explicit override equal to the default is allowed — parity holds).
- Grammar knob: **dropped** OPENCODE_USE_GRAMMAR entirely (var, preflight check,
  `--grammar-file` splice) — consistent with the retired grammar arm; a tombstone
  comment documents the removal.
- New knob: `OPENCODE_LLAMA_STOP_TIMEOUT` (default 30) — SIGTERM grace in `cmd_stop`
  before SIGKILL escalation, followed by the same 10×1s lsof port-release loop
  cmd_install uses.

**Per-AC evidence**

1. *start waits green on a mid-load server* — booted tier-16, froze the loading
   server with SIGSTOP to hold the mid-load state (`pid=65870 state=TN health=000`,
   pidfile live), invoked `start` from a second shell: it printed
   `already running (pid 65870) on :11437` / `/health not green yet — waiting up to
   180s for model load`, was still alive+waiting at t+8s with health still 000, then
   SIGCONT → `  /health green on :11437`, `SECOND-START exit=0`.
2. *STARTED_OC stays 0 on a failed start* — booted tier-32 manually (foreign owner),
   froze it mid-load (`pid=66121 health=000`), ran
   `OPENCODE_LLAMA_HEALTH_TIMEOUT=5 TIER=32 ./host/test/run-config-ab.sh`. Driver log:
   `==> starting oc-32 server on :11438...` → `ERROR: running server (pid 66121) did
   not reach green /health within 5s` → `ERROR: oc-32 server failed to reach green
   /health` → `[cleanup] restoring lab state (driver rc=1)...` with **zero**
   `stopping oc-32` lines (grep -c = 0). Post-exit: `kill -0 66121` succeeded
   (foreign server survived), after SIGCONT it was serving HTTP again (503 = still
   loading, alive and undisturbed). No stray registry file from the failed run.
3. *restart end-to-end* — with tier-16 green (pid 65332):
   `OPENCODE_TIER=16 opencode-server restart` → `stopped opencode-server (was pid
   65332)` → `starting opencode-server (tier-16, ...)` → `/health green on :11437`,
   exit 0 in one invocation (2.2s wall, warm cache); old pid 65332 gone, new pid
   65459 alive + health=200. No "port already in use" — cmd_stop's bounded kill-0
   wait + port-release grace closed the race.
4. *install override → fail fast pre-bootstrap* —
   `OPENCODE_LLAMA_PORT=12345 OPENCODE_TIER=16 opencode-server install` →
   `ERROR: install does not support OPENCODE_LLAMA_PORT/HOST overrides: the tier-16
   plist hardcodes :11437 on 0.0.0.0 (got port=12345 host=0.0.0.0). Unset the
   override(s), or use direct-boot 'start' which honors them.` — exit 1 in 0.4s
   (vs the old 180s false-death); same for `OPENCODE_LLAMA_HOST=127.0.0.1`. No plist
   rendered, no launchd bootstrap (tier-16 agent confirmed not loaded after).
5. *grammar knob* — `grep -rn OPENCODE_USE_GRAMMAR` over the repo: the launcher's
   only hit is the removal tombstone; no claw.gbnf reference remains in the launcher
   or plists. Remaining hits are this issue file and
   `host/test/docs/OPENCODE-SIDECAR-PORT-HANDOFF.md` (historical handoff doc, outside
   this issue's file ownership — describes the knob as it existed; flagged upstream).

**Residual notes**

- STARTED_OC semantics now: set to 1 only after `opencode-server start` (invoked by
  this driver) returns 0. If the launcher's already-running branch *adopts* a server
  another owner booted (pidfile live) and waits it green, the driver still sets
  STARTED_OC=1 and will stop it at cleanup — ownership via the shared per-tier
  pidfile is inherently ambiguous; out of scope here, noted for the Tranche-2
  driver agent.
- The unit suite was not run: no JS under host/test/lib|scripts|__tests__ was touched
  by this issue, and sibling agents were mid-flight on those files.
