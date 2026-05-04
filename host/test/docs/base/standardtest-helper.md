# Memo: lib/standardTest.js control-flow helper — 2026-05-02

The 26 (now 38) tier-eval tests duplicate ~40 lines of boilerplate
(workspace reset, seed write, runClaw, post-script, writeAssertionResult,
timeout guard, assertion chain). Sprints 1.10 and 1.16a both required
mechanical regex sweeps across 20–32 files to land cross-cutting changes
— the duplication is real technical debt. A `runStandardTest({prompt,
seedFiles, targetFile, verifyJs, timeoutMs})` helper would collapse each
test body to ~15 lines.

**Why deferred from 1.21:** the sprint's gate is the difficulty-pack
authoring, not harness refactoring. Landing the helper concurrently
would (a) trigger a `docker compose build test` rebuild on the critical
path, (b) risk helper-API churn during the first wave of new test
authoring, and (c) mix two diffs that are easier to review separately.
Migrate in 1.22 or 1.23 against the full 38-test surface; verify with
`expected-attempts.mjs` diff = 0/0 on a t64 N=1 sweep before/after.

Fixture *content* (`VERIFY_JS` / seed-file template literals) stays
inline per test, not in a shared `fixtures/` directory — license posture
on Aider/Exercism-derived seeds, plus self-containment.

Status tracked in
[`TIER-EVAL-V2-SPRINT-PLAN.md`](TIER-EVAL-V2-SPRINT-PLAN.md)
row 1.22.
