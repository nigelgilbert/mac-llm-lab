# Resident tier-64 opencode-server under launchd

**Type**: AFK

**Status:** 🔲 Not started

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

- [ ] `launchctl` shows the opencode-server service loaded; `/health` green on the tier-64 port after `launchctl kickstart` and after a reboot-equivalent (bootout + bootstrap)
- [ ] Thinking-off verified via the established `/apply-template` closed-think-block check
- [ ] On-demand tiers still start/stop cleanly via the script (one smoke start/stop of tier-16)
- [ ] claw `:11435` green throughout and after

## Blocked by

None - can start immediately
