# Injection probe: do global prompt mechanisms work in a git-rooted workspace?

**Type**: AFK

**Status:** ✅ Complete (2026-06-10) — **winner: global `~/.config/opencode/AGENTS.md`**; see [Result](#result)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.6, §3.1 — the gate on decision 6 (prompt delivery).

## What to build

Re-run the strong-model injection oracle (the FINDING-2 method from
OPENCODE-SIDECAR-PORT-HANDOFF.md §2/§5) in a **git-rooted** workspace, for the
two repo-external delivery mechanisms that were only ever proven to no-op in
*bare* directories:

1. global `~/.config/opencode/AGENTS.md` (mounted into the container)
2. `instructions: [...]` in the opencode config

Oracle: AGENTS.md/instructions content carries a MANDATORY "create
`PROOF_<token>.txt` as your FIRST action" rule; run a trivial task on the
tier-64 35B (a capable model obeys iff injected); check whether PROOF appears.
Test each mechanism independently, plus a no-mechanism control (no PROOF
expected) and the known-positive committed-AGENTS.md arm (PROOF expected) to
validate the oracle both ways.

The outcome decides the prompt-delivery mechanism for the `oc` wrapper and the
wizard: global if either mechanism injects; otherwise fall back to committed
per-repo AGENTS.md. Record the result table in the issue and in the decision
doc's §2.6 (a one-line status update there is the exception to "don't modify
the parent": the decision explicitly awaits this gate).

## Acceptance criteria

- [x] 4-arm result table (global-AGENTS.md / instructions[] / control / committed-AGENTS.md), each arm's PROOF outcome recorded, all run in git-rooted workspaces on tier-64
- [x] Control shows no PROOF and committed-AGENTS.md shows PROOF (oracle validity) — control 0/3 PROOF ✓; committed-AGENTS.md PROOF appeared (1/3 behaviorally) ✓, but obedience proved stochastic, so a stronger wire-level oracle was added (see Result §oracle-deviation)
- [x] Winning mechanism named in the issue Result section; decision doc §2.6 updated with one status line
- [x] Lab left as found: resident `:11436` green (launchd daemon, per #002 — left running by design), on-demand oc servers (`:11437`/`:11438`) down, claw `:11435` green, no leftover probe containers, host `~/.config/opencode` untouched (never existed; all mounts came from `/tmp`)

## Blocked by

None - can start immediately

## Result

**Winner: global `~/.config/opencode/AGENTS.md`** (decision rule: global if either
repo-external mechanism injects — both do).

Setup: tier-64 35B-A3B on the resident `:11436` daemon (#002), OpenCode 1.16.2
(`opencode:local`), fresh git-rooted workspace per arm (`git init` + `add -A` +
seed commit, the exact `seedWorkspaceGit` sequence), fresh container per arm/run
via `docker compose run --rm`, distinct PROOF token per arm
(`PROOF_GLOBAL_K7Q` / `PROOF_INSTR_M3X` / `PROOF_COMMIT_Z9R`; no
cross-contamination observed). Task: the #009 trivial file-write.

| arm (git-rooted, tier-64) | wire oracle: rule in agent system msg? | behavioral: PROOF file created | injected? |
|---|---|---|---|
| global `~/.config/opencode/AGENTS.md` (bind-mounted into the container config dir, same pattern as `opencode.json`) | **YES** — `Instructions from: /root/.config/opencode/AGENTS.md` | **3/3** | ✓ |
| `instructions: ["/root/.config/opencode/inject.md"]` in opencode config | **YES** — `Instructions from: /root/.config/opencode/inject.md` | 0/3 | ✓ |
| control (no mechanism) | no (no `Instructions from:` block, no token anywhere in any request) | 0/3 | ✗ |
| committed per-repo `AGENTS.md` (known positive) | **YES** — `Instructions from: /workspace/AGENTS.md` | 1/5 | ✓ |

**Oracle deviation (recorded honestly).** The FINDING-2 *behavioral* oracle
failed initial validation: the known-positive committed-AGENTS.md arm produced
no PROOF in its first 2 runs. Debugging with an **in-container localhost mock
endpoint** (captures the actual `/v1/chat/completions` request bodies to
`_capture.jsonl`; sidesteps the macOS-firewall problem that killed the
handoff's host-side mock) showed the rule WAS in the agent system prompt — the
35B simply disobeys the MANDATORY-first-action rule stochastically at temp 0.7
(~1/5 obedience for that arm; rule placement is identical for all three
mechanisms, char ~9017 of ~9890, between `<env>` and the skills block).
**"A capable model reliably obeys iff injected" is falsified on the reliability
half** — so the deterministic wire-level capture is the primary oracle here,
validated both ways (committed arm: rule present; control: absent), with the
behavioral matrix retained as secondary evidence. Directionally the behavioral
gate still holds: control 0/3, committed 1/3 in the final matrix.

**Bonus finding (corrects FINDING-2's scope).** The same wire oracle in a
**bare** (non-git) workspace shows global `~/.config/opencode/AGENTS.md`
**still injects** (`Instructions from: /root/.config/opencode/AGENTS.md`,
6 request bodies). FINDING-2's bare-dir "global mount no-ops" row was a
behavioral false negative of exactly the disobedience mode above. The git-root
requirement applies to **project** `AGENTS.md` discovery, not to global-config
rules — i.e. the winning mechanism is not even gated on a git-rooted
workspace. (Workspaces still SHOULD be git for OpenCode snapshots etc.; this
just removes a failure mode from the `oc` wrapper.)

**Implication for #003 (`oc` wrapper) / wizard:** bind-mount the installed
prompt at `/root/.config/opencode/AGENTS.md` alongside `opencode.json` (same
mount pattern); fail loud if the host source file is missing/unreadable
(injection failure is silent); assert injection at install/smoke time with the
capture probe — grep `Instructions from: /root/.config/opencode/AGENTS.md` out
of a mock-endpoint request body — which is deterministic and model-independent,
rather than the flaky behavioral PROOF check.

Evidence artifacts (gitignored, `/tmp`): `/tmp/inj-probe-001/<arm>/ws`
(behavioral workspaces), `<arm>/wscap/_capture.jsonl` (wire captures),
`global/wsbare/_capture.jsonl` (bare-dir bonus), `debug/opencode.capture*.json`
(mock-endpoint configs).
