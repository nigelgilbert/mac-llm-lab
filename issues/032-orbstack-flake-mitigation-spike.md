# Spike: characterize the OrbStack workspace-mount flake and decide the mitigation

**Type**: AFK (a time-boxed investigation ending in a written options memo +
recommendation; running it needs no human interaction. The go/no-go on
whether to *build* a mitigation is a HITL decision, **out of scope here** —
and any implementation it justifies spawns a separate ticket.)

**Status:** 🔲 Not started

## Parent

#019 (workspace mount flake: write-probe canary + signature-gated cell
retry, closed ✅ 2026-06-11). This spike is the follow-up the 2026-06-12
prompt-halves sweep forced: that sweep was #019's first real co-resident
soak and produced evidence the closed mitigation does not fully cover.
Resolved via /grill-me 2026-06-12 (lab owner).

## Motivating evidence (prompt-halves sweep, 2026-06-12)

First data on the #019 flake under a full 1024-run AFK sweep:

- The flake (instant sub-second seed-phase `ENOENT … /workspace/<seed>` in
  `runAgent`'s seed write — OrbStack share degradation) arrives in **bursts
  that defeat the current single retry**: `adversarial-input` lost 2 cells
  because the first attempt AND its one retry both flaked back-to-back (same
  shape on the needle re-base tier-16 side).
- The share **stays degraded for a window of minutes** after sustained load:
  an immediate manual top-up ~5 min post-sweep flaked 4/4; a top-up after a
  further ~2-min idle settle ran clean 2/2.
- Consequence: a ~21 h AFK sweep finishes **red** and needs a human to
  notice and fire a manual `REUSE_ROWS` top-up — defeating "AFK-safe."

The current mitigation (`run-config-ab.sh`) is **one** immediate retry, no
settle, gated on the flake signature (first attempt, ≤20 s, `ENOENT …
/workspace`, no row emitted); the preflight write-probe canary is 3×2 s.
Both are **seconds-scale**, so against a minutes-long degraded window the
literal candidate amendment — "retry budget 2 with a *short* settle" — would
land both retries inside the burst and fix nothing. **Any viable fix must be
timescale-aware (adaptive/minutes), not a fixed short sleep.** Confirming
that quantitatively is the first job of this spike.

## Decisions (grill 2026-06-12, lab owner)

- **D1 — one spike, all mitigations on one table, one HITL decision.**
  "Is it worth it?" is inherently a cross-option cost/benefit call, so the
  spike costs out the full menu (below) rather than pre-committing to a
  symptom fix and a separate root-cause ticket.
- **D2 — mechanism is a spike *deliverable*, not decided now.** The spike
  recommends; it does not assume the canary-gated design (or any) up front.
- **D3 — decision rule: cheapest-that-works, 1-file ceiling.** Recommend
  building the cheapest option that makes AFK sweeps complete green without
  manual intervention **iff it stays contained to `run-config-ab.sh`**
  (options 1/2). If green-AFK provably requires the root-cause refactor
  (option 3, which touches the workspace contract + `runAgent`), **default
  to accepting manual top-ups + a documented runbook** and revisit only if
  flake frequency rises.
- **D4 — half-day (~4h) box + ≤1 controlled reproduction; report
  regardless.** Most evidence already exists in held logs and manual top-up
  is a working fallback, so the spike stays small; at the ceiling, report
  out even if a branch is inconclusive (record it as an explicit open item).

## What to build

A written verdict (in this issue or a linked memo) with three parts:

**1. Characterization** from the held logs — `prompt-halves-sweep-20260611.log`
and its two top-up logs, the needle re-base sweep logs, and the original
#019 soak — plus the top-up recovery-timing observations. Estimate: the
recovery-window size (how long the share stays degraded after load), the
burst rate (how often a burst defeats the current budget-1 retry), and
whether the window is bounded tightly enough that an adaptive wait could
recover within an acceptable AFK wall-clock budget. Explicitly evaluate the
literal "budget-2 + short settle" amendment against the measured window and
accept or reject it with the number.

**2. Options memo** — cost out each, with effort, expected efficacy (does it
achieve green-AFK? yes/no), added wall-clock, and blast radius:

0. **Do nothing** — keep manual top-ups; write a runbook (detect red sweep →
   wait for idle settle → `REUSE_ROWS=1` top-up of the audit-named cells).
1. **Canary-gated adaptive retry** *(contained to `run-config-ab.sh`)* — on
   a flake, poll the existing write-probe canary on an interval until it
   passes (mount recovered) or a max-wait bound elapses; then re-run, with a
   small post-green budget. Adapts to the real recovery time; a
   never-recovering mount still fails the arm at the bound.
2. **Defer-to-end-of-arm** *(contained)* — collect flaked cells, retry after
   the arm's other cells finish (load drops at arm end), one final
   canary-gated attempt. Batches recovery; complicates #003 accounting + cell
   ordering.
3. **Root-cause: host-side seeding** *(OUT of the 1-file ceiling)* — write
   seed files host-side to the shared workspace `H` before launching the
   cell container, so the seed write never traverses the degraded
   container→share path. Touches the workspace contract + `runAgent`.

**3. Recommendation** applying decision rule D3 — name the option (or
"do-nothing + runbook") and justify it against the measured efficacy + the
1-file ceiling.

Any implementation the recommendation justifies is a **separate ticket**,
and must (per #003) preserve exact row accountability and the
`retried_cells=N` arm-summary reporting, and extend the existing
`OC_FLAKE_INJECT` / `OC_FLAKE_INJECT_GENUINE` hooks with a
**flake-N-times-then-recover** and a **never-recover** injection so the new
path is demonstrated deterministically, not just code-read. State these
requirements in the follow-up; do NOT build them here.

## Acceptance criteria

- [ ] Characterization recorded with numbers: recovery-window estimate + burst-rate (bursts that defeat budget-1), each traced to the named held logs/observations
- [ ] The literal "budget-2 + short settle" amendment explicitly evaluated against the measured window and accepted or rejected, with the number that decides it
- [ ] Options memo covers all four (0/1/2/3), each with effort, green-AFK efficacy (yes/no), added wall-clock, and blast radius (1-file vs contract-touching)
- [ ] A recommendation that applies decision rule D3 (cheapest contained option achieving green-AFK; else do-nothing + runbook), naming the chosen option and why
- [ ] If an implementation is recommended: follow-up issue filed + linked, carrying the #003 accountability + `retried_cells` reporting + flake-N-then-recover / never-recover injection-hook requirements. If do-nothing: the manual-top-up runbook is written into this issue/memo
- [ ] Time-box honored: ≤ ~half-day, ≤1 controlled reproduction (resident :11436 read-only, under `/tmp/oc-resident.lock.d` + `OC_ROTATE_HOLDING_LOCK=1`); reported out regardless of whether any branch is inconclusive
- [ ] No production change: `run-config-ab.sh`, `runAgent`, schema, and committed registries untouched (diff is the issue/memo + any throwaway repro artifacts under gitignored runtime roots)

## Blocked by

None - can start immediately (read-only against held logs; at most one cheap
controlled reproduction under the resident lock per the standing protocol).
