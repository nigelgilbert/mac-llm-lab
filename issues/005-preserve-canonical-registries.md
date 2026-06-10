# Preserve the canonical run registries in-repo

**Type**: AFK

**Status:** ✅ Complete

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

- [x] Three registries committed under `host/test/docs/data/` with a README; `git ls-files` shows them tracked
- [x] Each file's row count matches its source (e.g. tier-16 final = 512 rows; sidecar-port = 1025 → **actually 1024 on disk and by design; see Result**)
- [x] `config-ab-verdict.mjs` run against the committed copies reproduces the headline CIs verbatim (one command per file in the README, outputs pasted in the Result section)

## Blocked by

None - can start immediately

## Result

Completed 2026-06-10 (staged, not committed — orchestrator commits).

### Files (all byte-identical `cp` of the `.claw-runtime/` sources, verified with `cmp`; tracked per `git ls-files`)

| committed file (`host/test/docs/data/`) | source (`host/test/.claw-runtime/`) | rows | backs |
|---|---|---|---|
| `run_registry.config-ab-20260606-165548.jsonl` | same name (cited in OPENCODE-AB-FINAL-REPORT.md §8 repro block as `REG64`) | **512** = 2×32×8 (matches report §4 "Rows 512") | tier-64 final verdict |
| `run_registry.config-ab-20260607-062848.jsonl` | same name (§8 repro block `REG16`) | **512** = 2×32×8 | tier-16 final verdict + §6.3 normalized CI |
| `run_registry.sidecar-port-20260610.jsonl` | same name (handoff RESULT section) | **1024** = 4×32×8 | sidecar-port sweep (all 5 RESULT-table rows) |
| `README.md` | — | — | source→report→command mapping |

No `.gitignore` exception was needed: the only relevant rule is
`host/test/.gitignore: .claw-runtime/`, which does not match `docs/data/`
(`git check-ignore` exits 1 on all four paths).

### Row-count note (the ticket's "sidecar-port = 1025" was wrong)

The sweep registry is **1024** rows: 256 per arm × 4 arms (`claw-rig`,
`opencode-a`, `opencode-a+git`, `opencode-a+prompt`), i.e. the 512-row #019
tier-16 registry reused via `SKIP_PHASE_A` + 2 new arms × 32 × 8. Verified
with `grep -c ''` (file ends with a newline; no undercount) and a per-arm
`uniq -c`. The "1025" presumably counted the lone 2026-06-09 smoke row, which
lives in the separate, uncommitted
`.claw-runtime/run_registry.sidecar-port-smoke-20260609.jsonl` (513 rows:
512 + 1 `opencode-a+prompt` smoke) and backs no published number. tier-64's
expected count, derived from report §4 ("Rows 512 = 2×32×8"): **512** — matches.

### Verdict reproduction against the COMMITTED copies (2026-06-10, image `mac-llm-lab-test:local`)

All CIs reproduce the published numbers **verbatim** (seeded bootstrap:
B=10000, seed `0xc0ffee`). `DR="docker run --rm -v $PWD:$PWD -w $PWD/host/test
--entrypoint node mac-llm-lab-test:local"`, run from repo root.

**tier-64** — `$DR scripts/config-ab-verdict.mjs docs/data/run_registry.config-ab-20260606-165548.jsonl --tier 64`

```
rows     : 512  (tier 64: 512)
aggregate delta    : +3.1pp  (opencode-a − claw-rig)
90% paired-bootstrap CI: [0.8, 6.3]pp
ratio (opencode-a median / claw-rig median): 0.61×  ≤ 1.5×  →  MET
claw-rig    256 rows  {...}  → 254 eligible ; opencode-a → 256 eligible
→ RETIRE the claw rig at this tier (opencode-a is superior on pass-rate AND faster)
```

Published (report §4 / decision doc): +3.1pp [+0.8,+6.3], 0.61×, eligible 254/256 — **verbatim match**.

**tier-16** — `$DR scripts/config-ab-verdict.mjs docs/data/run_registry.config-ab-20260607-062848.jsonl --tier 16`

```
rows     : 512  (tier 16: 512)
aggregate delta    : -7.7pp  (opencode-a − claw-rig)
90% paired-bootstrap CI: [-13.1, -2.5]pp
ratio (opencode-a median / claw-rig median): 0.96×  ≤ 1.5×  →  MET
claw-rig → 239 eligible (17 harness_error context_overflow dropped) ; opencode-a → 256 eligible
→ KEEP the claw rig at this tier
```

Published: −7.7pp [−13.1,−2.5], 0.96×, eligible 239/256 — **verbatim match**.
§6.3 sensitivity (`config-ab-normalized-ci.mjs … --tier 16`): canonical
`-7.74pp [-13.06, -2.51]`, normalized `-5.47pp [-10.94, 0.00]` — **verbatim
match** to the report's §6.3 table.

**sidecar-port** — `$DR scripts/config-ab-verdict.mjs docs/data/run_registry.sidecar-port-20260610.jsonl --tier 16 [--treatment …] [--baseline …]`, all four handoff RESULT comparisons:

```
(default: opencode-a vs claw-rig)            : -7.7pp  CI [-13.1, -2.5]pp        (replication)
--treatment opencode-a+git                   : -8.1pp  CI [-13.9, -2.3]pp        (control)
--treatment opencode-a+prompt --baseline opencode-a+git : +6.6pp CI [3.1, 10.2]pp (prompt effect; SUPERIOR)
--treatment opencode-a+prompt                : -1.5pp  CI [-6.4, 3.5]pp ; wall 20.8s vs claw 24.4s = 0.85× → KEEP
```

Plus `config-ab-normalized-ci.mjs … --treatment opencode-a+prompt`:
canonical `-1.49pp [-6.44, 3.53]`, normalized `+0.78pp [-3.91, 5.86]`
(non-inferiority MET under the normalized rule).

Published (handoff RESULT table): −7.7 [−13.1,−2.5] / −8.1 [−13.9,−2.3] /
+6.6 [+3.1,+10.2] / −1.5 [−6.4,+3.5] @ 0.85× / normalized +0.8 [−3.9,+5.9] —
**verbatim match, all five rows**.

### Staged (not committed)

```
A  host/test/docs/data/README.md
A  host/test/docs/data/run_registry.config-ab-20260606-165548.jsonl
A  host/test/docs/data/run_registry.config-ab-20260607-062848.jsonl
A  host/test/docs/data/run_registry.sidecar-port-20260610.jsonl
```
