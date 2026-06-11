# Verdict script robustness: empty-median guards, one shared isEligible

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), finding 15/15 and cut-CL3 — inline comments
on <https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

1. **Empty-median crash.** In `config-ab-verdict.mjs`, `median`/`pctile`
   return null for empty input and the Rule 0a.2 wall-clock block chains
   `.toFixed(1)` unguarded (`Math.max(...[])` would print `-Infinity`).
   `end_time: null` is schema-legal and real (degraded sidecars), and such
   rows stay pass-rate-eligible — so a side whose rows all lack timestamps
   renders Rule 0a.1 and then dies with a raw TypeError (the catch handles
   only PairedBootstrapError). Guard the empty case and print "wall-clock
   unavailable (n=0 rows with timestamps)" instead; same for `durElig`.

2. **One eligibility predicate.** The script's lines-74-77 inline
   `isEligible` is a private copy of the unexported predicate in
   `lib/paired_bootstrap.js`, while its own attrition header prints
   "eligibility per lib/paired_bootstrap.isEligible". Export `isEligible`
   from the lib and import it here, making the provenance claim true and
   the rule single-sourced (the lib copy's `row != null` guard comes along
   for free). No other config-ab script carries a copy.

## Acceptance criteria

- [x] A registry fixture whose treatment rows all have `end_time: null` renders a complete verdict (pass-rate sections + "wall-clock unavailable"), exit code unchanged, no stack trace
- [x] `lib/paired_bootstrap.js` exports `isEligible`; `config-ab-verdict.mjs` imports it; `grep -n "typeof r.passed" host/test/scripts/config-ab-verdict.mjs` finds no inline copy
- [x] Existing verdict output on a healthy registry is byte-identical apart from the new guard path (diff against a pre-change run)
- [x] Runner-image suite green (paired-bootstrap tests extended for the export)

## Blocked by

None - can start immediately

## Result

Done 2026-06-10. Files changed: `host/test/scripts/config-ab-verdict.mjs`
(import `isEligible`, drop the inline copy, guard the Rule 0a.2 block),
`host/test/lib/paired_bootstrap.js` (`export` on `isEligible` + provenance
comment, semantics untouched), `host/test/__tests__/lib/paired-bootstrap.test.js`
(2 new cases pinning the exported predicate's contract), new
`host/test/__tests__/scripts/config-ab-verdict.test.js` + 2 fixture registries
under `host/test/__tests__/scripts/fixtures/`.

Per-AC evidence:

1. **Timestamp-free side renders a complete verdict.** Pre-change repro (the
   committed `HEAD` script via `git show`, run on
   `fixtures/registry-no-treatment-timestamps.jsonl`): renders Rule 0a.1 +
   the claw-rig wall-clock line, then dies — `TypeError: Cannot read
   properties of null (reading 'toFixed')` at `main
   (config-ab-verdict.mjs:161)`, exit 1. Post-change, same fixture: full
   render through `=== VERDICT (tier-64) ===`, side line
   `opencode-a  wall-clock unavailable (n=0 rows with timestamps)`, ratio
   line `wall-clock unavailable (n=0 rows with timestamps)  →  NOT MET`,
   verdict line `Rule 0a.2 … : NOT MET (wall-clock unavailable)` →
   conservative KEEP, exit 0, empty stderr. The independent durElig branch
   (only timestamped row is a `harness_error`) prints `eligible-only
   wall-clock unavailable (n=0 rows with timestamps)` inside an otherwise
   numeric side line — covered by the second fixture.
2. **Single predicate.** `grep -n "typeof r.passed"
   host/test/scripts/config-ab-verdict.mjs` → no matches (exit 1).
   `paired_bootstrap.js:80` is `export function isEligible(row)`;
   the script imports it at line 38. Recursive grep over `scripts/` + `lib/`
   confirms no other config-ab script ever carried a copy.
3. **Byte-identical healthy output.** Before/after runs of
   `node scripts/config-ab-verdict.mjs
   docs/data/run_registry.config-ab-20260606-165548.jsonl --tier 64`
   (canonical tier-64 RETIRE registry, per docs/data/README.md): both exit 0,
   `diff`/`cmp` clean — the guard path is unreachable on a registry with
   timestamps, as designed.
4. **Suite green.** Container full suite (`node --test --test-concurrency=1
   __tests__/lib/*.test.js __tests__/scripts/*.test.js`): 164 tests /
   163 pass / 1 skip / 0 fail, vs the 143/142/1/0 baseline (extra tests are
   this issue's 7 plus other in-flight agents' additions; all pass).

Note for #010 (telemetry fields): `isEligible(row)` is now public API —
boolean, nullish-safe (`row != null` guard), keyed only on
`typeof row.passed === 'boolean'` and `terminal_status ∉ {harness_error,
interrupted}`. New telemetry fields won't affect it, but any new
terminal_status enum value will default to ELIGIBLE unless added to the
predicate — extend it in the lib, never re-inline.
