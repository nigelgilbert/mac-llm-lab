# Tranche log — T10: post-migration research restart (W1 prereg · W2 anomaly re-base · W3 #025)

Date: 2026-06-11. Branch: main. Orchestrator: Claude Code (this log is the
source of truth for the tranche; conventions per
LOG-2026-06-11-impl-020-029.md).

## Plan

Executes the top of the ranked shortlist in
research/research-salvage-next-tranche-20260610.md (items 1–2, threads 1–2)
plus issue #025. Three parallel agents on disjoint file surfaces:

- **W1 — prompt halves ablation @ tier-16, STEP 1 ONLY (pre-registration).**
  New doc `host/test/docs/OPENCODE-PROMPT-HALVES-PREREG.md`: coarse HALVES
  contrasts off the sidecar-port template (≤4 arms: full / half-A / half-B /
  none), 32-task panel, N≥8 per cell, pre-registered gates + paired-bootstrap
  CIs per EVAL-DESIGN. NO single-line arms (±48pp between-task heterogeneity).
  Tier-64 model-strength contrast = named follow-up, NOT this tranche.
  **HITL GATE: zero sweep compute until lab-owner sign-off is recorded in the
  doc.** Wiring (config.js VALID_CONFIGS + config files + arm×16 preflight)
  and the AFK sweep are T11, post-sign-off.
- **W2 — anomaly re-base (thread 2).** (a) needle-haystack tier-64 cell
  re-run on the oc stack (resident :11436 strictly read-only, under the
  resident lock) — inversion gone → cell re-enters the pack; persists → real
  model finding; memo updated either way. (b) Audit OpenCode's search/glob
  tools for the fixture-literal self-poisoning mode
  (grep-search-claw-runtime-leak memo); port the mitigation ranking if it
  applies. Wire capture is the oracle, never behavioral PROOF.
- **W3 — issue #025 (AFK).** Verdict-renderer guards (iteration-parity
  empty-array, NaN durations) + golden-output tests over committed fixture
  registries, including the deferred #021 normalized-ci goldens.

File surfaces (disjoint): W1 = one new doc. W2 =
`__tests__/tier-eval/frontier/needle-haystack.test.js` (+ relocation if
re-entry), `docs/difficulty-pack/good-tests.md`, the two usability-pack
memos, gitignored `.claw-runtime/` registries. W3 =
`scripts/config-ab-{verdict,pairing-check,normalized-ci}.mjs` renderer
guards, new tests/fixtures, `issues/025-*.md`.

Constraints in force: resident :11436 never restarted; tier-16 lifecycle via
opencode-server with ports quiet after; tiers.conf↔FALLBACK_TIER_TABLE move
together (no edits expected this tranche); retried_cells=N logged from every
sweep arm (#019's first real co-resident soak); agents never commit —
orchestrator commits T10 after the coherence check (full containerized suite
≥335/334/0-fail/1-skip, baked image rebuilt first); deviations flagged
loudly. #018 tally + threshold decision, #022/#026, thinking-on arms: out of
scope (HITL / lab-owner).

## Status

| Work item | Agent | Status | Notes |
|-----------|-------|--------|-------|
| W1 prereg doc | R1 | ✅ done, verified | `host/test/docs/OPENCODE-PROMPT-HALVES-PREREG.md`. Split = semantic AND positional midpoint (h1 = rules 1–3 "call economy", h2 = rules 4–6 "output/action discipline"; preamble+header in both halves; verbatim line-subsets). Orchestrator independently re-derived all four sha256/byte pins — exact. Gates: G1 replication gateway (C1 CI excludes 0, ≈+6.6pp expected), carry criterion (CI excludes 0 AND point ≥ C1/2), pre-written readings for every outcome incl. nulls. Recommends fresh 4-arm sweep (1024 runs ~20h) over 2-arm REUSE_ROWS (512, ~10h, carries overflow-semantics/telemetry/provenance asymmetries) — owner checkbox. **HITL gate live: zero sweep compute until §9 signed.** |
| W2 re-base + audit | R2 | ✅ done, verified | (a) **needle-haystack inversion GONE — claw-bridge infra confirmed.** t64 `opencode-a` N=5: 5/5 done/pass, max wall 97s, zero 8s-errors/SSE-stalls/lost rows, 0 overflow. t16 `opencode-a+prompt` N=3: 3/3 oracle-pass (one via 277s timeout-grazing iter-storm) — t16 no longer floors, so cell re-entered the pack as weak/ceilinged drop-candidate (its own keep_drop rule live; one confirmatory sweep already counts). Test recovered from `df50d21~1` (frontier/ was deleted by #010), ported to runAgent, spec region byte-identical. Flagged deviations accepted: t64 arm = `opencode-a` not `+prompt` (+prompt×64 unmapped, #006 preflight refuses; vanilla IS the adopted t64 stack); flat path not frontier/. (b) **grep-leak audit: structurally dead under the driver path; tool-layer gap real but dormant.** oc 1.16.2 grep/glob run rg `--hidden`, only `.git/` denied; `.gitignore` honored only inside a git repo (dead mitigation on git-less arms); `.rgignore`/`.ignore` honored always. Wire-captured: planted decoys → 95/100 delivered grep lines were decoy telemetry (46KB payload, tool-truncation makes it dilution not fatal overflow). Two dormant residues named (registry.js `/workspace/.claw-runtime` default; workspace.js PRESERVE exemption) → follow-up issue drafted in the addendum (#041 suggested). Mitigation ranking ported (rgignore plant ≥ gitignore). |
| W3 #025 | R3 | ✅ done, verified | Guards: iteration-parity n=0 → "unavailable" (#012 parity, Number.isFinite); durationS NaN filtered (was spuriously flipping Rule 0a.2 on the malformed fixture). New `__tests__/scripts/config-ab-renderer-goldens.test.js` (22 tests) + 3 fixtures; goldens pin verdict + pairing-check + (deferred-#021) normalized-ci, including the six published numbers on the committed canonical registries — all reproduce verbatim post-guards. Flagged deviation accepted: Dockerfile gains `COPY docs/data` so the baked image can see the canonical registries (read-only evidence; documented in-line). Issue file ✅ with per-AC evidence. |

## Events

- 2026-06-11: Orchestrator read the salvage doc (threads 1–2), EVAL-DESIGN,
  AB plan §0a/§0b, tier-16 verdict, sidecar-port handoff (RESULT: prompt
  effect +6.6pp [+3.1,+10.2] vs +git control), system-prompt.md, both
  thread-2 memos, issues #018/#019/#025, driver header, lib/config.js.
  Launched R1/R2/R3 in parallel.
- All three returned complete. R2's live work ran under the resident lock;
  resident :11436 green before/between/after (pid untouched), :11437 booted/
  stopped by the driver only, ports quiet after, lock released.

### T10 boundary verification (orchestrator)

- Diff surface exactly matches the ownership plan (6 modified + 6 new
  tracked files); no out-of-scope edits; canonical registries in docs/data/
  byte-untouched; no .jsonl outside gitignored runtime roots.
- Prereg pins independently re-derived: parent 10 lines/1379 B/`84992e1c…`,
  h1 740 B/`cf7dafb0…`, h2 802 B/`cd3213d8…` — exact.
- Lab state: resident `{"status":"ok"}`, no resident lock, :11437/:11438
  quiet, no stray sweep containers, no stale `.retry-count.*` files.
- Full containerized suite on the REBUILT baked image (`docker compose
  build test` then `run --rm test`): **357 tests / 356 pass / 0 fail /
  1 pre-existing skip** — strictly above the 335/334/0/1 floor (+22 from
  #025 goldens; tier-eval cells are live-only and outside the unit suite).
- Coherence: W3's verdict-renderer guards change rendering only (no
  eligibility/median-population change — #026 untouched); W2's re-entered
  cell is panel metadata + a tier-eval test file (not in the unit suite,
  not in SMOKE_TESTS defaults); W1 is doc-only. No interface overlap.

Committed as T10. **Tranche pauses here for the W1 HITL gate (prereg §9).**
T11 (post-sign-off): half-arm wiring (VALID_CONFIGS + schema enum +
model_configs + half artifacts + contract test), arm×16 preflight, the AFK
sweep under the canonical protocol, analysis + verdict memo + committed
registry, then the #018 tally → STOP (threshold decision is lab-owner's).

## retried_cells ledger (#019 co-resident soak)

| Sweep | Arm | retried_cells | Note |
|-------|-----|---------------|------|
| needle-rebase t64 (`config-ab-20260611-140627-21950`) | opencode-a | 0 | clean |
| needle-rebase t16 sweep#1 | opencode-a+prompt | 2 | one cell double-flaked → rep lost, sweep red (audit named it — correct) |
| needle-rebase t16 top-up#1 (REUSE_ROWS) | opencode-a+prompt | 1 | double-flaked again, no row |
| needle-rebase t16 top-up#2 (REUSE_ROWS) | opencode-a+prompt | 0 | row landed |

Net: 5 flake events across 8 t16 cell attempts vs 0/5 at t64 — consistent
with the #019 share-degradation record (all kills pre-agent, seed phase; the
retry layer recovered 3 of 5 events; the double-flake shape exceeded the
single-retry budget twice). First real co-resident soak data for #019.

---

# T11 — prompt-halves wiring + sweep (started 2026-06-11, post-sign-off)

**HITL gate cleared:** lab owner approved the prereg §9 same-day (arms +
split as drafted; **fresh 4-arm sweep**, 1024 runs; defaults kept). Decision
recorded in the doc; §5 is frozen.

## T11 wiring (agent R4) — ✅ complete, verified

- Half artifacts committed (`host/llama-server/docs/system-prompt.h1.md` /
  `.h2.md`) — orchestrator and agent independently verified byte/sha
  equality with the prereg §2.2 pins (740 B `cf7dafb0…` / 802 B `cd3213d8…`).
- lib/config.js (VALID_CONFIGS, OPENCODE_CONFIGS, half fingerprint map —
  tier-16 ONLY, #006 refusal elsewhere intended), schema config_id enum,
  model_configs.json ×2 (`pp01+agentsmd-h1-v1`/`-h2-v1`), runAgent.js
  seeding via `AGENTS_MD_SOURCE_BY_CONFIG`. New
  `prompt-halves.contract.test.js` (pins + verbatim-subset + live drift
  gate, tiers.conf-contract pattern); config-selector tests extended.
- Suite (rebuilt baked image): **365/364/0 fail/1 skip** (floor 357/356).
- Preflight ×4 @16 PASS; h1×64 refusal dies pre-server naming the pair.
- Single-cell smokes (tier-16, under lock): planted AGENTS.md byte-matches
  the half pins per arm; rows carry the right config_id/model_config_id;
  gate PASS; retried_cells=0 both arms. Lab restored (:11437 quiet,
  resident green, lock released).
- Flagged deviation accepted: config-ab-normalized-ci.test.js regex pins
  the VALID_CONFIGS enum verbatim → one-line update (unavoidable).
- run-config-ab.sh and tiers.conf untouched (as expected post-#010/#016).

Committed as T11. Sweep launched AFK after the commit (see below).

## T11 sweep (the pre-registered 4-arm ablation)

Canonical protocol: `TIER=16`, `ARMS="opencode-a+git opencode-a+prompt
opencode-a+prompt-h1 opencode-a+prompt-h2"`, `BASELINE=opencode-a+git`,
`CONFIG_AB_REPEATS=8`, the 32-stem panel via SMOKE_TESTS (stems extracted
from the committed sidecar-port registry — exactly the verdict table's 32),
`OPENCODE_SERVER_TIMINGS=1`, fresh
`REGISTRY_OUT=.claw-runtime/run_registry.prompt-halves-20260611.jsonl`,
resident lock held with `OC_ROTATE_HOLDING_LOCK=1`; resident :11436
read-only; :11437 lifecycle owned by the driver. Expected ~20 h.
retried_cells per arm to be appended to the ledger above when the sweep
lands. Post-sweep (next session): analysis per prereg §5, verdict memo +
committed canonical registry, then the **#018 tally → STOP (HITL)**.
