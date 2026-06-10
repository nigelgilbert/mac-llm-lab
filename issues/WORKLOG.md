# OpenCode migration — implementation worklog

Orchestrated implementation of issues/001–011 (2026-06-10).
Maintained by the orchestrator; one entry per tranche, plus coherence-check
notes. Agents verify their own acceptance criteria and record evidence in
each issue's Result section; this file is the cross-issue narrative.

## Plan

Dependency-driven tranches (AFK issues only; #004 is HITL and gates
#008 → #010 → #011, so the autonomous run pauses there):

- **T1 (parallel):** #002 resident tier-64 launchd server · #005 preserve
  canonical registries · #009 baked eval-runner image
- **T2 (parallel):** #001 injection probe (git-rooted, against the resident
  server) · #006 wizard opencode serving step
- **T3:** #003 `oc` wrapper CLI
- **T4:** #007 wizard client steps + end-to-end smoke
- **Pause:** prepare /compact context + final-verification briefing; hand
  #004 (daily-driver acceptance) to the user. #008/#010/#011 resume after
  the #004 go/no-go.

Scheduling notes: #001 serialized behind #002 (both contend for the tier-64
server; post-#002 the resident daemon is the new "lab as found" green
state). Agents do not commit; the orchestrator commits at tranche
boundaries after an interface-coherence check.

## T1 — started 2026-06-10

Launched in parallel:
- #002 resident-tier64-opencode-server-launchd
- #005 preserve-canonical-registries
- #009 baked-eval-runner-image

(awaiting agent reports)

### #005 — ✅ complete (first to finish)

- Three registries committed-path'd under `host/test/docs/data/` + README
  (six re-derivation commands documented, incl. the two normalized-ci
  sensitivities); staged, byte-identical to sources, `git ls-files` green.
- All headline CIs reproduce **verbatim** from the committed copies
  (tier-64 RETIRE +3.1pp [0.8, 6.3]; tier-16 KEEP −7.7pp [−13.1, −2.5];
  sidecar-port all four comparisons + normalized).
- **Correction to ticket:** sidecar-port canonical registry is **1024 rows**
  (256 × 4 arms), not 1025 — the stray count included a 2026-06-09 smoke row
  from a separate, non-canonical file. Documented in README + ticket Result.
- No .gitignore exception needed (`docs/data/` was never ignored).

### #002 — ✅ complete

- `host/llama-server/scripts/opencode-server` launchd path finished:
  `install` = direct-boot handover → stale-label bootout → port-free wait →
  render+bootstrap → health-wait; plus `uninstall`, launchd-aware `status`.
- Resident tier-64 daemon **left running** (the new daily green):
  label `com.mac-llm-lab.opencode-server`, port `:11436`, RunAtLoad+KeepAlive,
  plist rendered to `~/Library/LaunchAgents/`.
- Verified: kickstart + bootout/bootstrap cycles → /health 200; probe PASS
  (closed think block both launch-default and per-request kwarg); tier-16
  on-demand smoke clean on `:11437`; claw `:11435` green throughout.
- Co-residence footprint measured: opencode ≈21.9 GB RSS + claw ≈17.3 GB,
  54% free.
- Deviation: added `OPENCODE_TIER=32` (`:11438`, on-demand only) — ticket's
  stated interface promised it, script rejected it; smoke-verified. Pre-wires
  part of #011.
- Interface for #003/#006/#007: script subcommands
  `{start|stop|restart|status|health|probe|install|uninstall}`; tiers
  64/16/32 → ports 11436/11437/11438; containers reach the host via
  `host.docker.internal:11436`.

### #009 — ✅ complete

- `host/test/Dockerfile.runner` + compose `runner` service (build profile);
  image `mac-llm-lab-eval-runner:local` (445 MB), driver knob `RUNNER_IMAGE`.
- Phase B startup: **49s → ≤1s** (apk-add eliminated); one-cell tier-16
  driver run fully green, zero `apk` lines in the sweep log; missing-image
  preflight fails loud with build hint. 137/137 lib tests pass inside image.
- Mount contract (path-matched repo mount, /workspace bind, docker.sock,
  FATAL visibility check) preserved verbatim.
- **Deviation (tracked for final verification):** acceptance said
  "reuse-registry mode", which requires REGISTRY_OUT — prohibited by the
  known split-file gotcha and denied by the permission layer. Verified in
  default fresh-registry mode instead; throwaway registries only.

### T1 coherence check — PASS (committed 48e9db3)

- Daemons: claw `:11435` 200, resident oc-64 `:11436` 200; `:11437/:11438`
  free; `:4000` LiteLLM still up (expected until #008).
- launchd: `com.mac-llm-lab.opencode-server` + claw `llama-server` both
  running, exit code 0.
- File changes disjoint across the three issues; all tickets ✅ with
  evidence; registries tracked per `git ls-files`.
- Interfaces compose: #002's `opencode-server` subcommand/port contract is
  what #003 (`oc` asserts/starts resident server) and #006 (wizard step)
  consume; containers reach the host at `host.docker.internal:11436`.
  #009's `RUNNER_IMAGE` knob is the seam #010 will keep.

## T2 — started 2026-06-10

Launched in parallel (both consume the resident `:11436` daemon read-only):
- #001 injection-probe-git-rooted-global-prompt
- #006 wizard-opencode-serving

(awaiting agent reports)

### #006 — ✅ complete

- New `wizard/steps/51-opencode-server.sh` (numbered to follow 47 once #008
  retires 48/49): already-done = label loaded AND /health green → "✓ already
  done", **never bootouts a green service**; act path = `opencode-server
  install` + curl-only /apply-template probe (system-not-first + closed
  think block). Tier-32 = config-provision check only; client-only skips.
- `wizard` entrypoint: step wired into `cmd_install` (after host block,
  before 49); `cmd_doctor` gained read-only OpenCode serving section.
- Verified: two install runs green, daemon pid 31147 untouched; tier-16
  slider exercised the act path on :11437 then cleaned up; client-only rc=0;
  tester 70/70.
- Interface for #007: step 51 precedes client steps; writes `OPENCODE_PORT`/
  `OPENCODE_TIER` to `wizard/.state` (full-local only).
- Bonus fix: pre-existing `wizard/lib/probe.sh` bug (ENTRYPOINT double-arg)
  that failed every tester probe; steps 44/50/60 now green.
- Pre-existing, noted: client-only orb smoke fails on mDNS (not ours).

### #001 — ✅ complete (gate resolved)

- **Winner: global `~/.config/opencode/AGENTS.md`** — both repo-external
  mechanisms inject in git-rooted workspaces; decision doc §2.6 updated.
- **Oracle correction:** FINDING-2's behavioral PROOF oracle failed its
  known-positive validation (35B obeys "MANDATORY first action" only
  stochastically, ~20–60%). Replaced with a wire-level capture oracle
  (in-container 127.0.0.1 mock capturing /v1/chat/completions bodies),
  validated both ways (committed: rule present; control: absent).
- **Scope correction to FINDING-2:** global AGENTS.md injects even in BARE
  dirs — git-root gates only project-AGENTS.md discovery. De-risks #003.
- Consequence for #003/#007: smoke/injection assertions must use the
  wire-capture probe, NOT behavioral PROOF. `oc` must bind-mount the prompt
  at /root/.config/opencode/AGENTS.md and fail loud if the host source file
  is missing.
- Lab as found: :11436 + :11435 green, no stray containers, host
  ~/.config/opencode untouched. Evidence under /tmp/inj-probe-001/.

### T2 coherence check — PASS

- Health: claw 200, oc-64 200, :11437/:11438 free. Tree changes disjoint
  (#001: docs+ticket; #006: wizard). Both tickets ✅ with evidence.
- Composition for T3 (#003): serving contract (#002) + global-AGENTS.md
  delivery + wire-capture assertion (#001). For T4 (#007): step-51 ordering
  + wizard/.state keys (#006) + same delivery mechanism (#001).

## T3 — started 2026-06-10

- #003 oc-wrapper-cli (launched)
