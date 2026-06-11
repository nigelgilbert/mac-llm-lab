# Runtime disk hygiene: prune normalized per-run DB captures, rotate the resident log

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 xhigh review (2026-06-10), cut findings CL2 and the efficiency angle's
log-rotation note — verified during the review of
<https://github.com/nigelgilbert/mac-llm-lab/pull/6> (not posted; details
below are the canonical statement).

## What to build

1. **Per-run DB captures never pruned.** Every transcript-capturing
   runOpenCode call bind-mounts a fresh per-run `opencode-data/` (SQLite DB
   + logs + git snapshot trees, ~1.1 MB/run) under gitignored
   `client/opencode/.opencode-runtime/<runId>/`, kept even after
   `buildOpenCodeArtifacts` normalizes it into `iterations.jsonl` +
   `run_summary.json`. Nothing prunes these dirs — measured during review:
   **1,310 run dirs / 962 MB** and growing with every sweep. Default policy
   (adjust if you want different retention): delete `opencode-data/` once
   normalization returns non-null, retain it on the degraded
   (`outcome_only`) path as the debugging oracle, and never touch
   `iterations.jsonl`/`run_summary.json` sidecars (the harvester's input).
   Include a one-shot prune for the existing ~1GB backlog (normalized runs
   only).

2. **Resident log rotation.** The tier-64 launchd plist appends
   stdout/stderr to `/tmp/opencode-llama-server.log` forever (KeepAlive
   daemon, `--metrics`, several lines per request) — unlike the direct-boot
   path, which truncates per start. The log-cursor join (old-suite #022;
   this suite's #007/#008 own it now) only needs the
   file stable within a run. Add a size-capped rotation (newsyslog.d entry
   or a between-sweeps truncate guarded on no run in flight), and note the
   interaction in OPENCODE-SERVER-TIMINGS.md.

## Acceptance criteria

- [ ] After a smoke sweep, run dirs with non-degraded telemetry contain sidecars but no `opencode-data/`; a forced-degrade run (e.g. doctored DB path) retains its `opencode-data/`
- [ ] The one-shot backlog prune reports count + bytes freed and leaves all sidecars intact (`ls client/opencode/.opencode-runtime | wc -l` unchanged; `du -sh` drops by ~an order of magnitude)
- [ ] Rotation in place for `/tmp/opencode-llama-server.log` with a stated size cap, and a live `OPENCODE_SERVER_TIMINGS=1` run still joins cleanly (no mid-run truncation)
- [ ] Policy (what is kept, what is pruned, when) documented in OPENCODE-WORKSPACE-CONTRACT.md or the timings doc

## Blocked by

None - can start immediately
