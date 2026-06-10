# Injection probe: do global prompt mechanisms work in a git-rooted workspace?

**Type**: AFK

**Status:** 🔲 Not started

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

- [ ] 4-arm result table (global-AGENTS.md / instructions[] / control / committed-AGENTS.md), each arm's PROOF outcome recorded, all run in git-rooted workspaces on tier-64
- [ ] Control shows no PROOF and committed-AGENTS.md shows PROOF (oracle validity)
- [ ] Winning mechanism named in the issue Result section; decision doc §2.6 updated with one status line
- [ ] Lab left as found: oc servers stopped, claw `:11435` green

## Blocked by

None - can start immediately
