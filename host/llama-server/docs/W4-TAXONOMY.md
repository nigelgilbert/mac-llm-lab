# W4 — frozen failure-mode taxonomy

*Frozen 2026-04-28 before any classification pass. Per the v2 plan in
[TODO-ITERATION-DISTRIBUTION-TEST.md](TODO-ITERATION-DISTRIBUTION-TEST.md)
§"W4 — failure-mode classification". Both classifiers (agentic Pass 1 and
director Pass 2) are bound to this file. If acceptance gates (κ ≥ 0.6 with
CI lower bound ≥ 0.4, raw agreement ≥ 70%, unclassified < 30%) fail, the
taxonomy is rebuilt from data and rerun — not patched in place.*

## Amendment 2026-04-29 — Class E deprecated

Class E ("infrastructure / non-model-gap latency") is **deprecated for the
post-`6dd992d` regime** and must not be used as a label in new
classification passes. Active classes for any sweep against the widened
timeouts (240/240/360s) are **A, B, C, D, F**.

**Rationale.** [W2-W3-RESULTS-20260428.md](W2-W3-RESULTS-20260428.md) shows
median `model_share ≥ 0.994` for csv-parser, lru-cache, and expression-eval
under the widened timeouts — `total_non_model_gap_ms` is empirically <0.5%
of wallclock. Class E's defining signature ("normal turn count, abnormal
non-model time") is therefore mechanically unobservable in this regime; E
was a censoring artifact of the prior tight-timeout configuration.
Class B is also a candidate for deprecation (empty in both sweeps to date),
but is retained provisionally pending one more sweep on the post-`c145343`
test suite. The Class E definition is preserved below for traceability of
prior classifications (n=20 archive, sampler-grid runs).

## Coding rules

1. **Earliest identifiable root cause wins.** If `wrong-module-shape (B)`
   causes a `verify-loop (A)`, label it B unless the module issue is
   incidental and verify-loop dominates the iteration count.
2. **Class F counts toward the unclassified rate.** Use it for genuine
   "trace evidence is not sufficient to discriminate" — not as a release
   valve.
3. **Provide a `primary_signal` per label** — the iteration index (or
   indices) where the trace evidence is clearest, plus the field/value
   that distinguishes that class.

## Classes

### Class A — verify-loop

**Trace signature:** repeated edit/verify cycles on the same target across
**three or more iterations**, with repeated or closely-related
`result_error_signature` values, and **low convergence** (the loop does
not progress toward a passing state). Writes may have
`workspace_changed: true`, but the cycle does not converge.

**Distinguishing feature vs. D:** the model is *intent on making progress*
— it edits, then re-verifies, then re-edits. It just doesn't converge.

**Example trace shape:**
- iter k: `write_file('foo.js', ...)` → workspace_changed=true
- iter k+1: `bash('node verify.js')` → is_error=true, signature='AssertionError: expected X got Y'
- iter k+2: `write_file('foo.js', ...different fix...)` → workspace_changed=true
- iter k+3: `bash('node verify.js')` → is_error=true, similar signature
- … sustained across ≥3 cycles ending without success.

**Plausible levers:** clearer verification instructions, test-output
truncation, structured error extraction.

### Class B — wrong-module-shape

**Trace signature:** early `module_not_found` / `syntax_error` / equivalent
signature with the model spending **≥ 3 iterations** on shape resolution —
changing import/require form, adding/editing `package.json`, switching
ESM/CJS.

**Example trace shape:**
- iter 2: `bash('node verify.js')` → is_error=true, signature contains
  `Error: Cannot find module './lib.js'` or `Cannot use import statement
  outside a module`.
- iters 3..6: edits to `package.json`, `import` lines, `.js` ↔ `.mjs`
  renames, before any actual algorithm work begins.

**Plausible levers:** seed module format in workspace, add `package.json`
when appropriate, clarify ESM/CJS in prompt.

### Class C — context-drift

**Trace signature:** evidence of context pressure or lost state. Required
signals (any one):

- `input_tokens` reaches 70–80% of `ctx`, OR
- repeated rereads of files containing already-established facts (same
  file, distant iterations, with no intervening `workspace_changed: true`
  on it), OR
- contradictory statements about prior state visible in the transcript,
  OR
- re-derivation of previously-solved subtasks.

**Distinguishing feature:** "rising input_tokens" alone is NOT enough —
that's normal in any multi-turn run. Look for actual lost state, not
merely accumulating tokens.

**Plausible levers:** compaction near 80% of `n_ctx`, explicit context
budget warnings, hard iteration cap as policy.

### Class D — grammar/tool dead-branch

**Trace signature:** repeated tool calls with
`result_changed_vs_previous_same_call: false` (same call → same result,
no new information) **AND** `workspace_changed: false` across the
affected iterations. Or accepted tool shapes that produce no diagnostic
information.

**Distinguishing feature vs. A:** *no observable progress signal at all*.
A is "trying to progress and failing"; D is "not actually trying to
progress" or "the call is structurally unproductive."

**Example trace shape:**
- iter k: `read_file('foo.js')` → some content
- iter k+1: no edit
- iter k+2: `read_file('foo.js')` → identical content
  (`result_changed_vs_previous_same_call: false`, `workspace_changed: false`)

**Plausible levers:** grammar restriction, better tool feedback, no-op
detection.

### Class E — infrastructure / non-model-gap latency *(deprecated 2026-04-29)*

> **Deprecated.** Do not use as a label in new classification passes against
> the post-`6dd992d` regime. See *Amendment 2026-04-29* at the top of this
> file. Definition preserved for traceability of prior passes only.

**Trace signature (all three required):**

- `wallclock_ms` residual > 1.5 σ from the per-cell `wallclock ~
  output_tokens + iter_count` fit, AND
- `iter_count ≤ cell p75` (i.e., iteration count is not unusual), AND
- either `total_model_elapsed_ms > cell p90` OR
  `total_non_model_gap_ms > cell p90`.

**Distinguishing feature:** Class E does NOT absorb ordinary high-iteration
failures. Those go to A/B/C/D even if their non-model-gap is also high.
E is "normal turn count, abnormal non-model time."

**Plausible levers:** tool-side optimization, runner caching, tool-output
streaming.

### Class F — other / insufficient evidence

**Trace signature:** doesn't cleanly fit A–E, OR trace data is
insufficient to discriminate (e.g., heavily censored run, very short
trace, missing fields).

**Coding rule reminder:** F counts toward the unclassified rate. If a
classifier finds itself reaching for F often, that's a signal the
taxonomy needs to be rebuilt — not that F should expand.

---

## Addendum: lever-proposal template (2026-06-10)

Salvaged from the deleted `V2-LEVERS.md` scaffold (W5 never ran; the
per-class "plausible levers" above already capture its class-specific
content). If a future classification pass produces lever tickets, each
proposal should specify: **trace signature** (from the accepted pass) ·
**run count / share** · **example run IDs (≤3)** · **proposed lever** ·
**expected mechanism** (why it reduces p90 iter_count) · **metric expected
to move** (named test, X→Y) · **validation experiment** (n, design, primary
criterion, joint-test correction) · **pass-rate regression risk** ·
**rollback / no-go criterion** (measurable) · **confidence**.
Post-migration note: Class D's grammar-side levers are void (no grammar in
the OpenCode stack); prompt-side levers are promoted per the
prompt-is-the-moat finding (OPENCODE-MIGRATION-DECISION.md §1).
