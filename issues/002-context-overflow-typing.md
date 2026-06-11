# Context-overflow typing: re-implement or retire detectUpstreamFailure

**Type**: HITL → decision recorded 2026-06-10 (below); implementation is now AFK

**Status:** ✅ Complete (2026-06-10, T3 — implemented per §Decision; see §Result)

## Decision (2026-06-10, lab owner)

**Option A — restore the relabel, opencode-native.** Mid-run context
overflow is re-typed `harness_error` / `passed: null` and excluded from
pass denominators, preserving the Sprint-1.20 Layer-A taxonomy (serving
artifacts vs capability failures).

- **Detection signal: the llama-server log line** (explicit n_ctx-exceeded
  error) read from the per-cell capture window — wire/server-side truth,
  same oracle philosophy as the #001 wire-capture decision. Token-telemetry
  and client-error signals were considered and rejected as weaker oracles.
- Soft dependency: the per-cell server-log capture plumbing (#007) must
  land first or alongside.
- Comparability context: future published comparisons are
  **opencode-vs-opencode only** (claw-rig rows remain replication-only
  evidence). The protocol doc must note that this is a semantics change
  relative to the published oc verdicts (OPENCODE-AB-TIER16-VERDICT counted
  overflows as eligible model failures, "0 oc harness_error").

## Parent

PR #6 xhigh review (2026-06-10), finding 2/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

`run_row.js`'s `detectUpstreamFailure` (the Sprint-1.20 context-overflow →
`harness_error` relabel) is dead code at PR head: it reads
`<runDir>/bridge.iterations.jsonl`, whose only writers (claw.js, the LiteLLM
callback) are deleted, and `opencode_transcript.js` hardcodes
`context_overflow: false`. A mid-run overflow (the documented tier-16 64k
n_ctx case) now lands as an eligible model failure
(`terminal_status: 'timeout'`/`'error'`, `passed=false`) — the
OPENCODE-AB-TIER16-VERDICT doc acknowledges this ("0 oc harness_error") while
the dead detector on the emit path implies otherwise.

~~Decision required first~~ **Resolved — Option A; see §Decision above.**
Original options kept for the record:

- **Option A — re-type overflows (CHOSEN).** Derive an overflow signal in the
  opencode pipeline (llama-server log line in the capture window built by the
  old-suite #022 plumbing, now owned by this suite's #007) and feed it
  through the transcript's `context_overflow` field so the existing Layer-A
  relabel fires again. Restores denominator symmetry with claw-era
  discipline.
- **Option B — retire and document (rejected).** Delete
  `detectUpstreamFailure` and the relabel gate, document overflow-counts-as-
  model-failure in the verdict/protocol docs.

Either way, the misleading dead path must not survive: no code that promises
a relabel it cannot perform.

## Acceptance criteria

- [x] Decision recorded in this issue with rationale (2026-06-10, §Decision)
- [x] Decision + the semantics-change note (vs the published oc verdicts) recorded in the relevant protocol doc
- [x] A fixture-driven unit test shows an overflow run (n_ctx-exceeded line in the captured server log) emitting `terminal_status: 'harness_error'` / `passed: null`
- [x] `grep -r bridge.iterations.jsonl host/test/` returns nothing — the dead bridge-file path is gone, replaced by the server-log signal (3 historical-data references remain outside the emit path; see §Result AC3)
- [x] No references to `detectUpstreamFailure` remain that don't match the implemented behavior (zero references remain at all)
- [x] Runner-image suite green (281 / 280 pass / 1 skip / 0 fail)

## Blocked by

- #007 (soft — the overflow signal reads the per-cell server-log capture window #007 makes reachable; land #007 first or together) — **#007 landed in T2; this rides its plumbing.**

## Result (2026-06-10, T3 agent)

**Architecture as built (Option A).** Two detection layers, one oracle, one
sidecar contract:

- **Oracle (pinned empirically):** llama-server build `b1-5594d13` (the lab's
  pinned build), throwaway host probe (Qwen3-8B-Q4_K_M, `-c 256`, port 18123,
  resident :11436 untouched) rejected an over-context request with HTTP 400
  `exceed_context_size_error` and logged exactly:
  `srv    send_error: task id = 0, error: request (728 tokens) exceeds the available context size (256 tokens), try increasing it`
  → pinned as `CONTEXT_OVERFLOW_RE` in lib/opencode_server_timings.js;
  byte-exact capture pinned as `__tests__/scripts/fixtures/overflow-server-log.slice`.
  Negative result, same probe: a MID-DECODE ceiling does NOT error on this
  build (`finish_reason: 'length'`, HTTP 200, no log line) — the pre-decode
  rejection is the only overflow signal, and truncated-but-completed runs are
  not re-typed.
- **In-run layer:** `captureServerTimings` scans the run's slice text and
  rides a `{ signal: 'context_overflow', line, task_id, … }` marker back on
  the captured-records array (the only runner→transcript channel; markers are
  filtered out of the #008 join population). `buildOpenCodeArtifacts` →
  `normalizeOpenCodeSession` re-type the run_summary BEFORE the reporter
  emits the row: `terminal_status: 'harness_error'`, `passed: null`,
  `context_overflow: true`, `harness_error: 'context_overflow'`,
  `context_overflow_detected_via: 'in_run_capture'`, `context_overflow_line`,
  + a `context_overflow_relabel:` caveat.
- **Post-arm PRE-GATE patch layer:** run-config-ab.sh's post-arm pass now
  slices EVERY fresh runDir from the HOST log (T2 carry-forward adopted —
  unconditional `server-log.slice`, not just freeze-signature runs) and runs
  `scripts/patch-context-overflow.mjs scan-and-patch` per runDir: an overflow
  hit patches run_summary (same fields,
  `context_overflow_detected_via: 'host_slice_post_arm'`) AND the
  already-emitted registry row (`terminal_status → 'harness_error'`,
  `passed → null`, `harness_error → 'context_overflow'`) — idempotent, loud
  (one stderr line naming the run + a JSON result line), strictly before the
  row audit / pairing gate read the registry. This covers BOTH in-run blind
  spots: the virtiofs freeze AND outcome-only sidecars from wedged runs.
  A patch that FAILS (not "no overflow") sets `OVERFLOW_RC=1` → sweep exit 2
  (registry-accountability precedence slot, extended from row-shortfall-only).
- **run_row.js:** `detectUpstreamFailure` (dead bridge-slice reader) DELETED;
  replaced by `detectContextOverflow(summary)` reading the sidecar flag, with
  the relabel firing in `pickTerminalStatus` regardless of exit-code shape
  (the claw-era exit!=0 gate would have missed the documented tier-16
  overflow-burns-the-wall-clock → 'timeout' shape).
- **Flag coupling (documented decision):** overflow typing RIDES
  `OPENCODE_SERVER_TIMINGS=1` (the decision doc's soft dependency on #007).
  Flag-off sweeps have no capture window and keep
  overflow-counts-as-eligible. Stated plainly in
  docs/OPENCODE-SERVER-TIMINGS.md §"#002 context-overflow detection" and the
  AB-plan §0b note.
- **Attribution rule (documented):** a rejected request produces no timing
  block, so the task id has no within-run anchor — an overflow line inside a
  run's capture window belongs to that run (single-client topology). The
  ±1-tick host-slice pads make this slightly over-inclusive; risk is
  conservative (can only move a FAILED neighbor into the excluded bucket —
  the recovered-run carve-out keeps clean-finishing runs 'done').
- **Recovered-run carve-out:** overflow line + exit 0 → recorded
  (`context_overflow: true`, `context_overflow_recovered:` caveat), NOT
  re-typed; the workspace oracle decides pass/fail.

**Per-AC evidence:**

1. **Protocol-doc notes** — dated (2026-06-10) semantics-change notes added to
   docs/OPENCODE-AB-TIER16-VERDICT.md (blockquote in §Sensitivity: "0 oc
   harness_error" counted overflows as eligible; page numbers NOT restated;
   not directly comparable to future flag-on sweeps without
   config-ab-normalized-ci.mjs) and docs/OPENCODE-HARNESS-AB-PLAN.md §0b
   (eligibility bullet, forward-looking protocol). Mechanism documented in
   docs/OPENCODE-SERVER-TIMINGS.md §"#002 context-overflow detection".
2. **Fixture-driven relabel tests** —
   `__tests__/lib/run-row-overflow.test.js` (sidecar fixture → `assembleRow`
   row: harness_error / passed null / harness_error='context_overflow',
   `validateRow` clean, `isEligible` false — both the in-run-relabeled and
   the still-'timeout' sidecar shapes), `__tests__/lib/opencode-transcript.test.js`
   §#002 (marker → on-disk run_summary relabel; flag-off ignores marker),
   `__tests__/lib/opencode-server-timings.test.js` §#002 (regex pinned
   byte-exact, scan, marker transport, join unpolluted),
   `__tests__/scripts/patch-context-overflow.test.js` (real-capture fixture
   slice end-to-end: sidecar + registry row patched, idempotent, foreign rows
   byte-identical, row_absent + recovered + no-overflow paths).
3. **Dead path gone** — `grep -r detectUpstreamFailure host/test/` → zero
   matches. `grep -r bridge.iterations.jsonl host/test/` → zero matches in
   lib/scripts/tests/driver; 3 remaining references are historical-data
   descriptions outside the emit path and outside this issue's ownership
   (lib/schemas/run_registry.schema.json `trace_artifact_uri` description,
   docs/base/historical_bucketing.csv inventory, scripts/analysis/
   build-w4-packet.py — all describe ARCHIVED claw-era runDirs where the file
   genuinely exists; no code reads it on any live path).
4. **Suite** — runner-image container: **281 tests / 280 pass / 1 skip /
   0 fail** (baseline 234/233/1/0; includes this issue's new tests and the
   T3 sibling's #015 tests in the shared tree).
5. **Live flag-on smoke** — `OPENCODE_SERVER_TIMINGS=1 host/test/run-config-ab.sh`
   (tier 64, deep-equal, opencode-a) under the resident lock: **rc=0**, arms
   rc=0 / audit rc=0 / overflow rc=0 / gate rc=0, first attempt (no ENOENT
   flake). Post-arm log: `1 runDir(s) sliced, 1 frozen, 1 repaired,
   0 overflow-typed` — the freeze fired live, the unconditional slice + scan
   ran, no overflow (expected). Row: `done / passed=true / harness_error=null`,
   run_summary `context_overflow: false`, join repaired to `ok`. Resident pid
   31147 before/after; no stray containers/ticker/lock.

**Registry-patch provenance:** the registry schema is
`additionalProperties: false`, so the patched ROW carries the relabel in
schema fields only (`terminal_status`/`passed`/`harness_error`); the patch
provenance (`context_overflow_detected_via`, `context_overflow_line`, caveat)
lives on the run_summary sidecar, reachable from the row via
`trace_artifact_uri`/`run_id`.

**Residual risks / notes:** (a) window-pad misattribution (conservative, see
attribution rule); (b) a window-mapping failure for a runDir logs a loud
`OVERFLOW-SCAN-GAP` WARNING but does not redden (no slice → no scan; matches
the timings-repair best-effort convention — greppable signature if it ever
fires); (c) in-run detection requires a usable transcript DB — outcome-only
overflow runs are corrected by the post-arm layer only; (d) flag-off sweeps
intentionally keep old semantics (protocol-documented).
