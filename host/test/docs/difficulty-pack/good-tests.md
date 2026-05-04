# Sprint 1.21 — Good tests from the difficulty pack

**As of:** 2026-05-04 (post-c21 N=3 confirmatory sweep, t16 + t64)
**Branch:** feature/harder-test-suite-1

Five-cell corpus after the c21 N=3 haircut. Earlier single-rep evidence has been re-graded against the wider sample. Claims are **softer than c20's writeup** — variance at small N is real and several cells flipped between reps. Promotions and demotions called out per cell.

| # | cell | what it gives us | c21 N=3 evidence (t16 / t64) | claim |
|---|---|---|---|---|
| 1 | `book-store` | strongest tier discriminator in the corpus | **0/3 / 2/3** — clean t16 floor with reasonable t64 ceiling (1 t64 fail at 55s, normal-shape) | promoted: clean tier discriminator |
| 2 | `wordy` | clean monotonic tier discriminator | **1/3 / 3/3** — t16 floors hard, t64 perfect | clean tier discriminator |
| 3 | `twelve-file-refactor` v3 | weak monotonic discriminator (debug-capacity class) — split-config + per-currency fractions | **2/3 / 3/3** — single t16 fail showed iter-storm cycling 4 format.js rewrites (c19 evidence still load-bearing); t64 perfect | weak monotonic; lineage notes carry the saturation-defeat story (c1/c2 saturated v1; c18 v2 saturated; c19 v3 split fraction-digit count into currency-config.js with JPY/KRW=0, BHD/KWD=3; defeat = iter-storm + claw error at t16) |
| 4 | `word-search` v2.1 | weak monotonic discriminator (debug-capacity class) — dual prefix+suffix anchors, array return | **2/3 / 3/3** — single t16 fail was the c21 76-min SSE deadlock, not difficulty (filed: usability-pack [bridge-sse-deadlock.md](../usability-pack/memos/bridge-sse-deadlock.md)). True t16 difficulty signal is closer to 1/3, possibly tighter once the SSE deadlock is fixed | weak monotonic; rerun once runtime stabilizes |
| 5 | `two-bucket` | softest cell — flat across tiers under N=3 | **2/3 / 2/3** — c21 saw one t64 timeout (285s claw-timeout, normal path); single-rep priors (c3+c4 t16 0-1/3, t32 3/3) didn't replicate. Claim is "weak signal, possibly variance-only" until a wider-N rerun lands | downgraded: candidate tier-sensitivity probe pending wider-N evidence |

## Moved to usability — tooling probe

`needle-haystack` v4. Authored as a t16 ctx-overflow (R9-A) probe on c11 single-rep evidence. c21 N=3 sweep showed it **inverts** — t16 2/3, t64 0/2 with one fast 8.6s error and one 21-minute SSE deadlock (and one missing registry row entirely). A test that fails worse at the higher tier is not a model-capability signal; it is surfacing t64 runtime instability. Test file relocated to [__tests__/tier-eval/frontier/needle-haystack.test.js](../../__tests__/tier-eval/frontier/needle-haystack.test.js); dropped from `explore-cycle.sh` `NEW_TESTS` allowlist; full evidence + suggested audits in [needle-haystack-t64-inversion.md](../usability-pack/memos/needle-haystack-t64-inversion.md). May re-enter the pack on a future t64 plist that doesn't show the inversion.

## Set aside — under redesign review

`ini-parser`. Saturates cleanly across the lineage but has a defeasible saturation strategy worth a v2 redesign attempt (see triage 2026-05-03):

- `ini-parser` (~5/noisy/4): true saturation low; t32 number is suspected bridge SSE noise (1250s→13s collapse), now backed by the c21 [bridge-sse-deadlock.md](../usability-pack/memos/bridge-sse-deadlock.md) finding. Defeat path: schema-validation requiring multi-pass / backtracking. Re-confirm noise hypothesis once the SSE deadlock is resolved before redesigning.

## Removed (structural — no defeat path)

Deleted from `__tests__/tier-eval/` 2026-05-03:
- `grade-school` — pure bookkeeping spec, no algorithmic depth to attack.
- `count-power-of-two` — reference brute O(N² log) is always viable at relaxed N≤100; tightening N breaks the <10-min hand-solve rule.
- `cascade-eight` — flat at ~30-33 iters across all 3 tiers (c8 evidence). Expensive but not a tier discriminator. (c7 t64 failure was N=1 sampling variance, not signal.)

Orphans cleaned up at the same time: removed from `host/test/scripts/explore-cycle.sh` `NEW_TESTS` allowlist; `canonicals/grade-school/` directory deleted (the other two had no canonicals).
