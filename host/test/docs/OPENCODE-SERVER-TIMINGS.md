# Config-B server prompt/decode timings (issue #022)

> **Deferred — post-v1, not shipped.** This is the spec for issue **#022**; the runner
> integration is **blocked on the #021 transcript adapter** (iteration records) and stays
> opt-in / off-by-default even once built. Read everything below as the contract #021/#016
> implement, **not as current behavior**. Revival path:
> [research-salvage-next-tranche §4](../../../research/research-salvage-next-tranche-20260610.md).

**Status:** capture mechanism + parse/join library shipped. #010 (`runOpenCode`)
landed *without* timings capture by design — the ordinal join needs #021's iteration
records — so the cursor-bracketing + join wiring lands with **#021** (transcript
adapter) and the report render with **#016**. The contracts below are what those call.
**Optional / post-v1. Opt-in. Off by default.**

## Why this exists

Config A (claw) recovers the llama.cpp prompt/decode split from the LiteLLM
`_bridge.jsonl` time-window join ([lib/claw.js](../lib/claw.js) `sliceBridgeLog`).
Config B bypasses LiteLLM, so that join is gone — but it is the **same llama.cpp
engine** and emits the **same** `timings.prompt_ms` / `timings.predicted_ms`. So the
split is *recoverable* for B, not lost (plan §1, §4.4). This module recovers it into
the **same iteration-record field names** so the split renders on both sides.

## Enable flag

`OPENCODE_SERVER_TIMINGS=1`. Anything else (unset, `0`, `true`) → disabled. When
disabled: nothing is captured, no sidecar is written, and the report **omits** the
split entirely — no implied parity, no v1 dependency.

## Capture mechanism (primary): log cursor over the server's own log

The OpenCode-dedicated `llama-server` already runs with `--metrics`
([opencode-server](../../llama-server/scripts/opencode-server)) and writes one
human-readable timing block per completed request to its log
(`/tmp/opencode-llama-server.log`, or `-16.log` for tier-16):

```
slot print_timing: id  0 | task 113 |
prompt eval time =     132.30 ms /    23 tokens ( 5.75 ms per token, 173.85 tokens per second)
       eval time =     440.69 ms /    18 tokens (24.48 ms per token,  40.84 tokens per second)
      total time =     572.99 ms /    41 tokens
```

These lines carry **no wall-clock timestamp**, so a run can't be sliced by a time
window the way `_bridge.jsonl` is. Instead the runner brackets a run by the log's
**byte length** at start and finish (a "log cursor"). The phase-swap topology means
one server + one client, so the slice between offsets is exactly this run's requests
and pairing is **ordinal**: the k-th completed request → the k-th iteration. (Same
ordinal pairing claw ultimately uses after its time-window slice.)

This needs no new runtime component and adds **no hop to the measured wall-clock**.

### Runner integration contract (wired by #021, brackets `runOpenCode`)

> #010 shipped `runOpenCode` **without** these calls by design — the ordinal join has
> nothing to attach to until #021 emits Config-B iteration records. #021 adds the
> cursor-bracketing around the `opencode run` spawn plus the join below.

```js
import {
  serverTimingsEnabled, defaultServerLogPath,
  openServerLogCursor, closeServerLogCursor, captureServerTimings,
} from './opencode_server_timings.js';

const enabled = serverTimingsEnabled();
const cursor = enabled ? openServerLogCursor(defaultServerLogPath(tier)) : null;
// ... run `opencode run ...` ...
const closed = enabled ? closeServerLogCursor(cursor) : null;
const timings = enabled ? captureServerTimings(closed) : [];
```

Then, once the transcript adapter (#021) yields Config-B iteration records:

```js
import { joinServerTimings, writeServerTimingsSidecar } from './opencode_server_timings.js';

const join = joinServerTimings(iterRecords, timings, { enabled });
writeServerTimingsSidecar(runDir, runId, join); // -> server.timings.jsonl
```

`server.timings.jsonl` is keyed by `run_id` + `iter` (+ `assistant_message_index`),
so it JOINs to `iterations.jsonl` exactly like the claw sidecars. `join_status` ∈
`{ disabled, no_server_timings, ok, count_mismatch }` (claw vocabulary).

## Capture mechanism (alternative, forward-compat): logging proxy

A thin proxy on the OpenCode→server hop could record each response's `timings` JSON
with timestamps. `normalizeProxyRecords` converts that shape into the same normalized
record, so `joinServerTimings` works unchanged — proxy records sort by
`request_started_ms` instead of relying on ordinal log order. **No live proxy ships
here:** the log-cursor path is sufficient and perturbs nothing on the timed hop. Build
the proxy only if a future need (e.g. interleaved clients) breaks the ordinal
assumption.

## Report integration contract (#016)

```js
import { summarizeServerTimings, renderServerDecodeSplit } from './opencode_server_timings.js';

const md = renderServerDecodeSplit(
  [
    { label: 'claw-rig',   summary: summarizeServerTimings(clawIters) },
    { label: 'opencode-a', summary: summarizeServerTimings(openCodeIters) },
  ],
  { enabled: serverTimingsEnabled() },
);
// md === '' when disabled OR when no side has data -> the report omits the section.
```

`renderServerDecodeSplit` returns `''` (omit, no implied parity) when disabled or
when no side has data; otherwise a markdown table of prompt-eval / decode / server-
total per side. This satisfies the #016 AC "server-decode timing is omitted unless
built (not implied)".

## Tests

[__tests__/lib/opencode-server-timings.test.js](../../__tests__/lib/opencode-server-timings.test.js)
— parse (real log blocks, decode-only, missing-total reconstruction, regex-bleed
guard), log-cursor byte slicing (incl. rotation safety), ordinal join (ok / both
count-mismatch directions / no-timings / disabled), proxy normalizer, sidecar keying,
and the render-or-omit contract. Run in the node:22 unit-test container:

```
docker run --rm -v "$PWD:/test" -w /test node:22-bookworm-slim \
  node --test __tests__/lib/opencode-server-timings.test.js
```
