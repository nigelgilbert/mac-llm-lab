# Server-decode `timings` proxy for Config B (optional)

**Type**: AFK

**Status:** ✅ Done — capture mechanism + parse/join library shipped behind
`OPENCODE_SERVER_TIMINGS=1`; runner (#010) / report (#016) wiring is a documented
contract awaiting those tickets. See
[OPENCODE-SERVER-TIMINGS.md](../host/test/docs/OPENCODE-SERVER-TIMINGS.md).
(optional / post-v1)

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4, §4.7

## What to build

Capture the second `llama-server`'s `timings.prompt_ms` / `timings.predicted_ms` for
Config B so the server prompt/decode split is renderable on **both** sides (it's not
lost just because OpenCode bypasses LiteLLM — same llama.cpp engine emits the same
timings). Either parse the server's own logs or interpose a thin logging proxy on the
OpenCode→server hop. Optional / post-v1 secondary metric.

## Acceptance criteria

- [x] Per-iteration `server_prompt_eval_ms` / `server_decode_ms` captured for Config-B runs
      — `parseServerLogTimings` extracts them from the OpenCode server's own
      `--metrics` log (`/tmp/opencode-llama-server[-16].log`), bracketed by a per-run
      byte-offset **log cursor** (`open/closeServerLogCursor`).
- [x] Values join to the corresponding runs (keyed compatibly with the iteration
      records) — `joinServerTimings` pairs ordinally (k-th request → k-th iteration);
      `writeServerTimingsSidecar` emits `server.timings.jsonl` keyed by `run_id` +
      `iter` (+ `assistant_message_index`), same keying as `iterations.jsonl`.
- [x] The report can render server prompt/decode split for both configs when enabled
      — `renderServerDecodeSplit([claw, opencode], { enabled })` renders a per-side
      table; `summarizeServerTimings` aggregates each side.
- [x] When disabled, the report omits the metric (no implied parity) — opt-in via
      `OPENCODE_SERVER_TIMINGS=1`; render returns `''` when disabled OR when no side
      has data. No hard dependency for v1.

## Delivered

- [host/test/lib/opencode_server_timings.js](../host/test/lib/opencode_server_timings.js)
  — enable flag, log cursor, parser (log + proxy sources), ordinal join, sidecar
  writer, summarize + render-or-omit.
- [host/test/__tests__/lib/opencode-server-timings.test.js](../host/test/__tests__/lib/opencode-server-timings.test.js)
  — 29 unit tests, green in the node:22 container; parser validated against the live
  30-request `-16.log`.
- [host/test/docs/OPENCODE-SERVER-TIMINGS.md](../host/test/docs/OPENCODE-SERVER-TIMINGS.md)
  — mechanism + integration contract for the runner (#010) and report (#016).

Capture mechanism choice: **log cursor over the server's own `--metrics` log**, not a
live proxy — it needs no new runtime component and adds no hop to the measured
wall-clock. The proxy path is kept forward-compatible via `normalizeProxyRecords` but
not shipped.

## Blocked by

- #005
