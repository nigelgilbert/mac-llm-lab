# Transcript parser fidelity: censored-run tool errors, one numOrNull, safe sqlite fallback

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), cut findings C13, CL5, C8 — verified during
the review of <https://github.com/nigelgilbert/mac-llm-lab/pull/6> (not
posted; details below are the canonical statement).

## What to build

Three fixes in `host/test/lib/opencode_transcript.js` (one shared with
`opencode_server_timings.js`):

1. **Don't count timeout-killed in-flight tool parts as errors.** The
   tool-error classifier treats any part `state.status !== 'completed'` as
   an error. Timeout runs are hard-killed (`docker rm -f`), leaving
   `pending`/`running` parts in the DB — measured during review: 79 of 350
   timed-out runs under `.opencode-runtime` carry such parts vs 0 of 80
   non-timeout controls — inflating `error_tool_call_count` and forcing
   those calls' `workspace_changed` contribution to false on censored rows
   (diagnostic outputs only today: run_summary + W4 packets; registry rows
   unaffected). Classify `pending`/`running` parts on censored runs as
   `truncated` (excluded from error counts, surfaced as their own counter)
   rather than errors.

2. **One numOrNull.** The transcript re-declares `numOrNull` with strict
   typeof-number semantics (`'42'` → null) while its already-imported
   dependency `opencode_server_timings.js` has a Number()-coercing version
   (`'42'` → 42). The domains are disjoint today, so this is a latent
   consolidation hazard — resolve it deliberately: export the coercing
   version (the log parser needs coercion for regex captures), give the
   strict one a distinct name (`strictNumOrNull`) or a documented option,
   and kill the same-name duplication. Same for the duplicated
   length-guarded JSONL-writer line if a shared helper falls out naturally.

3. **Safe sqlite-CLI fallback.** `readViaSqliteCli` splices the session id
   via `sql.replace('?', `'${bind}'`)` — unescaped, and String.replace
   interprets `$`-patterns. Unreachable today (ids are `ses_`+base62,
   node:sqlite exists in the pinned image), but it's a one-line hazard on a
   degrade path: escape quotes / use a `$&`-safe replacement (or pass the
   query via `-cmd`/stdin with a parameter), so the fallback can't corrupt
   the query if either invariant moves.

## Acceptance criteria

- [x] A fixture DB with a `running` tool part + censored run yields `error_tool_call_count` excluding it, a nonzero truncated-call counter, and `workspace_changed` unaffected by the truncated part; an actually-errored part still counts
- [x] Exactly one exported `numOrNull` (coercing) across the two modules; the strict variant has a distinct name; unit tests pin both behaviors ('42', '', true)
- [x] A unit test feeds a bind value containing `'` and `$&` through readViaSqliteCli's SQL construction and asserts the emitted SQL/argv is well-formed
- [x] Runner-image suite green; W4 packet builder consumes the new truncated counter (or documents it as pending) — **documented as pending, see Result**

## Blocked by

None - can start immediately

## Result (2026-06-10)

All three fixes landed in `host/test/lib/opencode_transcript.js` (+ the minimal
`numOrNull` export in `host/test/lib/opencode_server_timings.js`); tests
extended in `host/test/__tests__/lib/opencode-transcript.test.js` and
`opencode-server-timings.test.js`. No fixture files needed — the AC1 fixture DB
is built inside the test via `node:sqlite` in a tmpdir.

**AC1 — censored-run in-flight parts → truncated.** Classifier now computes
`isTruncated = timeout && status ∈ {pending, running}`; truncated calls are
excluded from `isError`, carry per-call `result_truncated: true`,
`workspace_changed: null` (unknown — neither the pre-fix forced `false` nor a
counted `true`), and roll up into the new run_summary field
`truncated_tool_call_count` plus a `truncated_tool_calls: N …` timing caveat.
Evidence: `readOpenCodeSession + censored run — fixture DB with in-flight part
(#017)` builds a real SQLite DB (session/message/part tables, the way the
gated evidence-DB test reads them) holding a `running` write part AND a
`status:'error'` edit part, reads it via `readOpenCodeSession`, and asserts
`error_tool_call_count === 1` (the errored edit only),
`truncated_tool_call_count === 1`, `workspace_changed_count === 0`, write part
`result_truncated === true` / `workspace_changed === null`. Pure-normalizer
twins cover `pending`, the non-censored contrast (running part on a
non-timeout run still errors — behavior preserved), and the happy run
(`truncated_tool_call_count === 0`).

**AC2 — one numOrNull.** The coercing version is now the single export:
`export function numOrNull(v)` in `opencode_server_timings.js` ('42' → 42; the
log parser needs coercion for regex captures). The transcript's strict variant
is renamed + exported as `strictNumOrNull` ('42' → null) — same-name
duplication gone. Tests pin both at '42' / '' / true: coercing → 42 / 0 / 1
(Number() edges documented as unreachable from the regex call sites); strict →
null / null / null; plus a cross-module divergence assertion.

**AC3 — safe sqlite-CLI fallback.** `readViaSqliteCli` now builds argv via the
exported `buildSqliteCliArgs(dbPath, sql, bind)`: quotes doubled per SQL
(`'` → `''`) and the splice uses a replacement *function*, so String.replace
$-patterns (`$&`, `$'`, …) are inert. Test feeds bind `ses_o'mal$&ley$'` and
asserts the exact emitted argv/SQL (`'ses_o''mal$&ley$'''`, no `$&` expansion,
placeholder consumed).

**AC4 — suite + W4.** Full suite in the runner image: 179 tests / 178 pass /
1 skip (gated evidence-DB test, DB not mounted) / 0 fail — above the 143-test
baseline (parallel #0xx agents added tests in the same window). **W4 packet
builder (`host/test/scripts/analysis/build-w4-packet.py`): PENDING** — it
already degrades safely (`summary.get(...)` → None for absent fields; its
iteration table reads `result_is_error`, which truncated calls no longer set),
but making it surface `truncated_tool_call_count` / `result_truncated` is a
`scripts/` change outside this issue's file-ownership boundary (Tranche
ownership: scripts/ untouched). One-line follow-up: add
`("truncated_tool_call_count", summary.get("truncated_tool_call_count"))` to
its summary fields and a `trunc` marker beside `err` in the tool column.

**JSONL-writer consolidation: deliberately skipped.** The duplicated
length-guarded writer line lives once in each module; the only shared home
that avoids a circular import is `opencode_server_timings.js`, which this
issue restricts to the mechanical numOrNull export (Tranche-2 reworks that
file next). No helper "falls out naturally" under that constraint.
