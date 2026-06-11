# Server-timings join: key on token counts, not ordinal index

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 xhigh review (2026-06-10), finding 9/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

`joinServerTimings` pairs the k-th parsed log timing block to the k-th
iteration by raw index and still writes all pairings on count mismatch
(coarse `join_status: 'count_mismatch'` only). The shift is systematic, not
hypothetical: OpenCode fires a session-title request (`agent=title`,
`small=true`) to the same llama-server **before** the first build iteration —
the repo's own ws020 evidence capture shows it — so every run yields
n_iterations+1 blocks and iteration k receives request k−1's prompt/decode
split.

Re-key the join on data both sides already carry: the parsed blocks have
`prompt_tokens`/`decode_tokens`, the iteration records have per-message
input/output token counts. Match blocks to iterations on token counts (exact
or within tolerance), leave unmatched blocks (title/summarize traffic)
unattached, and reserve `count_mismatch` for genuinely unattributable
leftovers. Build the fixture from the ws020 capture so the title-request
shape is pinned in tests.

## Acceptance criteria

- [ ] A fixture with n_iterations+1 blocks (leading title block, derived from the ws020 capture) joins every iteration to its own request's timings; the title block is unattached, and `join_status` reflects a clean join
- [ ] A fixture with a genuinely missing block yields nulls for that iteration only (no shift of its neighbors)
- [ ] Existing equal-count fixtures still join identically (regression)
- [ ] `timing_caveats` / `join_status` vocabulary documented in OPENCODE-SERVER-TIMINGS.md matches the implemented states

## Blocked by

None - can start immediately (independent of #007; both touch opencode_server_timings.js — coordinate merges)
