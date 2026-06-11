# Sprint 1.21 — Good tests from the difficulty pack

**As of:** 2026-05-04 (post-c21 N=3 confirmatory sweep, t16 + t64)
**Branch:** feature/harder-test-suite-1

Five-cell corpus after the c21 N=3 haircut. Earlier single-rep evidence has been re-graded against the wider sample. Claims are **softer than c20's writeup** — variance at small N is real and several cells flipped between reps. Promotions and demotions called out per cell.

| # | cell | what it gives us | c21 N=3 evidence (t16 / t64) | claim |
|---|---|---|---|---|
| 1 | `book-store` | strongest tier discriminator in the corpus | **0/3 / 2/3** — clean t16 floor with reasonable t64 ceiling (1 t64 fail at 55s, normal-shape) | promoted: clean tier discriminator |
| 2 | `wordy` | clean monotonic tier discriminator | **1/3 / 3/3** — t16 floors hard, t64 perfect | clean tier discriminator |
| 3 | `twelve-file-refactor` v3 | weak monotonic discriminator (debug-capacity class) — split-config + per-currency fractions | **2/3 / 3/3** — single t16 fail showed iter-storm cycling 4 format.js rewrites (c19 evidence still load-bearing); t64 perfect | weak monotonic; lineage notes carry the saturation-defeat story (c1/c2 saturated v1; c18 v2 saturated; c19 v3 split fraction-digit count into currency-config.js with JPY/KRW=0, BHD/KWD=3; defeat = iter-storm + claw error at t16) |
| 4 | `word-search` v2.1 | weak monotonic discriminator (debug-capacity class) — dual prefix+suffix anchors, array return | **2/3 / 3/3** — single t16 fail was the c21 76-min SSE deadlock, not difficulty (filed: [`bridge-sse-deadlock.md`](../../../litellm/docs/bridge-sse-deadlock.md)). True t16 difficulty signal is closer to 1/3, possibly tighter once the SSE deadlock is fixed | weak monotonic; rerun once runtime stabilizes |
| 5 | `two-bucket` | softest cell — flat across tiers under N=3 | **2/3 / 2/3** — c21 saw one t64 timeout (285s claw-timeout, normal path); single-rep priors (c3+c4 t16 0-1/3, t32 3/3) didn't replicate. Claim is "weak signal, possibly variance-only" until a wider-N rerun lands | downgraded: candidate tier-sensitivity probe pending wider-N evidence |
| 6 | `needle-haystack` v4 | re-entered 2026-06-11 (post-migration re-base) — weak/ceilinged; latency-shape signal only | **oc-stack re-base: t16 3/3 / t64 5/5** (t16 includes one pass via a 277s timeout-grazing iter-storm). The c21 inversion (t16 2/3, t64 0/2 with 8.6s error + 21-min SSE deadlock + lost row) is GONE on the OpenCode stack — it was claw-bridge infra, not model signal. t16 no longer floors, so the cell is NOT a tier discriminator; remaining signal is wall/iter shape (t16 1/3 at the runner ceiling vs t64 all ≤97s). Caveat: re-base is a different harness bundle (oc runner + #001 oracle; t16 arm = `opencode-a+prompt`), N=5/3 — not a paired comparison. Full evidence: [needle-haystack-t64-inversion.md](../usability-pack/memos/needle-haystack-t64-inversion.md), 2026-06-11 addendum | re-entered with weak claim; its `keep_drop_rule` (drop if t16 ≥85% across two consecutive confirmatory sweeps) is live — one sweep already counts; drop-candidate pending one more confirmatory N≥5 sweep |

(`needle-haystack` history: moved out to `frontier/` 2026-05-04 on the c21 inversion — the paragraph this row replaces; `frontier/` itself was deleted by migration #010 and the test was recovered from git `df50d21~1` + ported to the runAgent convention for the re-base.)

## Set aside — under redesign review

`ini-parser`. Saturates cleanly across the lineage but has a defeasible saturation strategy worth a v2 redesign attempt (see triage 2026-05-03):

- `ini-parser` (~5/noisy/4): true saturation low; t32 number is suspected bridge SSE noise (1250s→13s collapse), now backed by the c21 [bridge-sse-deadlock.md](../../../litellm/docs/bridge-sse-deadlock.md) finding. Defeat path: schema-validation requiring multi-pass / backtracking. Re-confirm noise hypothesis once the SSE deadlock is resolved before redesigning.

## Removed (structural — no defeat path)

Deleted from `__tests__/tier-eval/` 2026-05-03:
- `grade-school` — pure bookkeeping spec, no algorithmic depth to attack.
- `count-power-of-two` — reference brute O(N² log) is always viable at relaxed N≤100; tightening N breaks the <10-min hand-solve rule.
- `cascade-eight` — flat at ~30-33 iters across all 3 tiers (c8 evidence). Expensive but not a tier discriminator. (c7 t64 failure was N=1 sampling variance, not signal.)

Orphans cleaned up at the same time: removed from `host/test/scripts/explore-cycle.sh` `NEW_TESTS` allowlist; `canonicals/grade-school/` directory deleted (the other two had no canonicals).
