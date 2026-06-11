# Context-overflow typing: re-implement or retire detectUpstreamFailure

**Type**: HITL → decision recorded 2026-06-10 (below); implementation is now AFK

**Status:** 🔲 Not started (unblocked — decision made)

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
- [ ] Decision + the semantics-change note (vs the published oc verdicts) recorded in the relevant protocol doc
- [ ] A fixture-driven unit test shows an overflow run (n_ctx-exceeded line in the captured server log) emitting `terminal_status: 'harness_error'` / `passed: null`
- [ ] `grep -r bridge.iterations.jsonl host/test/` returns nothing — the dead bridge-file path is gone, replaced by the server-log signal
- [ ] No references to `detectUpstreamFailure` remain that don't match the implemented behavior
- [ ] Runner-image suite green

## Blocked by

- #007 (soft — the overflow signal reads the per-cell server-log capture window #007 makes reachable; land #007 first or together)
