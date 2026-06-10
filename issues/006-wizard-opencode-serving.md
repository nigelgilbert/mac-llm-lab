# Wizard: opencode serving steps (resident daemon + per-tier configs)

**Type**: AFK

**Status:** ✅ Complete

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.5, §3.3.

## What to build

Teach the wizard to provision the OpenCode serving layer the way #002 builds
it by hand: a step that installs/loads the launchd resident server for the
detected tier (corrected template, thinking-off, tier sampler from
models.conf) and verifies health, in the wizard's pure-bash, curl-only,
strictly idempotent check-then-act style ("✓ already done" on re-run; never
bootout a running service). The existing model-fetch and llama-server steps
stay; this step replaces the claw-server's role for new installs. Both
topologies (full-local / client-only) must keep working — client-only skips
serving entirely.

Do not remove the litellm/clawcode steps yet (that's #008's edit); this issue
only adds the opencode serving path so a fresh install can produce the new
stack's host half.

## Acceptance criteria

- [x] `./wizard/wizard install` on this machine reaches a green opencode resident server step; second run prints the idempotent "already done" path (transcript in Result)
- [x] `./wizard/wizard doctor` reports the opencode serving state read-only
- [x] Tier slider override provisions the corresponding tier's config (verified for one non-default tier without leaving its server resident)
- [x] client-only topology run skips serving with no error

## Blocked by

- #002

## Result

**Done 2026-06-10.** New step `wizard/steps/51-opencode-server.sh`
(`step_51_main`), wired into `cmd_install` after the full-local host block
(claw steps 47/48/49 untouched, per #008 scoping) and into `cmd_doctor` as a
read-only "OpenCode serving" section. Step-level tests added to
`wizard/tester/run-tests.sh` (selftest: **70/70 pass**, including the
never-bootout contract for step 51). One pre-existing bug fixed in
`wizard/lib/probe.sh`: `tester_run` passed `/smoke.sh "$mode"` to an image
whose ENTRYPOINT is already `/smoke.sh`, so every tester probe failed with
`unknown mode: /smoke.sh` since the wizard's first commit; with the fix,
steps 44/50/60 go green.

Step semantics (mirrors step 47's mid-eval safety contract):
- already-done = launchd label loaded (`launchctl print gui/$UID/<label>`)
  AND `curl :PORT/health` green → `✓ already done`, never invokes
  `opencode-server install` (which bootouts as part of its handover).
- loaded-but-unhealthy → warn + hands off (model may be loading).
- otherwise → `OPENCODE_TIER=<tier> host/llama-server/scripts/opencode-server
  install` (renders plist from models.conf: corrected template, thinking-off
  kwarg, tier sampler; waits green), then a curl-only `/apply-template` probe
  asserts the system-not-first fix + closed `<think></think>` prefill live.
- tier-32: on-demand only by design (decision §2.5) — config provision check
  (binary + GGUF + corrected template), no daemon ever installed.
- client-only topology: skips before touching anything.
- Records `OPENCODE_PORT` / `OPENCODE_TIER` in `wizard/.state` for the
  client-side steps (#007).

### Install run 1 (full-local, tier 64 — resident daemon already green, untouched)

```
OpenCode serving (resident llama-server, tier 64)
  ✓ already done — com.mac-llm-lab.opencode-server already loaded and healthy on :11436
     refusing to call `launchctl bootout` on a running service
...
Final smoke test
  [tester] ✓ /v1/models returned 19 model(s)
  ✓  stack is alive — /v1/models returned models via the bridge
Done
```

### Install run 2 (idempotent re-run — identical skip path, daemon pid unchanged)

```
OpenCode serving (resident llama-server, tier 64)
  ✓ already done — com.mac-llm-lab.opencode-server already loaded and healthy on :11436
     refusing to call `launchctl bootout` on a running service
```

`launchctl print` before/after both runs: same `pid = 31147` — the resident
daemon was never restarted. claw :11435 and litellm :4000 returned 200
throughout. 16 "already done" lines on the re-run.

### `wizard doctor` (read-only)

```
OpenCode serving (read-only)
  ✓  opencode tier-64 — launchd loaded, /health green on :11436
     opencode tier-16 — not resident (:11437 quiet)
     opencode tier-32 — not running (on-demand only; no launchd path by design)
```

(`launchctl print` + `curl GET /health` only — no mutation.)

### Tier slider override (tier 16, then restored)

```
  default 64 — press Enter or pick number:   ✓  tier: 16
...
OpenCode serving (resident llama-server, tier 16)
  ▸  invoking opencode-server install (tier 16, :11437)
bootstrapped: com.mac-llm-lab.opencode-server-16 on :11437 (.../LaunchAgents/com.mac-llm-lab.opencode-server-16.plist)
  /health green on :11437 — launchd state: loaded (pid 34083)
  ✓  opencode-server healthy on :11437 (com.mac-llm-lab.opencode-server-16)
  ▸  probing live template (system-not-first fix + thinking-off prefill)
  ✓  template probe passed (corrected template, closed <think></think>)
```

Rendered plist verified: port 11437, `Qwen3.5-9B-IQ4_XS.gguf`, tier-16
sampler from models.conf (`--temp 0.6`, `--repeat-penalty 1.1`),
`qwen35-corrected.jinja`, `--chat-template-kwargs {"enable_thinking":false}`.
tier-64 :11436 stayed green (pid 31147) during the entire tier-16 lifecycle.
Cleanup: `OPENCODE_TIER=16 opencode-server uninstall` → :11437 down (000),
plist removed, no listeners on :11437/:11438; machine restored to
tier-64-resident-only and `wizard/.state` restored via a final full-local
tier-64 run (skip path).

### client-only topology

```
  default full-local — press Enter or pick number:   ✓  topology: client-only (LAN host)
...
OpenCode serving (resident llama-server, tier 16)
  ✓ already done — client-only topology — opencode serving lives on the host
```

rc=0; serving skipped with no error. (The final claw-bridge smoke probe can't
resolve `mac-llm-lab.local` via mDNS from inside the orb — pre-existing
client-only tester limitation, unrelated to serving; install still exits 0.)

### End state

claw :11435 = 200, litellm :4000 = 200, opencode tier-64 :11436 = 200
(pid 31147, never restarted); :11437/:11438 quiet; LaunchAgents contains only
`com.mac-llm-lab.llama-server.plist` + `com.mac-llm-lab.opencode-server.plist`.
