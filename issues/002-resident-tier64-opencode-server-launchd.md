# Resident tier-64 opencode-server under launchd

**Type**: AFK

**Status:** ✅ Complete (2026-06-10)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.5, §3.2.

## What to build

Make the tier-64 OpenCode llama-server (35B-A3B, corrected Jinja template,
thinking-off kwarg, v1-prod sampler) a login-persistent launchd service — the
new "always green" daily serving daemon, playing the role `:11435` plays
today. The `com.mac-llm-lab.opencode-server.plist` template already exists;
finish/verify the `opencode-server` script's launchd path (install, load,
health-wait) rather than ad-hoc start/stop.

Keep the on-demand path for the other tiers unchanged (`OPENCODE_TIER=16|32
opencode-server start|stop`). Do NOT touch the existing claw `:11435` service
— co-residence until the gut (#008).

Document the memory budget note: 35B resident ≈ 21 GB alongside claw's until
#008 removes the latter.

## Acceptance criteria

- [x] `launchctl` shows the opencode-server service loaded; `/health` green on the tier-64 port after `launchctl kickstart` and after a reboot-equivalent (bootout + bootstrap)
- [x] Thinking-off verified via the established `/apply-template` closed-think-block check
- [x] On-demand tiers still start/stop cleanly via the script (one smoke start/stop of tier-16)
- [x] claw `:11435` green throughout and after

## Blocked by

None - can start immediately

## Result

Implemented 2026-06-10 on this box (real launchd state, branch
`experiment/opencode`). The tier-64 resident server is **left running** —
it is the new daily serving daemon.

### What changed

- `host/llama-server/scripts/opencode-server`
  - `install` now finishes the launchd path: stops any direct-boot instance
    of its own tier (handover), boots out a stale label, waits for the port
    to free (refusing if a *foreign* process holds it — never touches
    `:11435`), renders + bootstraps the plist, then **waits for green
    `/health`** (shared `wait_green()` helper, `HEALTH_TIMEOUT` default 180 s,
    also used by `start`).
  - `uninstall` now also removes the rendered plist from
    `~/Library/LaunchAgents/`.
  - `status` is launchd-aware: reports direct-boot pid, launchd label state
    (`launchd_state()` via `launchctl print gui/$UID/$LABEL`), and `/health`.
  - Added `OPENCODE_TIER=32` (same 9B as tier-16 at Q5_K_XL → same
    `qwen35-corrected.jinja`; `:11438`, alias `opencode-32`,
    `/tmp/opencode-llama-server-32.{log,pid}`; on-demand only, no plist —
    the ticket's stated on-demand interface is `OPENCODE_TIER=16|32`).
  - Header documents the roles (tier-64 resident vs 16/32 on-demand) and the
    **memory budget**: 35B-A3B ≈ 21 GB resident, co-residing with claw's
    identical-weights `:11435` server (~21 GB more) until #008 — accepted
    interim cost of build→prove→gut.
- `host/llama-server/launchd/com.mac-llm-lab.opencode-server.plist` —
  comment updated: promoted to the resident daily daemon (decision §2.5 /
  this issue), same memory-budget note. ProgramArguments unchanged
  (corrected jinja, `--chat-template-kwargs '{"enable_thinking":false}'`,
  v1-prod sampler from models.conf tier-64, no grammar).

### Evidence (commands + key output)

1. **Install + load + health-wait**
   `./scripts/opencode-server install` →
   `bootstrapped: com.mac-llm-lab.opencode-server on :11436 (~/Library/LaunchAgents/...)`
   … `/health green on :11436 — launchd state: loaded (pid 31054)`.
   Rendered plist carries the v1-prod sampler (`--temp 0.7 --top-p 0.8
   --top-k 20 --repeat-penalty 1.0 --presence-penalty 1.5`).
2. **kickstart**: `launchctl kickstart -k gui/$UID/com.mac-llm-lab.opencode-server`
   → new pid 31092, `/health 200` (instant — 21 GB GGUF warm in page cache);
   claw `:11435 200`.
3. **Reboot-equivalent**: `launchctl bootout gui/$UID/com.mac-llm-lab.opencode-server`
   → label gone from `launchctl list`, `/health 000`; then
   `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mac-llm-lab.opencode-server.plist`
   → new pid 31147, `/health 200`; `launchctl list` shows
   `31147 0 com.mac-llm-lab.opencode-server` alongside
   `80680 0 com.mac-llm-lab.llama-server` (claw, untouched).
4. **Thinking-off probe** (`./scripts/opencode-server probe`, all PASS):
   system-not-first fix; closed `<think>\n\n</think>` on a plain
   `/apply-template` request (launch default); closed prefill under explicit
   per-request `chat_template_kwargs.enable_thinking:false` (#017 form).
   Live-inference sanity: `/v1/chat/completions` → `'OK'`.
5. **On-demand smoke**: `OPENCODE_TIER=16 opencode-server start` → green on
   `:11437` (pid 31211); `status` → running+green, launchd not loaded;
   `stop` → `:11437` unreachable after. Bonus tier-32 smoke:
   start → green on `:11438`, probe all-PASS, stop clean.
6. **claw green throughout**: `:11435` returned 200 at every checkpoint
   (before install, after kickstart, after bootout+bootstrap, after tier-16
   and tier-32 smokes, final). Final co-residence footprint: opencode
   RSS ≈ 21.9 GB, claw RSS ≈ 17.3 GB, system 54 % free (RSS double-counts
   shared mmap pages of the identical GGUF).

Left running: `com.mac-llm-lab.opencode-server` on `:11436` (RunAtLoad +
KeepAlive — survives logout/reboot). Tier-16/32 stopped.
