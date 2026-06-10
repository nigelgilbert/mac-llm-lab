# Preserve the canonical run registries in-repo

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.3, §3.4.

## What to build

Copy the three canonical registries — tier-64 final, tier-16 final, and the
sidecar-port sweep (the exact files cited in OPENCODE-AB-FINAL-REPORT.md §
repro block and the sidecar handoff RESULT section) — from
`host/test/.claw-runtime/` into a tracked `host/test/docs/data/` directory,
with a short README mapping each file to the report it backs and the verdict
command that re-derives its numbers. This is a deliberate, scoped exception
to the `.claw-runtime`-is-gitignored convention so every published number
stays re-derivable after the gut deletes the claw stack.

## Acceptance criteria

- [ ] Three registries committed under `host/test/docs/data/` with a README; `git ls-files` shows them tracked
- [ ] Each file's row count matches its source (e.g. tier-16 final = 512 rows; sidecar-port = 1025)
- [ ] `config-ab-verdict.mjs` run against the committed copies reproduces the headline CIs verbatim (one command per file in the README, outputs pasted in the Result section)

## Blocked by

None - can start immediately
