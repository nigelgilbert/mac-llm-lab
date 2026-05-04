# TODO — Bridge error diagnostics (Sprint 1.21 → Sprint 1.5/2 + usability-harness)

**Author:** Sprint 1.21 difficulty-pack work (operator + Claude Opus 4.7)
**Created:** 2026-05-03
**Owner:** Sprint 1.5/2 + usability-harness (per user direction)
**Status:** open; not blocking 1.21, but blocking publishable Sprint 2 confirmatory at N=60

---

## TL;DR

Across c1/c2/c3 of the Sprint 1.21 difficulty-pack screening, `host/litellm/` produced two distinct anomaly classes that materially confound tier-eval results. **Neither is yet diagnosed at the bridge level.**

| Anomaly | Severity | c3 rate | Treatment |
|---|---|---|---|
| `orphan_transcript_record` | telemetry-only (runs complete fine) | **51/54 = 94%** | post-hoc filter at registry-reader layer; investigate when bridge work reopens |
| `stream_aborted_mid_run+count_mismatch` + null timings | runs killed by claw timeout, model never had a chance | **3/54 = 5.5%** | exclude from pass-rate calcs; investigate at bridge level |
| Spurious `Context size has been exceeded` 500 (c1 only) | runs killed; misleading 5xx wrapper around llama-server ctx error | c1: 3/36, none in c3 | suppress/fix at bridge — claw can't parse malformed JSON |

---

## Anomaly 1 — `orphan_transcript_record` (universal, telemetry-only)

**What:** Every `host/test/.claw-runtime/<run_id>/run_summary.json` writes `join_status: "orphan_transcript_record"` with `timing_caveats: ["join_status_orphan_transcript_record", "all_iterations_streaming_no_decode_split: server_prompt_eval_ms and server_decode_ms unavailable per iteration; only server_total_ms (LiteLLM-observed upstream wallclock) populated."]`. Per-iter rows in `iterations.jsonl` have `request_started_ms`, `request_finished_ms`, `model_elapsed_ms` all `null`. Wallclock + token counts ARE populated; only per-iter timing breakdown is missing.

**Why benign:** `terminal_status`, `passed`, `iter_count`, `total_input_tokens`, `total_output_tokens` are all correct; verifier validates correctness. "Orphan" appears to mean: registry's transcript-record-id-chain doesn't link iter N to iter N-1 — likely the bridge generates fresh transcript IDs per request rather than threading a single conversation ID, or SSE chunks aren't correlated by harness.

**Why still a problem:** Per-iter timing (`server_decode_ms`, `server_prompt_eval_ms`) is permanently null — can't answer "did model spend more decode time on test X than Y?" or "at what iter does decode latency tick up?" Also: c1+c2+c3 reads of "empty trace" / "1-iter orphan" failures conflated (a) the universal orphan flag (always present, bridge-telemetry bug) with (b) rare cases where `iter_count = 0/1` because the model genuinely emitted no parsed tool call before claw died on parse error (real model-behavior signal masked by bridge bug).

**Reproductions (c3 — any of 54):**
- `host/test/.claw-runtime/7b13b047-8dba-4964-94d0-8f7851d01e41/` — book-store t16 rep1
- `host/test/.claw-runtime/50e35139-e212-48ff-847b-afdf75c9e371/` — cascade-eight t16 rep1
- `host/test/.claw-runtime/aa6fe58a-7feb-4fbf-aef7-c5b6ff2e454b/` — book-store t32 rep1 (passed cleanly)

**Action:**
1. Reproduce: any c3 run; verify all `*_ms` fields null in `iterations.jsonl` + `run_summary.json`.
2. Trace bridge side: SSE/streaming path in `host/litellm/patches/` — likely `streaming_iterator.py`; possibly `host/litellm/callbacks/`.
3. Hypothesis: harness's transcript-join logic (`host/test/lib/registry.js` or `lib/run_row.js`) expects per-request bridge-side IDs threaded across iterations; bridge isn't emitting them in a form the harness recognizes.
4. Fix at either layer (bridge emits stable IDs, OR harness accepts bridge's actual format). Cheaper at harness if bridge format is stable.

---

## Anomaly 2 — `stream_aborted_mid_run+count_mismatch` (genuine transient, ~5.5%)

**What:** Runs where claw eventually hits 285s timeout (`exit=null`, `terminal_status: timeout`) AND `run_elapsed_ms` vastly exceeds budget (700–1250s vs 285s). Per-iter `request_started_ms` null on every iter. Bridge stream got aborted mid-flight; claw never received stream-end; claw eventually timed out from above.

**Why it matters:** These LOOK like model failures (terminal_status = timeout) but the model never had a fair chance — bridge dropped the stream. Treating as "model couldn't solve in 285s" inflates failure rate. At Sprint 2 N=60/cell, ~3-5 spurious failures/cell could shift Wilson CIs by 5-10pp.

**Reproductions (c3 — all 3):**
- `host/test/.claw-runtime/eca7672b-2c59-4c68-99cc-545ce0453c28/` — book-store t32 rep2 (719s wallclock, 11 iters, timeout)
- `host/test/.claw-runtime/db9284c2-430e-42c6-8f0a-f2240c86c1ee/` — ini-parser t32 rep2 (1250s wallclock, 14 iters, timeout) — **worst case; ~21 min hang on a test that normally solves in 15-30s**
- `host/test/.claw-runtime/2a29b5ac-0b4c-4b12-a58c-6342f2bfcc84/` — wordy t32 rep3 (285s wallclock, 3 iters, timeout)

**Action:**
1. 1250s ini-parser is cleanest repro: normally-fast test, 21 min wallclock vs 285s budget, only 14 iters captured. Bridge held SSE stream open without emitting events.
2. Hypothesis: llama-server hang or litellm internal retry/fallback surfaced as "still streaming" without claw able to detect stall. Maybe aggravated by sustained chip load (long sweep).
3. Possible fixes:
   - Bridge-side stream watchdog: if no SSE events for >N seconds, abort upstream + return 504 to claw.
   - Pass-through llama-server `keep_alive_ms` health check — kill upstream if llama-server stops emitting tokens.
   - Document expected "no model output for >X seconds = bridge hang" so claw can short-circuit.

---

## Anomaly 3 — Spurious `Context size has been exceeded` 500 (c1 only, not in c3)

**What:** In c1, three cells (`grade-school.t32` rep2, `ini-parser.t32` rep2, `alphametics.t32` rep1) failed with claw stderr:

```
[error-kind: unknown]
error: failed to parse Anthropic response for model anthropic/claw-llama:
  missing field `type` at line 1 column 199;
first 200 chars of body: {"error": {"message":
  "litellm.MidStreamFallbackError: litellm.APIConnectionError:
   APIConnectionError: OpenAIException - Context size has been exceeded.",
  "type": null, "param": null, "code": "500"}}
```

Triggering prompts were ~5700 tokens — far below the 65536 ctx limit. The "Context size has been exceeded" message was upstream-generated but spurious.

**Why it matters:**
- Malformed JSON (no `type` field) crashes claw's response parser → claw exits 1 → harness records `terminal_status: error`.
- Misleading: implies real model-config mismatch but prompts were under ctx; operators waste time investigating non-issue.
- Did NOT see in c3, but no-repro ≠ fix — could be sampler/state/load-dependent.

**Reproductions (c1):**
- `host/test/.claw-runtime/cf6c01ff-09c8-405c-a3c7-11c314be7901/` — grade-school t32 (empty_run, 0 iters)
- `host/test/.claw-runtime/6c947190-c1af-4d09-82c7-0dd67350002b/` — ini-parser t32 (empty_run, 0 iters)
- `host/test/.claw-runtime/80b8bb2d-3c58-4b2f-bafc-a5866d8e9af4/` — alphametics t32 (orphan, 1 iter, 5704 input tokens)

Snapshot: `host/test/docs/difficulty-pack/explore/c1/snapshots/{grade-school,ini-parser,alphametics}.t32.jsonl`
Sweep log: `host/test/logs/OVERNIGHT-SCREEN-explore-c1-20260502-1735.md` lines 281-305

**Action:**
1. Reproduce: load llama-server with a stateful predecessor (forth.t32 285s timeout immediately preceded c1 grade-school + ini-parser failures), then send fresh small prompt — see if bridge state pollutes new request.
2. Inspect litellm's `MidStreamFallbackError` handling — error wrapping produces the `"type": null` JSON claw can't parse. Either:
   - Fix upstream malformed-JSON wrapper in litellm so `type` always populated, OR
   - Have claw tolerate `type: null` (less ideal — patches symptom).
3. Distinguish "real ctx-overflow 400" (legitimate at t16 32k under iter-storm — see c3 examples) from this "spurious 500 ctx-overflow under-budget" case. 400 path fine; 500 path broken.

---

## Aggregate quantification

| Cycle | Cells | orphan | stream_aborted | spurious 500 | Combined non-OK |
|---|---|---|---|---|---|
| c1 | 36 | 36/36 (100%) | unknown (didn't filter) | 3/36 (8.3%) | 100% telemetry / 8.3% real |
| c2 | 18 | 18/18 (100%) | none observed | 0 | 100% / 0% |
| c3 | 54 | 51/54 (94%) | 3/54 (5.5%) | 0 | 94% / 5.5% |

Orphan flag has been **silently 100% the whole time**; only noticed when it coincided with 0/1-iter outcomes that broke pass-rate analysis. Genuine bridge-level failures (5.5% c3) tolerable for screening but should be quantified or post-hoc filtered before Sprint 2 N=60.

---

## Recommended next moves

1. **Immediate (no bridge work):** registry-reader filter excluding rows where `terminal_status = timeout AND join_status = stream_aborted_mid_run+count_mismatch`. Document exclusion rate in Sprint 2 matrix output. Doable at `host/test/lib/` or in `explore-summarize.mjs`.
2. **Sprint 1.5/2/usability-harness:** investigate orphan + stream_aborted at bridge level. Orphan is high value (recovers per-iter timing). stream_aborted is medium value (reduces N=60 confound).
3. **Defensive:** add llama-server stream-stall watchdog at bridge (anomaly 2) — independent of root-cause work. If no SSE for N seconds, abort upstream + return 504. Cheap insurance.
4. **Verify spurious-500 stays gone:** if no recur in c4/c5, deprioritize. If returns, prioritize — conflates legitimate ctx-overflow signal with bridge state corruption.

## References

- Sprint 1.21 plan: `host/test/docs/difficulty-pack/PLAN.md`
- c3 summary: `host/test/docs/difficulty-pack/explore/c3/summary.md` (gitignored; regenerable from the c3 registry JSONL)
- Bridge code: `host/litellm/` (parent of this dir), `host/test/lib/bridge.js` (claw-side client)
- Snapshot tooling: `host/test/scripts/explore-summarize.mjs`
- Sibling bridge memo (SSE deadlock witness): [`bridge-sse-deadlock.md`](bridge-sse-deadlock.md)
