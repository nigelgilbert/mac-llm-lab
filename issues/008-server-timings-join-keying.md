# Server-timings join: key on token counts, not ordinal index

**Type**: AFK

**Status:** ✅ Complete

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

## Result

`joinServerTimings` re-keyed on token counts in
`host/test/lib/opencode_server_timings.js`; tests + ws020-derived fixture in
`host/test/__tests__/lib/opencode-server-timings.test.js`; vocabulary
documented in `host/test/docs/OPENCODE-SERVER-TIMINGS.md` ("Join keying
(#008)" + "`join_status` / `timing_caveats` vocabulary" sections).

Keying: block `prompt_tokens`/`decode_tokens` ↔ iteration `input_tokens` /
`output_tokens + reasoning_tokens` (ws020 evidence pins `input` as the
UNCACHED prompt count: `total = input + output + cache.read`, so it lines up
with the server's prompt-eval token count). Order-preserving greedy match,
exact first, then ±`TOKEN_MATCH_TOLERANCE = 2` tokens per field
(`opts.tokenTolerance` overrides); a field is compared only when non-null on
both sides, ≥1 comparable field required. When token keying is IMPOSSIBLE
(no block or no iteration carries any token count — injected/legacy records
only), the join falls back to the pre-#008 ordinal pairing and reports
`join_keying: 'ordinal_fallback'`; real log/proxy records always carry
counts, so production runs always take the token path.

Final `join_status` vocabulary: `disabled`, `no_server_timings`,
`log_unreadable` (#007), `ok`, `count_mismatch`. `timing_caveats` entries
(written by `buildOpenCodeArtifacts`, format mechanical):
`server_timings_join_<status>: #022 log-cursor split (<n_timings> timing
record(s) over <n_iterations> iteration(s)).` — `disabled` never reaches the
join, so only the other four appear.

Per-AC evidence (suite: 204 tests / 201 pass / 1 skip; only failures are the
pre-existing baseline `opencode.contract.test.js` ones owned by a parallel
agent):

- **ws020-derived n_iterations+1 fixture (leading title block)** — PASS.
  Fixture derived from the repo's ws020 evidence capture
  (`client/opencode/.opencode-runtime/ws020-evidence/`): iteration token
  counts 561/28, 110/62, 87/46, 19/25 from `messages.raw.jsonl`; the
  leading `agent=title small=true` request pinned at `run-logs.txt:56`
  (before the first build stream at `:62`). 5 blocks join 4 iterations with
  `join_status: 'ok'`, `join_keying: 'token'`, `n_matched 4`,
  `n_unmatched_timings 1`; task ids attach as [1,2,3,4] (title task 0
  unattached); the pre-#008 ordinal shift (iter 1 receiving the title's
  201.54 ms prompt eval) is explicitly asserted NOT to happen. Tests:
  "n_iterations+1 blocks: every iteration joins its OWN request…" +
  "pre-#008 ordinal bug pinned…".
- **Genuinely missing block → nulls for that iteration only** — PASS.
  Dropping iteration 3's block from the ws020 log gives task ids
  [1, 2, null, 4] — neighbors keep their OWN blocks (no shift), iter 3 all
  null, `join_status: 'count_mismatch'` (reserved for the genuinely
  unattributable), `n_unmatched_timings: 1` (the title). Test: "genuinely
  missing block: nulls for THAT iteration only…".
- **Existing equal-count fixtures join identically** — PASS. Pre-change
  behavior confirmed first on the baseline suite (k-th block → k-th
  iteration, `'ok'`, decode 440.69/1185.58, task 113). Post-change: the
  token-carrying equivalents produce identical attachments via the token
  path, and the ORIGINAL token-less fixtures (kept verbatim) produce
  byte-identical attachments + statuses via the ordinal fallback — which
  also keeps the foreign `opencode-transcript.test.js`
  `buildOpenCodeArtifacts` #022 contract test (token-less injected records,
  expects ordinal attach + `count_mismatch`) green without touching it.
- **Vocabulary documented = implemented** — PASS. Doc table lists exactly
  the five implemented `join_status` states + `join_keying` + the
  `server_timings_join_<status>` caveat format; module JSDoc carries the
  same list with a keep-in-sync pointer.
