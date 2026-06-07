# OpenCode session-log inspection + format doc

**Type**: HITL

**Status:** ✅ Done (2026-06-06) — format documented from a real multi-step run in
[client/opencode/docs/SESSION-LOG-FORMAT.md](../client/opencode/docs/SESSION-LOG-FORMAT.md).
Ran AFK (no escalation needed mid-run). **Two findings reshape #021:** (1) the on-disk
store is **SQLite** (`~/.local/share/opencode/opencode.db` + WAL), not flat JSON;
(2) the `--format json` stdout stream is **lossy** (no `text` events, truncates the final
`step_finish`) — #021 must read the DB, not the stream. Token usage is per-iteration (no
gap); the only telemetry gap is the server prompt/decode split (#022, same as claw).

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4, §5

## What to build

Inspect and document where OpenCode writes its session log and what JSON shape it
uses, from real runs (#009). This is the prerequisite that unblocks the transcript
adapter (#021): we need the on-disk location, per-iteration structure, token-usage
fields, and tool-call records before normalizing into the existing iteration schema.

HITL because it's an empirical investigation of an undocumented (to us) format.

## Acceptance criteria

- [x] Session-log location (dir + file naming) documented — SQLite DB at
  `~/.local/share/opencode/opencode.db` (+ `-wal`/`-shm`); one global DB, sessions are
  rows (`ses_…`), **not** per-session JSON files. ([§1](../client/opencode/docs/SESSION-LOG-FORMAT.md#1-session-log-location))
- [x] Per-iteration JSON shape documented: message/turn boundaries, token usage, tool-call
  records — `message`/`part` tables; turn = one assistant message; `finish` = stop reason;
  per-iteration `tokens{input,output,reasoning,cache{read,write}}`; tool records carry
  name/args(object)/output/metadata + per-call timestamps. ([§2](../client/opencode/docs/SESSION-LOG-FORMAT.md#2-per-iteration-json-shape-from-the-db), [§3](../client/opencode/docs/SESSION-LOG-FORMAT.md#3---format-json-event-stream-lossy))
- [x] Mapping notes OpenCode fields → existing iteration schema (gaps called out) — direct
  maps + 6 honest gaps (server prompt/decode split, bridge fields, reasoning tokens,
  cost=0, tool-error shape unconfirmed, lossy stream → read DB). ([§4](../client/opencode/docs/SESSION-LOG-FORMAT.md#4-mapping-notes--opencode--existing-iteration-schema))
- [x] OpenCode's tool set enumerated for the tool→workspace-mutation map (#021) — 12 tools
  (write/edit/bash/read/glob/grep/webfetch/todowrite/task/skill/question/invalid) +
  proposed `OPENCODE_WORKSPACE_CHANGED_BY_TOOL`. ([§5](../client/opencode/docs/SESSION-LOG-FORMAT.md#5-opencode-tool-set--workspace-mutation-map))

## Blocked by

- #009
