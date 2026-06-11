# OpenCode session-log format — on-disk store + `--format json` stream (Config B)

**Issue [#020](../../../issues/020-opencode-session-log-inspection.md) · 2026-06-06 ·
OpenCode `1.16.2` · container [`opencode:local`](../docker-compose.yml) →
host llama-server `:11436` (tier-64, [#005](../../../issues/005-second-llama-server-config.md))**

> Prerequisite for the transcript adapter ([#021](../../../issues/021-transcript-adapter.md)).
> Documents **where** OpenCode persists a session and **what JSON shape** it uses, so #021
> can normalize OpenCode telemetry into the existing per-iteration schema
> ([`lib/claw.js`](../../../host/test/lib/claw.js) `iterations.jsonl` writer, schema v1).
>
> **Drawn from a real multi-step run, not from memory.** Raw evidence (DB + event
> stream + logs) is under
> [`client/opencode/.opencode-runtime/ws020-evidence/`](../.opencode-runtime/ws020-evidence/)
> (gitignored). Reproduce block at the end.

## TL;DR — the two findings that change #021

1. **The on-disk store is SQLite, not flat JSON.** OpenCode 1.16.2 writes the whole
   session — messages, parts, tool calls, token rollups — into a single SQLite database
   at `~/.local/share/opencode/opencode.db` (+ `-wal`, `-shm`). Older OpenCode builds
   used per-session `storage/**.json` files; **that is gone in 1.16.2**. #021 must read
   SQLite, not glob JSON files.

2. **The `--format json` stdout stream is LOSSY; the DB is authoritative.** In a clean
   4-iteration run the stream emitted only `step_start` / `tool_use` / `step_finish`
   events — **no assistant `text` events**, and it **truncated before the final
   `step_finish`**, so the last iteration's token totals never reach the stream. The
   SQLite DB held the complete, correct record (all 5 messages, all 13 parts, all token
   counts). **#021 should source from the DB, treating the event stream as at most a
   convenience tap.** This is the ticket's escalation trigger ("the on-disk format defies
   the `--format json` event stream") — it does, in #021's favour: the DB is richer.

Everything else normalizes cleanly. Token usage **is** reported per-iteration (no gap),
and tool calls even carry per-call timestamps (which claw's outcome-only path lacks).
The one real telemetry gap is the **server prompt/decode split**, which — exactly as on
the claw side — is not in the agent's log at all and must come from the llama-server
([#022](../../../issues/022-server-decode-timings-proxy.md)).

---

## 1. Session-log location

### 1.1 On disk (authoritative)

| | |
|---|---|
| **Store** | SQLite database (WAL mode) |
| **Path** | `/root/.local/share/opencode/opencode.db` (+ `opencode.db-wal`, `opencode.db-shm`) |
| **Resolution** | `$XDG_DATA_HOME/opencode` → `XDG_DATA_HOME` is **unset** in the container, so it falls back to `~/.local/share/opencode`; container runs as root → `/root/...` |
| **Scope** | **One global DB for all sessions.** Sessions are *rows*, not files — keyed by `session.id` (`ses_…`) under a `project` (`global` here). There is **no** per-session / per-workspace file or directory. |
| **Sibling dirs** | `~/.local/share/opencode/log/<ISO>.log` (one text log per run — INFO/ERROR lines), `~/.local/share/opencode/repos/` (empty here) |

> **WAL caveat (load-bearing for #021):** in this run `opencode.db` was 4 KB while
> `opencode.db-wal` was **2.5 MB** — i.e. the session lived almost entirely in the
> write-ahead log, not yet checkpointed into the main file. **#021 must read the DB with
> the `-wal`/`-shm` files present** (any standard SQLite reader applies the WAL
> transparently), or force a `PRAGMA wal_checkpoint` first. Reading `opencode.db` alone,
> copied without its WAL, loses the session. Read **after** the run terminates — a
> mid-run DB is being written concurrently.

> **`run --rm` ephemerality (load-bearing for #021):** the #010/#021 driver runs each
> agent in a throwaway `docker compose run --rm` container, so its `opencode.db` is
> **destroyed with the container**. #021 must extract the session **before** the
> container is removed — either bind-mount `~/.local/share/opencode` out, set
> `XDG_DATA_HOME` to a mounted dir, or `docker cp` the DB out in the runner's post-step.
> The persistent-`exec` path used for this inspection keeps the DB, but that is not how
> the sweep runs.

### 1.2 Event stream (convenience, lossy)

`opencode run --format json [--print-logs]` writes **newline-delimited JSON events** to
**stdout** (one event per line); `--print-logs` sends the human log to **stderr**. See
[§3](#3---format-json-event-stream-lossy). Capture by redirecting stdout to a file —
never echo-pipe (newline mangling).

---

## 2. Per-iteration JSON shape (from the DB)

Three tables carry the transcript: `session` (run-level rollup), `message` (one row per
turn), `part` (ordered pieces within a turn). Full DDL: `.schema` on the evidence DB.

### 2.1 Turn / iteration boundary

**One assistant `message` row = one model iteration.** The run that drove this doc
produced **5 messages**: 1 `user` + **4 `assistant`**. The 4 assistant messages are the
4 iterations:

| iter | message finish | parts | what happened |
|---|---|---|---|
| 1 | `tool-calls` | step-start, **tool:read**, step-finish | read `calc.py` |
| 2 | `tool-calls` | step-start, **tool:edit**, step-finish | fix `a - b` → `a + b` |
| 3 | `tool-calls` | step-start, **tool:bash**, step-finish | `python3 calc.py` → `5` |
| 4 | `stop` | step-start, **text**, step-finish | final prose answer |

Within an assistant message, parts run `step-start … (tool|text)… step-finish`.
`message.data.finish` is the **stop reason** (`"tool-calls"` mid-loop, `"stop"` at the
end) — the iteration/turn boundary marker.

### 2.2 `message.data` (per-iteration record)

Assistant message `data` JSON (the `id` lives in the **column**, not the blob):

```json
{
  "parentID": "msg_e9e66d9c2001XxNAUQazlBzQdT",
  "role": "assistant",
  "mode": "build", "agent": "build",
  "path": { "cwd": "/workspace", "root": "/" },
  "cost": 0,
  "tokens": {
    "total": 7815, "input": 561, "output": 28, "reasoning": 0,
    "cache": { "write": 0, "read": 7226 }
  },
  "modelID": "opencode", "providerID": "llama-local",
  "time": { "created": 1780774001235, "completed": 1780774003707 },
  "finish": "tool-calls"
}
```

The `user` message `data` is minimal: `{ role, time:{created}, agent, model:{providerID,modelID}, summary:{diffs:[]} }`.

### 2.3 `part.data` — the four part types

**`step-start`** — `{ "type": "step-start" }` (marker only).

**`step-finish`** — duplicates the iteration's token usage + stop reason:
```json
{ "type": "step-finish", "reason": "tool-calls",
  "tokens": { "total": 7815, "input": 561, "output": 28, "reasoning": 0,
              "cache": { "write": 0, "read": 7226 } },
  "cost": 0 }
```
(The `step-finish.tokens` equals `message.data.tokens` for that turn — use either.)

**`text`** — assistant prose (or the echoed user prompt): `{ "type": "text", "text": "…" }`.

**`tool`** — the tool-call record (name + args + result + metadata + timestamps):
```json
{ "type": "tool", "tool": "read",
  "callID": "g5oDGjz02UeyLZwSOUioRb1slGvcheOX",
  "state": {
    "status": "completed",
    "input":  { "filePath": "/workspace/calc.py" },
    "output": "<path>/workspace/calc.py</path>\n<type>file</type>\n<content>…</content>",
    "metadata": { … tool-specific … },
    "title": "workspace/calc.py",
    "time": { "start": 1780774003668, "end": 1780774003691 }
  } }
```

Tool-specific `state.input` / `state.metadata` observed:

| tool | `state.input` keys | `state.metadata` highlights |
|---|---|---|
| `read` | `filePath` | `preview`, `display{path,lineStart,lineEnd,totalLines,truncated}`, `truncated` |
| `edit` | `filePath`, `oldString`, `newString` | `diff` (unified), `filediff{file,patch,additions,deletions}`, `diagnostics`, `truncated` |
| `bash` | `command`, `description` | **`exit`** (process exit code), `output`, `description`, `truncated` |

Key points: **args are stored as a real JSON object** in `state.input` (no
string-vs-object ambiguity — sidesteps llama.cpp #20198 at the storage layer). Tool
**timestamps** (`state.time.start/end`) are present → per-call latency is recoverable.
`state.status` is `"completed"` for success (error shape unconfirmed — see
[§4 gaps](#4-mapping-notes--opencode--existing-iteration-schema)).

### 2.4 Run-level rollup (`session` row)

```
id, slug, title, agent, model (JSON-encoded: {"id","providerID","variant"}),
cost,
tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
summary_additions, summary_deletions, summary_files, summary_diffs,
directory, version, time_created, time_updated, …
```

This run: `tokens_input=777, tokens_output=161, tokens_reasoning=0,
tokens_cache_read=31012, tokens_cache_write=0, cost=0`. These are session totals (sum
across iterations), suitable for `run_summary.json` totals.

---

## 3. `--format json` event stream (lossy)

Each stdout line: `{ "type", "timestamp", "sessionID", "part": { … } }` where `part`
mirrors the DB `part` blob plus `id`/`messageID`/`sessionID`.

Observed event `type`s: `step_start`, `tool_use`, `step_finish` (note: stream uses
`_`-separated names; the DB `part.type` uses `-`-separated `step-start` etc.). A
`tool_use` event's `part` is the full tool record from [§2.3](#23-partdata--the-four-part-types).

**Why it is lossy (sample of 10 events for a 4-iteration run):**
- It emitted `step_start/tool_use/step_finish ×3` for iterations 1–3, then a lone
  `step_start` for iteration 4 and **stopped** — no `text` event for the final answer,
  **no `step_finish`** for iteration 4. So the final iteration's token totals are
  **absent from the stream**.
- **No `text` events at all** — assistant prose is not on the stream (it is in the DB
  `text` parts).

⇒ Treat the stream as an at-most-real-time tap. **The DB is the source of truth for
#021.**

---

## 4. Mapping notes — OpenCode → existing iteration schema

Target: [`lib/claw.js`](../../../host/test/lib/claw.js) `iterations.jsonl` (schema v1)
per-iteration record + `run_summary.json`. **One assistant `message` → one iteration
record.**

### 4.1 Direct maps (clean)

| iteration-schema field | OpenCode source | notes |
|---|---|---|
| `iter`, `assistant_message_index` | ordinal of assistant message | filter `role=='assistant'`, order by `time_created` |
| `input_tokens` | `message.data.tokens.input` | per-iteration ✓ |
| `output_tokens` | `message.data.tokens.output` | per-iteration ✓ |
| `cache_read_input_tokens` | `tokens.cache.read` | ✓ |
| `cache_creation_input_tokens` | `tokens.cache.write` | ✓ |
| `stop_reason` | `message.data.finish` | `"tool-calls"` / `"stop"` |
| `tool_calls[].id` | `part.tool.callID` | |
| `tool_calls[].name` | `part.tool.tool` | |
| `tool_calls[].arg_summary` | `part.state.input` | already an object → `makeArgSummary` works directly |
| `tool_calls[].arg_hash` | hash of `state.input` | |
| `tool_calls[].result_hash` | hash of `state.output` | |
| `tool_calls[].workspace_changed` | tool→mutation map ([§5](#5-opencode-tool-set--workspace-mutation-map)) | analog of `WORKSPACE_CHANGED_BY_TOOL` |
| `tool_calls[].started_ms / finished_ms / elapsed_ms` | `state.time.start` / `.end` / diff | **better than claw outcome-only** (which is null) |
| run_summary `total_*_tokens`, `iter_count`, `tool_call_count` | `session` row + counts | |
| run_summary `model_id` | `session.model` (JSON) → `providerID/id` | |

### 4.2 Gaps — call out honestly; #021 must degrade gracefully

1. **Server prompt/decode split is NOT in OpenCode's log.** No `timings.prompt_ms` /
   `timings.predicted_ms` anywhere in the DB or stream — same situation as claw (those
   live in the llama-server, recovered via the bridge/proxy). So
   `server_prompt_eval_ms`, `server_decode_ms`, `server_total_ms`, `server_queue_ms`
   → **`null`** from the session log alone. This matches plan §4.4 ("recoverable via the
   server's own logs or a thin logging proxy", [#022](../../../issues/022-server-decode-timings-proxy.md)).
   claw already degrades via `timing_caveats` — reuse that path.

2. **No LiteLLM bridge fields.** `bridge_request_seq`, `request_started_ms`,
   `request_finished_ms`, `non_model_gap_ms`, and the whole `join_status` machinery are
   claw/bridge-specific (OpenCode bypasses LiteLLM). For OpenCode, use
   `message.data.time.created/completed` as the per-iteration wallclock window
   (`completed - created` ≈ turn duration, including any tool exec inside the turn);
   compute `non_model_gap` as the gap between consecutive messages' timestamps, or set
   `join_status='n/a_opencode'`. **Do not invent bridge fields** — leave them null.

3. **`reasoning` tokens has no claw slot.** `message.data.tokens.reasoning` exists
   (`tokens_reasoning` at session level). It is `0` here (thinking is OFF for Config B),
   so harmless, but #021 should either add a `reasoning_tokens` field or fold it. Don't
   silently drop it without a note.

4. **`cost` is always `0`** (local model, no pricing) — expected; ignore.

5. **Tool-error shape unconfirmed.** No tool failed in the sample, so the error payload
   for `result_is_error` / `result_error_class` / `result_error_signature` is not
   directly observed. Confirmed signals to use: `part.state.status !== "completed"`
   (e.g. `"error"`), and for `bash`, `state.metadata.exit !== 0`. **Recommended degrade:**
   treat any non-`"completed"` status (or non-zero bash `exit`) as an error and classify
   off `state.output`. *(Low-risk follow-up: drive one tool-failure run to capture the
   exact error blob.)*

6. **The event stream is lossy** ([§3](#3---format-json-event-stream-lossy)) — **read
   the SQLite DB, not stdout.** This is the single biggest structural note for #021.

### 4.3 What is *easier* than claw

- Tool **timestamps** are present (per-call `state.time`) — claw's outcome-only runner
  left these null; OpenCode populates them for free.
- Tool **args are objects**, not strings — no JSON-string-vs-object normalization needed.
- Token usage is **per-iteration in two places** (message + step-finish part) that agree
  — a built-in consistency check.

---

## 5. OpenCode tool set → workspace-mutation map

**Authoritative registered build-agent tool set** (from the `service=tool.registry
status=started <name>` log lines of the working run, cross-checked against `name:"…"`
literals in the `opencode.exe` bun binary): **12 tools** —

`invalid`, `question`, `bash`, `read`, `glob`, `grep`, `edit`, `write`, `task`,
`todowrite`, `webfetch`, `skill`.

> Note: there is **no** separate `list`, `patch`, `multiedit`, or `todoread` tool in
> 1.16.2's default agent (binary substrings for "list"/"patch" are diff/dispatch noise).
> Directory listing happens via `bash`/`glob`. `question`, `plan_enter`, `plan_exit` are
> **denied by default** in the session permission set (seen in the log) — so `question`
> will not block a headless run.

Proposed `OPENCODE_WORKSPACE_CHANGED_BY_TOOL` (analog of claw's
[`WORKSPACE_CHANGED_BY_TOOL`](../../../host/test/lib/claw.js)):

| tool | workspace_changed | rationale |
|---|---|---|
| `write` | `true` | creates/overwrites a file (observed shape: `filePath`) |
| `edit` | `true` | edits a file (observed: `oldString`/`newString`, emits a diff) |
| `bash` | `null` | conditional — inspect `state.metadata.exit` + command; mirrors claw's `bash: null` |
| `read` | `false` | read-only (observed) |
| `glob` | `false` | path search |
| `grep` | `false` | content search |
| `webfetch` | `false` | network read |
| `todowrite` | `false` | mutates todo state, **not** the workspace tree |
| `skill` | `false` | injects instructions into context |
| `question` | `false` | interactive prompt (denied in headless) |
| `invalid` | `false` | error placeholder for an unrecognized tool call |
| `task` | `null` | spawns a sub-agent that may mutate via *its own* tools → unknown at this level |

As with claw, set `workspace_changed=false` for any tool whose call errored, and `null`
for unknown/未-mapped tools so the caller decides.

---

## 6. Operational hazard observed (flag for #009/#010/#021)

During this inspection the documented run (sample 1) completed cleanly in **~8 s**, but
**every subsequent `opencode run` in the session wedged at startup** — parked in
`epoll_pwait2` right after `service=format init`, having logged the models.dev
`ConnectionRefused` (the black-holed fetch from [#009](HEADLESS-ONESHOT.md)), never
reaching `provider init`. The wedge reproduced **even in fresh `docker compose run --rm`
containers and after a full container restart**, while `:11436` stayed healthy and
generating (<8 s curl probe) and claw `:11435` stayed green throughout.

Interpretation: this is the **same hang class as #009 Finding 1**, but observed
**intermittently *despite* the models.dev black-hole** — i.e. #009's "reliable after
black-hole (4/4 + 2/2)" result appears **load/time-sensitive**, not absolute (the lab
box was holding two large models in RAM plus repeated bun spawns). It does **not** affect
the format documented above (drawn from the clean sample 1), but it:

- **reinforces that #010's mandatory hard-timeout-kill is load-bearing**, not nice-to-have;
- suggests #009's reliability claim deserves a revisit under realistic sweep load;
- means **#021 must assume some runs leave a partial/absent DB** (a wedged run never
  writes a complete session) and degrade like claw's `terminal_status:'timeout'` path.

*(Stale SIGKILL'd runs against a shared persistent DB also wedged follow-on runs; the
`run --rm` sweep path sidesteps that by using a fresh DB per run, but the startup wedge
above occurred there too.)*

---

## 7. Reproduce

```sh
# host: oc-64 llama-server on :11436 (leave claw :11435 alone)
host/llama-server/scripts/opencode-server start    # if not already up

cd client/opencode
# claw-code holds host :8080, so use the port-clearing override for `up`
cat > /tmp/oc-portfix.yml <<'YML'
services: { opencode: { ports: !override ["18080:8080"] } }
YML

# seed a buggy file that forces read→edit→bash
mkdir -p ws020
printf 'def add(a, b):\n    return a - b\n\nif __name__ == "__main__":\n    print(add(2, 3))\n' > ws020/calc.py

WORKSPACE=./ws020 docker compose -f docker-compose.yml -f /tmp/oc-portfix.yml up -d

P="Read calc.py, fix add to return a + b (currently subtracts), then run python3 calc.py and report what it printed."
docker compose exec -T opencode sh -lc "cd /workspace && opencode run --format json '$P' >/tmp/ev.jsonl 2>/tmp/ev.err"

# on-disk store (authoritative) — copy out WITH the WAL, read with sqlite3
docker compose cp opencode:/root/.local/share/opencode/opencode.db     out.db
docker compose cp opencode:/root/.local/share/opencode/opencode.db-wal out.db-wal
docker compose cp opencode:/root/.local/share/opencode/opencode.db-shm out.db-shm
sqlite3 out.db ".tables"
sqlite3 out.db "SELECT data FROM message ORDER BY time_created;"
sqlite3 out.db "SELECT message_id, data FROM part ORDER BY time_created, id;"
sqlite3 out.db "SELECT tokens_input,tokens_output,tokens_cache_read FROM session;"

# event stream (lossy) — already in /tmp/ev.jsonl

docker compose down            # tear down when done
```

Evidence files captured for this doc (gitignored):
[`opencode.db`](../.opencode-runtime/ws020-evidence/opencode.db) (+ wal/shm),
[`run-json.jsonl`](../.opencode-runtime/ws020-evidence/run-json.jsonl) (event stream),
[`run-logs.txt`](../.opencode-runtime/ws020-evidence/run-logs.txt),
[`messages.raw.jsonl`](../.opencode-runtime/ws020-evidence/messages.raw.jsonl),
[`parts.raw.txt`](../.opencode-runtime/ws020-evidence/parts.raw.txt).
