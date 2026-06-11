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
artifact, and since #002 landed the driver slices **every** fresh runDir
post-arm (not just freeze-signature ones), so the #002 overflow scan has an
artifact for every flag-on run. The timings repair itself is best-effort per
runDir — a failed repair leaves the honest `no_server_timings` artifacts in
place and never reddens the sweep (a failed #002 overflow *patch* does — see
the context-overflow section below).

### #002 context-overflow detection (rides this plumbing)

**Decision (issue #002, Option A, lab owner 2026-06-10):** a mid-run
llama-server context overflow is a serving artifact, not a model capability
failure — the run is re-typed `terminal_status: 'harness_error'` /
`passed: null` and `paired_bootstrap.isEligible` drops it from pass-rate
denominators (Layer-A discipline). The oracle is the server's own log line,
pinned **empirically against the lab's pinned build `b1-5594d13`**
(2026-06-10 throwaway probe: Qwen3-8B-Q4_K_M, `-c 256`, port 18123,
over-context `/v1/chat/completions` → HTTP 400 `exceed_context_size_error`):

```
srv    send_error: task id = 0, error: request (728 tokens) exceeds the available context size (256 tokens), try increasing it
```

Pinned as `CONTEXT_OVERFLOW_RE` in
[lib/opencode_server_timings.js](../lib/opencode_server_timings.js) (captures
task id / request tokens / n_ctx) with the byte-exact capture as fixture
(`__tests__/scripts/fixtures/overflow-server-log.slice`). On this build the
pre-decode rejection is the **only** overflow signal: a mid-decode ceiling
does *not* error — the server caps the prediction and returns
`finish_reason: 'length'`, HTTP 200, no log line (verified on the same
probe). Such truncated-but-completed runs are NOT re-typed.

**FLAG COUPLING (protocol — read this):** overflow detection rides
`OPENCODE_SERVER_TIMINGS=1` — the same cursor/slice plumbing (the #002
decision's soft dependency on #007). **Overflow re-typing only applies on
flag-on sweeps.** On a flag-off sweep there is no capture window and a
mid-run overflow lands as an eligible model failure (timeout/error), exactly
like the published oc verdicts. Run comparison sweeps flag-on.

Two detection layers, both feeding the same sidecar fields:

1. **In-run** (`captureServerTimings` → transcript): the run's slice text is
   scanned alongside the timing parse; a hit rides back on the captured
   records array as a marker (`{ signal: 'context_overflow', line, task_id,
   … }` — filtered out of the join population) and the transcript build
   re-types `run_summary.json` BEFORE the reporter emits the row:
   `terminal_status: 'harness_error'`, `passed: null`,
   `context_overflow: true`, `harness_error: 'context_overflow'`,
   `context_overflow_detected_via: 'in_run_capture'`,
   `context_overflow_line`, plus a `context_overflow_relabel: …` caveat.
2. **Post-arm, PRE-GATE patch** (`run-config-ab.sh` →
   [scripts/patch-context-overflow.mjs](../scripts/patch-context-overflow.mjs)):
   the in-run layer is blind when the virtiofs freeze emptied the in-place
   slice OR the run wedged hard enough to leave only an outcome-only sidecar
   (no transcript build). Post-arm the driver slices every fresh runDir from
   the HOST log and scans each slice; a hit patches `run_summary.json` (same
   fields, `context_overflow_detected_via: 'host_slice_post_arm'`) **and the
   already-emitted registry row** — `terminal_status → 'harness_error'`,
   `passed → null`, `harness_error → 'context_overflow'`, within schema
   fields only (`run_registry.schema.json` is `additionalProperties: false`,
   so the patch provenance lives on the sidecar, reachable from the row via
   `trace_artifact_uri`/`run_id`). The patch is idempotent, logged loud
   naming the run, and runs strictly BEFORE the row audit and pairing gate
   read the registry. A patch that *fails* (not "no overflow") exits the
   sweep with code 2 — the relabel is promised on flag-on sweeps and must
   not silently not-happen.

**Attribution rule:** a rejected request produces no timing block, so the
overflow line's task id has no within-run anchor — attribution is
window-based: **an overflow line inside a run's capture window belongs to
that run** (single-client topology; the only other in-window traffic is the
run's own title/summarize requests). The host-slice window pads one tick
(~3 s) on each side, so an adjacent run's overflow line can in principle
land in the pad; the misattribution risk is conservative — it can only move
a FAILED neighbor into the excluded bucket (the recovered-run carve-out
keeps clean-finishing runs labeled `done`), never flip pass/fail.

**Recovered-run carve-out:** an overflow line in the window of a run that
still exited 0 means the client recovered (compaction/retry) — the sidecar
records `context_overflow: true` plus a `context_overflow_recovered: …`
caveat but the run keeps `done` and the workspace oracle decides pass/fail.

**Semantics change vs published verdicts:** see the dated notes in
[OPENCODE-AB-TIER16-VERDICT.md](OPENCODE-AB-TIER16-VERDICT.md) and
[OPENCODE-HARNESS-AB-PLAN.md](OPENCODE-HARNESS-AB-PLAN.md) — the published oc
verdicts counted overflows as eligible failures ("0 oc `harness_error`").

### Log path resolution (#007)

`defaultServerLogPath(tier, env = process.env)`:

1. **`OPENCODE_LLAMA_LOG`** — when set and non-empty it is used **verbatim**, for
   every tier. Same variable the bash launcher honors, and the contract with
   `run-config-ab.sh`: when `OPENCODE_SERVER_TIMINGS=1`, the driver bind-mounts the
   host per-tier log read-only at `/var/log/opencode-llama-server.log` inside the
   eval-runner and sets `OPENCODE_LLAMA_LOG` to that path (host `/tmp` is never
   mounted in the canonical topology).
2. Otherwise the per-tier host path from **THE tier table** (#016):
   `lib/config.js tierTable()` parses `host/llama-server/tiers.conf`
   (`${OPENCODE_LOG_BASE}${LOG_TAG}.log`; currently `64` (default) →
   `/tmp/opencode-llama-server.log`, `32` → `…-32.log`, `16` → `…-16.log`)
   when the conf is readable — host node and path-matched runner mounts —
   else the embedded `FALLBACK_TIER_TABLE` snapshot. The snapshot cannot
   silently drift: the tier-table contract test
   (`__tests__/lib/tier-table.contract.test.js`) fails on any divergence
   wherever the conf is visible, and
   `host/llama-server/scripts/check-tier-table.sh` cross-checks every
   consumer (bash + JS) on the host. An unknown/absent tier resolves to the
   table's default-tier row (historical behavior preserved).

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

## Resident log rotation (#015) — never mid-sweep

The tier-64 launchd plist appends to `/tmp/opencode-llama-server.log` forever.
Rotation exists (`host/llama-server/scripts/rotate-opencode-server-log.sh`,
50 MB cap, copytruncate-style: last 8 MB → `<log>.1`, then `: >` the live
file — safe under launchd's O_APPEND fd, verified live), but it interacts
with everything above: the log cursor brackets runs by **byte offsets**, the
host ticker index maps wall-clock → **byte offsets**, and `server-log.slice`
is extracted from those offsets. A truncation mid-sweep silently corrupts all
three. Therefore:

- **No newsyslog entry, no timer** that can fire mid-sweep, and no LaunchAgent
  ships for it (a `StartInterval` agent can still TOCTOU-race a sweep that
  starts between guard check and truncate).
- The script **refuses (exit 2)** when: sweep containers exist
  (`docker ps --filter label=mac-llm-lab.sweep`, docker-unreachable also
  refuses), any `.claw-runtime/server-log-index.*.txt` has mtime within 30 min
  (covers between-cells gaps and a just-finished sweep's repair pass), or the
  resident lock `/tmp/oc-resident.lock.d` cannot be acquired
  (`OC_ROTATE_HOLDING_LOCK=1` when the invoker already holds it).
- **Invocation seats:** (a) manual, between sweeps (`--dry-run` to check);
  (b) **the driver preflight (#016, SHIPPED)** — `run-config-ab.sh` invokes
  the rotate script at sweep start, strictly before it starts any
  sweep-labeled container, creates its ticker index, or opens any cursor
  (i.e. before this sweep can trip G1/G2 itself). Guard refusal (exit 2 —
  e.g. another sweep's containers, a <30-min-old index, or the resident
  lock held without `OC_ROTATE_HOLDING_LOCK=1`) is tolerated as a skip;
  any other rotation error is fatal to the sweep. Operators who run sweeps
  while holding `/tmp/oc-resident.lock.d` export `OC_ROTATE_HOLDING_LOCK=1`
  to let the preflight's G3 pass.
- Within-run consistency is unaffected: the cursor only needs the file stable
  **within** a run, and any cursor opened after a rotation sees consistent
  (smaller) offsets. `readLogSlice` already tolerates a start-past-EOF as an
  empty slice.

Retention policy for the per-run artifacts themselves (sidecars kept forever,
`opencode-data/` pruned after successful normalization) lives in
[OPENCODE-WORKSPACE-CONTRACT.md](OPENCODE-WORKSPACE-CONTRACT.md) §"Runtime
disk hygiene".

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
