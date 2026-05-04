# Usability — bridge SSE deadlock (Sprint 1.21 c21 evidence)

**Filed:** 2026-05-04
**Severity:** high (single occurrence sinks an entire sweep cell; CLAW_TIMEOUT does not enforce)
**Sweep:** explore-c21-20260503-2013, rep 1, tier 16
**Witness run_id:** `3e243a87-df08-4998-8392-ed78d029e098` (`word-search` v2.1)

## TL;DR

A claw run waited **4570 seconds** for an LLM response that never arrived. `CLAW_TIMEOUT=285s` was set in `lib/claw.js` and recorded in `run_summary.timeout_ms`, the `terminal_status` was eventually written as `"timeout"` and `passed: null`, but **the process did not actually die at 285s** — it kept the HTTP/SSE connection open until something at a much higher layer (16× the configured timeout) finally killed it. The c21 sweep stalled until that single cell unblocked.

This is distinct from the normal claw-timeout path observed in the same sweep (rep 2 t64 `needle-haystack` and `two-bucket` both hit 285s cleanly). Whatever lib/claw.js does on `timeoutMs` works for *some* stalls and not *this kind*.

## Smoking-gun evidence

### `run_summary.json`

```
run_elapsed_ms:    4570782   (76 min 11 s)
timeout_ms:        285000    (4 min 45 s configured)
iter_count:        4
terminal_status:   "timeout"
timeout:           true
exit_code:         null      ← process did not exit cleanly
join_status:       "stream_aborted_mid_run+count_mismatch"
censored:          true
total_model_elapsed_ms:   null   ← per-iteration timing all unavailable
total_server_total_ms:    null
total_server_decode_ms:   null
total_server_prompt_eval_ms: null
```

The `null`s on every per-iteration timing field plus `bridge.iterations.jsonl` containing **0 rows** is the load-bearing signal. The slicer that joins `_bridge.jsonl` events into per-run telemetry could not find any matching events for this run's window — meaning the bridge either did not log iter 5 at all, logged it with a timestamp the joiner couldn't match, or logged a stream-abort and nothing else.

### `iterations.jsonl` (4 model iterations recorded; all per-iteration timing fields null)

| iter | input_tokens | output_tokens | n_tools | comment |
|---|---|---|---|---|
| 1 | 6263 | 54   | 2 | initial reads |
| 2 | 1238 | 42   | 1 | read |
| 3 | 986  | 1724 | 1 | `write_file` — substantial code write |
| 4 | 5735 | 47   | 1 | `bash` — short command |
| **5** | — | — | — | **never recorded; stalled here** |

### Session transcript (last 4 messages)

```
assistant  [text + tool_use]                  (iter 4)
tool       [tool_result: bash]                (iter 4 result returned)
                                              ── end of recorded session ──
```

The model received the iter-4 bash tool_result and was supposed to make iter 5's request. The session log has no further entries. claw was waiting on iter 5's stream.

## Hypothesis

iter 5's HTTP/SSE response from `llama-server` (via the LiteLLM bridge) deadlocked partway through:

1. claw POSTs `/v1/messages` (or whichever streaming endpoint) to the bridge.
2. Bridge dispatches to llama-server.
3. llama-server starts streaming SSE.
4. A chunk gets dropped, or the connection enters a half-open state (TCP keepalive masking it), or the bridge's stream handler hangs awaiting a chunk that never arrives.
5. claw's HTTP client sits in a blocking read on the SSE stream, holding the connection.
6. The configured `timeoutMs=285000` in claw's runClaw watchdog *does not unblock the read* — most likely it sends SIGTERM and `await`s child-exit, but the child is stuck in a syscall that ignores SIGTERM (or the watchdog is only an outer Promise race that doesn't kill the stuck HTTP request).
7. ~76 minutes later, some upper-layer mechanism (TCP idle, OS-level half-close detection, docker compose run, or node:test's outermost `{ timeout: CLAW_TIMEOUT + 20_000 }` finally cascading once the underlying HTTP errors out) closes the connection. claw exits, the harness records `terminal_status: timeout` after the fact.

This is consistent with the c3 `ini-parser` "1250s → 13s collapse" observation already documented in [good-tests.md](../../test/docs/difficulty-pack/good-tests.md): the same bridge-SSE-instability class can produce wildly variable wallclock under apparently stable model conditions.

## Why this matters

1. **Sweep economics.** A 6-cell N=3 sweep can plausibly take an hour at typical durations. One SSE deadlock makes that 2.5 hours, with no operator-visible signal during the stall. We just lived through this on c21.
2. **Telemetry damage.** `bridge.iterations.jsonl` empty + all timing fields null + `censored: true` means **the affected run is unusable for any per-iteration analysis** (token-rate, server vs queue split, prompt-eval distribution). One deadlock contaminates one row in a way that doesn't always survive aggregation cleanly.
3. **CLAW_TIMEOUT is misleading.** Operators see `timeout_ms: 285000` and assume that's the worst-case per-run wall. It is not. The configured timeout silently tolerates 16× overruns for at least one stall class. This is a load-bearing assumption everywhere we plan sweep durations.
4. **Mitigation already shipped — at the wrong layer.** The c21-follow-up `entrypoint.sh` change wraps `node --test` in a per-test SIGKILL ceiling (default 600s). That bounds the worst case at the *test-runner* level but does not fix the underlying issue: claw itself thinks it timed out at 285s, the recorded telemetry says it did, and the bytes on the wire say otherwise.

## Suggested next steps (for whoever picks this up)

1. **Reproduce.** The minimal repro is probably easier than full c21: run a single claw call to the bridge with a synthetic stall injected (e.g., kill the llama-server mid-stream, or use a slow proxy). The expected behavior is "claw aborts the in-flight request at `timeoutMs`, returns a terminal_status of `timeout` within ~`timeoutMs` wall, exit_code is non-null". Compare to actual.
2. **Audit `runClaw` in `host/test/lib/claw.js`.** Look for: (a) whether the `timeoutMs` watchdog actually `child.kill('SIGKILL')`s the spawned claw child (or only sends SIGTERM and `await`s exit), (b) whether the watchdog races against child exit or sequentially awaits both. Want: race + hard SIGKILL fallback at, say, `timeoutMs + 5_000`.
3. **Audit claw-side HTTP timeout.** claw is the streaming HTTP client; it needs an explicit per-request `request_timeout` AND a per-stream-chunk read timeout. Without the latter, an SSE that stalls between chunks blocks indefinitely.
4. **Bridge-side timeout.** Set LiteLLM's `request_timeout` and `stream_timeout` to something like 120s. This terminates an upstream stall at the bridge layer regardless of what claw or the test runner does — caps the longest single LLM call.
5. **Telemetry guard.** When `join_status == "stream_aborted_mid_run+count_mismatch"` AND `total_model_elapsed_ms == null`, the harness should write a louder marker than `censored: true`. Today this is easy to miss in row aggregation.

## Artifacts

- `host/test/.claw-runtime/3e243a87-df08-4998-8392-ed78d029e098/run_summary.json`
- `host/test/.claw-runtime/3e243a87-df08-4998-8392-ed78d029e098/iterations.jsonl` (4 rows)
- `host/test/.claw-runtime/3e243a87-df08-4998-8392-ed78d029e098/bridge.iterations.jsonl` (0 rows — load-bearing emptiness)
- `host/test/.claw-runtime/3e243a87-df08-4998-8392-ed78d029e098/sessions/990e10b3394addcf/session-1777858026293-0.jsonl` (transcript ends at iter-4 tool_result)
- `host/test/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl` — registry row for this run
- `/tmp/c21-sweep.log` — driver log; the runaway shows up around 02:43 UTC

## Related

- [good-tests.md](../../test/docs/difficulty-pack/good-tests.md) — `ini-parser` entry under "Set aside — under redesign review" notes a similar 1250s→13s SSE-noise collapse from c3. Same suspected class.
- [grep-search-claw-runtime-leak.md](../../test/docs/usability-pack/memos/grep-search-claw-runtime-leak.md) — sibling usability finding (U1) from the same sweep arc.
- [TODO-1.21-bridge-error-diagnostics.md](TODO-1.21-bridge-error-diagnostics.md) — sibling bridge anomalies (orphan_transcript_record, stream_aborted_mid_run, spurious-500) filed alongside this one.
- The Sprint 1.21 c21-follow-up `entrypoint.sh` change (commit `51d4cf6`) is a *guard*, not a fix; this issue remains open as the underlying cause.
