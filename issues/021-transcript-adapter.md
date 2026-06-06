# OpenCode transcript adapter

**Type**: AFK

**Status:** ✅ Done — adapter + #022 wiring shipped; validated field-by-field against
the #020 evidence DB and end-to-end on a fresh live `opencode run` (DB survived `--rm`
via the bind mount; the 2.5 MB WAL applied correctly). Feature sha: _(pointed by the
follow-up commit)_.

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4

## What to build

Normalize OpenCode's session log (format from #020) into the existing iteration
schema so iteration/token counts become cross-config comparable. Include a tool-name →
workspace-mutation map for OpenCode's tool set (the analog of claw's
`WORKSPACE_CHANGED_BY_TOOL`). Post-v1: the outcome-only pipeline already produces
pass-rate/wall-clock without this; the adapter adds the secondary parity metrics.

Also own the **#022 server-timings wiring** (deferred from #010 by design): the ordinal
join needs the iteration records this adapter produces, so this ticket brackets the
`opencode run` in `runOpenCode` with the #022 log cursor (`open`/`closeServerLogCursor`)
and joins the captured timings into the emitted records (`joinServerTimings` →
`writeServerTimingsSidecar`). Gated behind `OPENCODE_SERVER_TIMINGS=1`; a no-op when off.

## Acceptance criteria

- [x] Adapter reads an OpenCode session log and emits records in the existing iteration schema
      — `normalizeOpenCodeSession` maps one assistant `message` → one schema-v1 iteration
      record (`lib/opencode_transcript.js`), sourced from the **SQLite DB** (not the lossy
      `--format json` stream, #020 finding 2), read **with the `-wal`/`-shm` present** so the
      write-ahead log applies (the live run's session lived in a 2.5 MB WAL over a 4 KB main file).
- [x] Iteration count and token counts (if reported) are populated per run — input/output/
      cache/reasoning tokens per iteration; session-row rollups in `run_summary.json`.
- [x] A tool→workspace-mutation map covers OpenCode's tool set (mirrors `WORKSPACE_CHANGED_BY_TOOL`)
      — `OPENCODE_WORKSPACE_CHANGED_BY_TOOL` (the 12-tool §5 set).
- [x] Unmapped/unknown tools degrade gracefully (recorded, not crashing) and are flagged —
      `tool_unmapped` per call + `unmapped_tool_call_count` + a run-summary caveat; `workspace_changed=null`.
- [x] When `OPENCODE_SERVER_TIMINGS=1` (#022), `runOpenCode` brackets the run with the log cursor
      and server timings are joined into the emitted records + written to `server.timings.jsonl`
      (no-op when the flag is off) — proven on the live run (decode split joined inline + sidecar).

## Delivered

- [lib/opencode_transcript.js](../host/test/lib/opencode_transcript.js) — SQLite reader
  (`node:sqlite`, `sqlite3`-CLI fallback), pure `normalizeOpenCodeSession`, the §5 tool map,
  and `buildOpenCodeArtifacts` (read → normalize → #022 join → write sidecars). Degrades to
  `null` (caller falls back to the outcome-only sidecar) on an absent/partial DB — the claw
  `terminal_status:'timeout'` analog, never a hang (#020 §6).
- [lib/opencode.js](../host/test/lib/opencode.js) — `runOpenCode` now **bind-mounts** the
  container's OpenCode data dir (`/root/.local/share/opencode`) to a per-run host dir so the DB
  **survives `docker compose run --rm`** (which would otherwise destroy it, #020 §1.1); on close
  it normalizes that DB and (gated) brackets the run with the #022 server-log cursor + join.
  `OPENCODE_TRANSCRIPT_DISABLED=1` opts back out to outcome-only.
- [__tests__/lib/opencode-transcript.test.js](../host/test/__tests__/lib/opencode-transcript.test.js)
  — 30 unit tests over real-shaped fixtures (tool map, direct maps, §4.2 gaps, error/unmapped/
  repeat/empty/timeout degrade, #022 join sidecar) + a **gated integration test** reading the real
  #020 evidence DB and asserting the known token bytes field-by-field. Plus the `dataMount` argv
  test in `opencode.contract.test.js`. Whole `__tests__/lib` suite green in node:24 (132 tests).

## Follow-up observed (not a blocker)

On the live 4-iteration run the #022 log cursor captured **5** server timing blocks for **4**
iterations → `join_status='count_mismatch'` (flagged, not silently mispaired; the join pairs the
first 4 ordinally and nulls the tail). OpenCode appears to issue one extra server request per run
(likely session-title generation). The ordinal-pairing assumption (k-th request → k-th iteration)
should be revisited under this off-by-one — either filter the title-gen request or pair by a more
robust key. Tracked against **#022/#016**; #021's wiring handles the mismatch gracefully.

## Blocked by

- #020 (met)
- #022 (met — server-timings library; this ticket wires it into `runOpenCode`)
