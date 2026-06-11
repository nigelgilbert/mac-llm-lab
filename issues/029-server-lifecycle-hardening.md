# opencode-server lifecycle hardening: pidfile identity, start lock, REPEATS guard, KeepAlive, wizard red branch

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), serving findings 1–4, 6, 14. Process-lifecycle
trust edges in `host/llama-server/scripts/opencode-server` and its
install/launchd surroundings, before the stack hardens into daily-driver
infrastructure.

## What to build

1. **Pidfile identity check.** `running_pid()` only does `kill -0`; a
   stale pidfile pointing at a recycled PID makes `start` falsely report
   "already running" and — worse — `stop` SIGTERM-then-SIGKILL an
   innocent process. Validate identity before acting (e.g. `ps -p $pid
   -o command=` must match the binary/`--port $PORT`); treat a mismatch
   as a stale pidfile to remove.

2. **start/start race.** Two concurrent `start`s (plausible: `oc -t 16`
   and the sweep driver both auto-boot on-demand tiers) can both pass
   the pidfile+lsof preflight; the loser clobbers the winner's pidfile,
   leaving the live server unmanageable. Wrap start/stop in the per-tier
   mkdir-lock pattern already proven in `rotate-opencode-server-log.sh`.

3. **REPEATS=0 vacuous PASS.** `validate-tool-calls.sh` with `REPEATS=0`
   prints `RESULT: PASS (all 0 runs...)`. The caller guards its own
   knob, but the engine is the right home: assert REPEATS is a positive
   integer in `validate-tool-calls.sh` itself.

4. **sed plist rendering.** The `s|__GGUF_PATH__|$GGUF|g` substitutions
   corrupt the rendered plist if a models.conf path contains `|` or `&`.
   Escape the replacement (or render via plutil/python).

5. **KeepAlive crash-loop.** Both plists use unconditional
   `KeepAlive=true` + `ThrottleInterval=10`: a stale GGUF path respawns
   a ~21 GB load attempt every ~10s forever into an unrotated /tmp log.
   Switch to `KeepAlive={Crashed:true, SuccessfulExit:false}` and/or a
   larger throttle.

6. **Wizard 51 loaded-but-red branch.** A crash-looping daemon reads as
   "loaded but not healthy" and the step returns 0 anyway, deferring the
   failure to the step-61 smoke's 240s wait. Poll briefly, then fail the
   step with the daemon's last log lines. (Cosmetic, same area: step 61's
   header comment still describes the retired attribution-line oracle;
   update to the sentinel oracle.)

## Acceptance criteria

- [x] Stale-pidfile scenario (write a live-but-unrelated PID into the pidfile): `status`/`start` report stale and recover; `stop` does NOT signal the unrelated PID
- [x] Two `start`s raced in parallel (`start & start`): exactly one server, one coherent pidfile, loser exits with a clear message; `stop` then works
- [x] `REPEATS=0 validate-tool-calls.sh ...` exits non-zero with the guard message
- [x] Plist rendered from a path containing `&` passes `plutil -lint`
- [x] launchd unit with a deliberately bad GGUF path does not respawn-loop indefinitely (observe ≤2 attempts, or documented throttle behavior)
- [x] wizard step 51 against the bad-GGUF daemon fails the step (non-zero) with log context; clean install path unchanged
- [x] Resident tier-64 daemon and `oc probe` green after the changes

## Blocked by

None - can start immediately
