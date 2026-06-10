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

### #003 — ✅ complete

- `client/opencode/bin/oc` (bash, self-locating): TUI on $PWD by default,
  `oc run "<prompt>"` headless, `oc probe` (wire-capture injection oracle,
  no llama-server needed), `oc status`. Tier via `-t 16|32|64`/OPENCODE_TIER.
- Exit codes: 1 usage/no-TTY, 2 injection precondition failed, 3 server not
  green. Prompt source: OC_PROMPT_FILE → ~/.config/opencode/AGENTS.md →
  repo system-prompt.md; bind-mounted ro at /root/.config/opencode/AGENTS.md.
- Server semantics: never bootout a live tier-64; tiers 16/32 on-demand,
  stopped on exit iff oc started them (OC_KEEP_SERVER=1 to keep).
- Verified: hello.txt via resident server (2.7 s); PTY-driven TUI wrote a
  file to host $PWD; `oc probe` PASS; `oc -t 16` boot/run/auto-stop; 4
  fail-loud paths exit 2 before any container starts.
- Fix en route: TUI auto-updated to 1.17.3 inside the pinned 1.16.2
  container → `autoupdate:false` in all three tier configs (+ new
  opencode.32.json). #007 must install these configs as-is.

### T3 coherence check — PASS (interfaces for #007 ready)

- Health green, ports clean, no stray containers; changes scoped to
  client/opencode/ + ticket.
- #007 consumes: `oc` symlink/copy to PATH (self-locating), wizard prompt
  install target ~/.config/opencode/AGENTS.md (oc already prefers it),
  `oc probe` as the smoke's injection assertion, step-51 state keys from
  #006.

## T4 — started 2026-06-10

- #007 wizard-opencode-client-smoke (launched)

### #007 — ✅ complete

- New wizard steps: 52 (opencode:local image, pin-checked; client-only
  renders gitignored opencode.remote*.json against OPENCODE_HOST),
  53 (repo system-prompt → ~/.config/opencode/AGENTS.md, cmp-idempotent,
  warn-don't-clobber), 54 (~/.local/bin/oc symlink, step-42 convention),
  61 (new-stack smoke: `oc probe` wire-capture assertion + `oc run`
  artifact in a fresh git workspace). Doctor: read-only client section.
- Tester 92/92 (+20 tests); second install fully idempotent (17 "already
  done" lines); resident daemon pid 31147 unchanged across five runs.
- **Cross-issue catch:** #003's "symlink to PATH works" was false (dirname
  didn't follow symlinks) — fixed in bin/oc with a readlink loop; also
  added additive OC_SERVER_HOST (remote servers health-checked, never
  lifecycled) enabling client-only.
- client-only verified via this machine's real LAN IP (192.168.1.209) —
  caveat: same physical machine, no second Mac available.

### T4 coherence check — PASS

- All seven autonomous tickets ✅ with evidence. Health: claw 200, oc-64
  200, litellm 401-auth (up); :11437/:11438 free; `~/.local/bin/oc status`
  green from /tmp (prompt installed + content-OK, server green).
- Holistic state: a fresh `wizard install` now produces the complete new
  stack (serving 51 + client 52–54 + smoke 61) without touching claw;
  `oc` is daily-driver-ready for #004.

## PAUSE POINT — context for /compact and final verification

**Done (commits):** T1 48e9db3 (#002 #005 #009) · T2 9bf5593 (#001 #006) ·
T3 b769849 (#003) · T4 = this commit (#007).

**Remaining:** #004 (HITL — user does a real task via `oc`, records
go/no-go; gates everything below) → #008 (gut claw: tag claw-stack-final,
delete claw prod stack, also needs #005 ✓ #007 ✓) → #010 (harness
opencode-native, needs #008 + #009 ✓) → #011 (tier-32 smoke, needs #007 ✓
+ #010).

**System state at pause:** resident oc-64 daemon :11436 green (launchd,
pid 31147); claw :11435 + litellm :4000 still co-resident (until #008);
:11437/:11438 free; `~/.local/bin/oc` + `~/.config/opencode/AGENTS.md`
installed; images `opencode:local` (1.16.2, autoupdate off) and
`mac-llm-lab-eval-runner:local` built.

**Deviations/corrections registry (final verification should re-check):**
1. #005 — sidecar-port canonical registry is 1024 rows, ticket said 1025
   (smoke row in a separate non-canonical file). README documents it.
2. #009 — "reuse-registry mode" criterion verified in default
   fresh-registry mode instead (REGISTRY_OUT split-file gotcha). If a
   literal reuse-registry run is wanted, lift the restriction for
   SKIP_PHASE_A=1 only.
3. #001 — behavioral PROOF oracle failed known-positive validation;
   wire-capture oracle is the instrument of record. FINDING-2's bare-dir
   "global no-ops" row corrected (was a behavioral false negative).
4. #002 — tier-32 support added to opencode-server (ticket interface
   implied it); #003 added opencode.32.json. Pre-wires #011.
5. #003→#007 — #003's symlink-to-PATH claim was wrong; fixed during #007.
   Final verification should re-run `oc` via the symlink, not in-repo.
6. #006 — pre-existing wizard probe.sh ENTRYPOINT bug fixed (out of
   ticket scope, wizard-internal).
7. #007 — client-only smoke traversed real LAN IP but same physical
   machine; image rebuild act-path covered by selftest stubs only.

**Suggested final-verification sweep (post-#004):** (a) re-walk each
ticket's acceptance boxes against its Result evidence; (b) fresh
`wizard install` + `wizard doctor` transcript; (c) `oc run` + `oc probe`
via the PATH symlink from a brand-new git repo; (d) tester suite;
(e) re-derive one registry CI from host/test/docs/data; (f) confirm claw
co-residence untouched (pre-#008 baseline for the gut).

**#004 handoff (user):** use `oc` for one real piece of work in a real
repo; capture friction list; record explicit go/no-go for #008 in the
ticket. `oc` is on PATH; `oc help` for usage; tier-16/32 via `-t`.

## #004 — ✅ GO (2026-06-10, HITL)

User-driven manual acceptance; full log in
[004-acceptance-log.md](004-acceptance-log.md). Four daily-driver exercises
from a throwaway repo (`~/Desktop/bench/oc-toy`), tier 64 `:11436`, both paths:
greenfield `oc run` (hello.py), TUI `is_prime`+unittest (user: "works well"),
and the canonical bugfix loop — planted an unreachable FizzBuzz `% 15` branch;
agent read→ran tests red→correct root cause→most-specific-first reorder→4/4
green. Artifact: `oc-toy` commit `8d58ca8`.

Friction: **zero blocker-grade** → no follow-up issues. Nits only (no `python`
alias in container — agent self-corrected to `python3` each time; `__pycache__`
committed in toy repo, not an oc concern). Wins: `oc status` preflight, mount
round-trips both ways, host artifacts owned `nigel:staff`.

**Decision: GO.** #008 (gut claw) is **unblocked** → then #010 (opencode-native
harness, needs #008+#009✓) → #011 (tier-32 smoke, needs #007✓+#010). claw stack
no longer gated bootable.

## T5 — started 2026-06-10 (post-#004 GO)

#004 HITL passed: GO recorded in ticket + acceptance log. Remaining graph
is strictly serial: #008 → #010 → #011 (one agent per tranche).

- #008 gut-claw-stack (launched)
