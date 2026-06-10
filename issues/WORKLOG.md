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
