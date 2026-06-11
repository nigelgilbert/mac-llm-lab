# Config-B server prompt/decode timings (issue #022, plumbing #007, join keying #008)

**Status:** capture mechanism + parse/join library shipped; runner integration
wired (#021: `runOpenCode` brackets the spawn with the log cursor and
`buildOpenCodeArtifacts` joins + writes the sidecar). #007 added per-tier log
resolution (incl. tier 32), the `OPENCODE_LLAMA_LOG` override, and the
fail-loud unreadable-log path; #008 re-keyed the join on token counts (the
ordinal join mis-attributed the session-title request's timings). The report
render lands with **#016**. **Optional. Opt-in. Off by default.**

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
human-readable timing block per completed request to its log:

```
slot print_timing: id  0 | task 113 |
prompt eval time =     132.30 ms /    23 tokens ( 5.75 ms per token, 173.85 tokens per second)
       eval time =     440.69 ms /    18 tokens (24.48 ms per token,  40.84 tokens per second)
      total time =     572.99 ms /    41 tokens
```

These lines carry **no wall-clock timestamp**, so a run can't be sliced by a time
window the way `_bridge.jsonl` is. Instead the runner brackets a run by the log's
**byte length** at start and finish (a "log cursor"). The slice between offsets is
exactly this run's requests — but **not only the build iterations**: OpenCode fires
a session-title request (`agent=title`, `small=true`) at the **same** server before
the first build iteration (ws020 evidence,
`.opencode-runtime/ws020-evidence/run-logs.txt:56`), so a clean run yields
**n_iterations + 1** blocks. Pairing is therefore **token-keyed** (#008), never
ordinal — see "Join keying" below.

This needs no new runtime component and adds **no hop to the measured wall-clock**.

### The OrbStack/virtiofs freeze, and the capture ladder

Under sweep load on this host (macOS + OrbStack), virtiofs can serve a
**FROZEN view of the host-appended log to ALL containers** — `stat` AND
reads, file-mounts AND dir-mounts, existing AND freshly-started containers —
pinned at (roughly) sweep-start state and recovering only at idle. Observed
live at the T2 boundary (evidence + experiments: `issues/WORKLOG.md`, T2
section): the cursor reproducibly closed with `byteEnd == byteStart` while
the host file grew ~18 KB containing exactly the expected blocks; a 2-second
`stat`-polling monitor container never saw the size move across a whole
sweep; a `/tmp` dir-mount monitor froze identically; a throwaway fresh-mount
relay container read 0 bytes past `byteStart` mid-freeze. Reads are fine in
all of these setups at idle.

Capture therefore climbs a four-rung ladder — each rung helps where it can,
and only the last is authoritative under the freeze:

1. **In-place read** — the normal log-cursor slice from inside the
   eval-runner. Correct on healthy platforms.
2. **`readEofSize` (EOF by read, not stat)** — cursor close derives `byteEnd`
   from read truth (sequential chunk reads from `byteStart` until short
   read), and `readLogSlice` never clamps to the stat size. Beats the
   *stat-only* staleness mode; cannot beat a full read freeze.
3. **Relay (best-effort)** — when the in-place slice comes back empty and the
   driver forwarded `OPENCODE_LLAMA_LOG_HOST` + `OPENCODE_TIMINGS_RELAY_IMAGE`,
   `captureServerTimings` re-reads the slice through a throwaway container
   with a fresh mount of the host path (`relayReadSliceViaDocker`). Helps
   when only this container's view froze; mid-freeze even fresh mounts can be
   frozen (observed), so this rung is best-effort.
4. **Host-slice repair (authoritative under freeze)** — host processes always
   see truth. With `OPENCODE_SERVER_TIMINGS=1`, `run-config-ab.sh` keeps a
   host-side ticker appending `<epoch_ms> <host_log_size>` lines (~3 s
   cadence) to `.claw-runtime/server-log-index.<sweep>.txt` while each arm
   runs. Post-arm, every fresh runDir that closed with the freeze signature
   (`server_timings_join_status: 'no_server_timings'`) is repaired: the
   run_summary's `run_started_ms`/`run_finished_ms` window is mapped to a
   host-log byte window via the index (floor to the tick at-or-before start,
   ceil to the tick at-or-after end, pad one tick each side — the title
   request fires ~at run start, so the leading pad matters), the window is
   extracted **host-side** (`tail -c +N | head -c M`) into
   **`<runDir>/server-log.slice`**, and `scripts/repair-server-timings.mjs
   repair` re-runs the same parse + join and rewrites `server.timings.jsonl`
   + patches `run_summary.json` in the exact original shapes, adding
   `server_timings_repaired_via: 'host_slice'` plus a
   `server_timings_repaired_via_host_slice: …` caveat for provenance. The
   repair is idempotent and never touches `iterations.jsonl`,
   `assertion_result.json`, or the registry.

**`server-log.slice` is retained** as the canonical per-run server-log
artifact: the #002 overflow detection greps the same file. The repair is
best-effort per runDir — a failed repair leaves the honest
`no_server_timings` artifacts in place and never reddens the sweep.

### Log path resolution (#007)

`defaultServerLogPath(tier, env = process.env)`:

1. **`OPENCODE_LLAMA_LOG`** — when set and non-empty it is used **verbatim**, for
   every tier. Same variable the bash launcher honors, and the contract with
   `run-config-ab.sh`: when `OPENCODE_SERVER_TIMINGS=1`, the driver bind-mounts the
   host per-tier log read-only at `/var/log/opencode-llama-server.log` inside the
   eval-runner and sets `OPENCODE_LLAMA_LOG` to that path (host `/tmp` is never
   mounted in the canonical topology).
2. Otherwise the conventional host path per tier: `64` (default) →
   `/tmp/opencode-llama-server.log`, `32` → `…-32.log`, `16` → `…-16.log`.

### Fail-loud on an unreadable log (#007)

The runner only opens a cursor when the flag is on, and at that point a
missing/unreadable log is a **misconfiguration** (wrong tier path, missing bind
mount), not a quiet server. `openServerLogCursor` checks readability at open time;
on failure it writes an explicit `[opencode_server_timings] server log unreadable
at cursor-open: …` line to stderr and marks the cursor, `captureServerTimings`
propagates a marker record (`{ join_error: 'log_unreadable', … }` — the
`serverTimings` array is the only channel from the runner to the transcript-side
join), and `joinServerTimings` surfaces **`join_status: 'log_unreadable'`** —
never the silent `no_server_timings` degrade. Flag off → nothing is opened and the
status stays `disabled`, behavior unchanged.

### Runner integration (wired in `runOpenCode`, #021)

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

Then the transcript adapter (#021, `buildOpenCodeArtifacts`) joins and writes:

```js
import { joinServerTimings, writeServerTimingsSidecar } from './opencode_server_timings.js';

const join = joinServerTimings(iterRecords, timings, { enabled });
writeServerTimingsSidecar(runDir, runId, join); // -> server.timings.jsonl
```

`server.timings.jsonl` is keyed by `run_id` + `iter` (+ `assistant_message_index`),
so it JOINs to `iterations.jsonl` exactly like the claw sidecars.

## Join keying (#008): token counts, not ordinal index

Ordinal pairing (k-th block → k-th iteration) was **systematically wrong**: the
leading title block shifted every pairing by one, so iteration k received request
k−1's prompt/decode split. The join is keyed on data both sides already carry:

- **block side** (log parse / proxy normalize): `prompt_tokens` (prompt-eval'd,
  i.e. *uncached* tokens) and `decode_tokens`;
- **iteration side** (schema-v1 records): `input_tokens` (the uncached input
  count — ws020 evidence: `total = input + output + cache.read`) and
  `output_tokens + reasoning_tokens` (the server decodes reasoning tokens like
  any others).

Matching is **order-preserving and greedy**: for each iteration in order, scan
forward from just past the previously matched block; attach the first **exact**
token match, else the first match within **`TOKEN_MATCH_TOLERANCE = 2`** tokens
per field (override via `opts.tokenTolerance`). The tolerance absorbs per-side
BOS/EOS/stop-token bookkeeping (off-by-one on either side) while staying far
below the gap between distinct requests. A field is only compared when non-null
on **both** sides; at least one comparable field is required. Unmatched blocks
(title/summarize traffic) stay **unattached**; an iteration whose block is
genuinely missing gets nulls **without shifting its neighbors**.

**Ordinal fallback:** when token keying is *impossible* — no block or no
iteration carries any token count (injected/legacy records only; real log and
proxy records always carry counts) — the join falls back to the pre-#008 ordinal
pairing and reports `join_keying: 'ordinal_fallback'`.

## `join_status` / `timing_caveats` vocabulary (implemented states)

`joinServerTimings` returns `{ iterations, join_status, join_keying, join_error,
n_iterations, n_timings, n_matched, n_unmatched_timings }`. `join_status` is one
of exactly:

| `join_status` | Meaning |
| --- | --- |
| `disabled` | Capture flag off. No `server_*` fields added, no sidecar written. |
| `no_server_timings` | Flag on, log readable, but zero timing blocks parsed from the run's slice (all `server_*` fields null). |
| `log_unreadable` | Flag on but the log was missing/unreadable at cursor-open (#007 fail-loud; stderr line emitted; all `server_*` fields null; `join_error` carries the message). |
| `ok` | Every iteration matched its **own** request's block. Extra unattached blocks (title/summarize traffic) are expected and do **not** demote the status — `n_unmatched_timings` counts them. |
| `count_mismatch` | ≥1 iteration could not be attributed a block (genuinely missing/unattributable). That iteration's `server_*` fields are null; matched neighbors are unaffected. |

`join_keying` ∈ `{ 'token', 'ordinal_fallback', null }` (`null` for
`disabled` / `no_server_timings` / `log_unreadable`).

Where the status lands:

- `run_summary.json` → `server_timings_join_status` (distinct from the
  transcript's own `join_status` field), plus one `timing_caveats` entry of the
  form `server_timings_join_<join_status>: #022 log-cursor split (<n_timings>
  timing record(s) over <n_iterations> iteration(s)).` — i.e. exactly one of
  `server_timings_join_ok`, `server_timings_join_count_mismatch`,
  `server_timings_join_no_server_timings`, `server_timings_join_log_unreadable`
  (`disabled` never reaches the join, so no caveat is written).
- `server.timings.jsonl` records → `join_status` (same vocabulary; the file only
  carries rows for iterations that have a split).
- A run repaired by the post-arm host-slice pass (ladder rung 4 above)
  additionally carries `server_timings_repaired_via: 'host_slice'` in
  `run_summary.json` plus one `server_timings_repaired_via_host_slice: …`
  caveat; the stale `server_timings_join_no_server_timings` caveat is
  **replaced** (not stacked) by the post-repair status's caveat.

## Capture mechanism (alternative, forward-compat): logging proxy

A thin proxy on the OpenCode→server hop could record each response's `timings` JSON
with timestamps. `normalizeProxyRecords` converts that shape into the same normalized
record (`timings.prompt_n`/`predicted_n` → `prompt_tokens`/`decode_tokens`), so the
token-keyed `joinServerTimings` works unchanged — proxy records sort by
`request_started_ms` instead of relying on log order. **No live proxy ships here:**
the log-cursor path is sufficient and perturbs nothing on the timed hop. Build the
proxy only if a future need (e.g. interleaved clients) breaks the single-client
log-slice assumption.

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
guard), log-cursor byte slicing (incl. rotation safety), #007 log-path resolution
(tier 16/32/64, `OPENCODE_LLAMA_LOG` verbatim override) + the fail-loud
`log_unreadable` path, the #008 token-keyed join (ws020-derived leading-title-block
fixture, missing-block no-shift, tolerance edges, exact-beats-loose, ordinal
fallback for token-less legacy records), proxy normalizer, sidecar keying, and the
render-or-omit contract. Run in the node:22 unit-test container:

```
docker run --rm -v "$PWD:/test" -w /test node:22-bookworm-slim \
  node --test __tests__/lib/opencode-server-timings.test.js
```
