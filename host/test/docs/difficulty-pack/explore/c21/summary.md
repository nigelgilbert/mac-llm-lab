# Sprint 1.21 Explore — Cycle 21

Generated 2026-05-04T04:11:32.000Z from `run_registry.explore-c21-20260503-2013.jsonl` (35 rows).

Tiers in this cycle: 16, 64.  Tests: 6.

## Per-cell pass-rate matrix

| test_id | t16 pass | t16 status | t64 pass | t64 status |
|---|---|---|---|---|
| `book-store` | 0% (0/3) | 3e | 67% (2/3) | clean |
| `two-bucket` | 67% (2/3) | 1e | 67% (2/3) | 1t |
| `wordy` | 33% (1/3) | 2e | 100% (3/3) | clean |
| `needle-haystack` | 67% (2/3) | 1e | 0% (0/2) | 1t 1e |
| `word-search` | 67% (2/3) | 1t | 100% (3/3) | clean |
| `twelve-file-refactor` | 67% (2/3) | 1e | 100% (3/3) | clean |

Status legend: `Nt`=timeouts, `Nh`=harness_error, `Ne`=error, `Nn`=passed=null. 'clean' means all `done`.

## R1–R6 calibration flags (per-cell)

| test_id | tier | R1 floor/ceil | R2 timeout | R3 harn-err | R4 null-pass | R5 iter-storm | R6 sat | p90 iters | p90 elapsed (ms) |
|---|---|---|---|---|---|---|---|---|---|
| `book-store` | t16 | ⚠️ |  |  |  |  |  | 13 | 155312 |
| `book-store` | t64 |  |  |  |  |  |  | 5 | 45371 |
| `two-bucket` | t16 |  |  |  |  |  |  | 13 | 113722 |
| `two-bucket` | t64 |  | ⚠️ |  |  |  |  | 16 | 795790 |
| `wordy` | t16 |  |  |  |  |  |  | 23 | 468183 |
| `wordy` | t64 | ⚠️ |  |  |  |  | ⚠️ | 22 | 757188 |
| `needle-haystack` | t16 |  |  |  |  |  |  | 17 | 204869 |
| `needle-haystack` | t64 | ⚠️ | ⚠️ |  |  |  |  | 4 | 1246691 |
| `word-search` | t16 |  | ⚠️ |  |  |  |  | 9 | 4570782 |
| `word-search` | t64 | ⚠️ |  |  |  |  | ⚠️ | 4 | 40877 |
| `twelve-file-refactor` | t16 |  |  |  |  |  |  | 25 | 520758 |
| `twelve-file-refactor` | t64 | ⚠️ |  |  |  |  | ⚠️ | 13 | 65003 |

R1: 0/N or N/N pass.  R2: ≥25% timeouts.  R3: any harness_error.  R4: >20% passed=null.  R5: p90 iters > 25.  R6: pass-rate > 85%.

## Failing-cell snapshots

One iterations.jsonl head+tail (60 lines each end) per failing cell, for analyze-agent to inspect failure modes without pulling the full trace.

| test_id | tier | run_id | snapshot | terminal_status |
|---|---|---|---|---|
| `book-store` | t16 | `2fdf140e-a0a9-4c2c-8f30-114625cf3247` | [snapshots/book-store.t16.jsonl](snapshots/book-store.t16.jsonl) | error |
| `book-store` | t64 | `42dbabdf-bbcc-414b-8b73-4b0ba2e95388` | [snapshots/book-store.t64.jsonl](snapshots/book-store.t64.jsonl) | done |
| `two-bucket` | t16 | `5c9fcb1d-8c6e-4e2c-9da7-cfac6dd32da4` | [snapshots/two-bucket.t16.jsonl](snapshots/two-bucket.t16.jsonl) | error |
| `two-bucket` | t64 | `9fad9602-f438-4ecc-af86-e9e8d0545ac8` | [snapshots/two-bucket.t64.jsonl](snapshots/two-bucket.t64.jsonl) | timeout |
| `wordy` | t16 | `f170abb0-0877-4799-9d34-114a401250e0` | [snapshots/wordy.t16.jsonl](snapshots/wordy.t16.jsonl) | error |
| `needle-haystack` | t16 | `52cffe27-ddb5-4135-8085-fac4b9a8fe1b` | [snapshots/needle-haystack.t16.jsonl](snapshots/needle-haystack.t16.jsonl) | error |
| `needle-haystack` | t64 | `9809dfab-fe87-48c1-867b-8445658d8e91` | [snapshots/needle-haystack.t64.jsonl](snapshots/needle-haystack.t64.jsonl) | error |
| `word-search` | t16 | `3e243a87-df08-4998-8392-ed78d029e098` | [snapshots/word-search.t16.jsonl](snapshots/word-search.t16.jsonl) | timeout |
| `twelve-file-refactor` | t16 | `686b0620-73a1-496e-a774-7ea08c8946fc` | [snapshots/twelve-file-refactor.t16.jsonl](snapshots/twelve-file-refactor.t16.jsonl) | error |

## Tweak-allowed scope (for analyze-agent)

**ALLOWED edits** (within `host/test/__tests__/tier-eval/` and `host/test/docs/difficulty-pack/`):
- Prompt-string clarifications, examples, or disambiguation
- Verifier assertion-message improvements
- Loosening over-strict spec clauses (e.g., specific sort order → "any order")
- Removing genuinely-ambiguous test cases (with rationale)
- Manifest field updates (e.g., `expected_tier_signature` flip after pilot evidence)
- Updates to `mutations.md`, `PLAN.md`, or `1.21-handsolve-log.md` to reflect the tweak

**NOT ALLOWED** (require user sign-off):
- Cutting a test (write recommendation to `1.21-cycle-N-recommendations.md` instead)
- Adding new test files (no H5)
- Modifying `lib/*.js`, `lib/model_configs.json`, anything in `scripts/`, or `canonicals/`
- Raising `CLAW_TIMEOUT` (legitimate-looking shortcut that hides spec problems)
- Swapping picks from the runner-up bench (deeper-pass concern)

## Reference

- [PLAN.md](../../PLAN.md) — engineering plan (R1–R8 reject criteria, calibration protocol)
- [mutations.md](../../mutations.md) — per-pick mutation specs
- [1.21-handsolve-log.md](../../1.21-handsolve-log.md) — design intent + estimated hand-solve per test
- [memos/aider-calibration-note.md](../../memos/aider-calibration-note.md) — runner-up swap protocol (informational)
