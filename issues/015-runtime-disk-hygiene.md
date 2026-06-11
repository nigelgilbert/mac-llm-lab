# Runtime disk hygiene: prune normalized per-run DB captures, rotate the resident log

**Type**: AFK

**Status:** ✅ Complete (2026-06-10, T3)

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

- [x] After a smoke sweep, run dirs with non-degraded telemetry contain sidecars but no `opencode-data/`; a forced-degrade run (e.g. doctored DB path) retains its `opencode-data/`
- [x] The one-shot backlog prune reports count + bytes freed and leaves all sidecars intact (`ls client/opencode/.opencode-runtime | wc -l` unchanged; `du -sh` drops by ~an order of magnitude)
- [x] Rotation in place for `/tmp/opencode-llama-server.log` with a stated size cap, and a live `OPENCODE_SERVER_TIMINGS=1` run still joins cleanly (no mid-run truncation)
- [x] Policy (what is kept, what is pruned, when) documented in OPENCODE-WORKSPACE-CONTRACT.md or the timings doc

## Blocked by

None - can start immediately

## Result (2026-06-10)

**Files:** `host/test/lib/opencode.js` (end-of-run prune hook +
`pruneOpenCodeDataDir`, basename-guarded, never-throws; `OPENCODE_KEEP_DATA=1`
escape hatch) · `host/test/scripts/prune-opencode-data.mjs` (backlog prune,
dry-run default, `--apply`/`--json`; exports `classifyRunDir`/
`shouldPruneRunDir`) · `host/test/__tests__/scripts/prune-opencode-data.test.js`
(16 tests) · `host/llama-server/scripts/rotate-opencode-server-log.sh`
(guarded copytruncate rotation, 50 MB cap) · policy sections in
`docs/OPENCODE-WORKSPACE-CONTRACT.md` + `docs/OPENCODE-SERVER-TIMINGS.md`.

**Prune policy as implemented:** prune `<runDir>/opencode-data/` iff
`run_summary.json` parses with `telemetry === 'transcript'` AND
`iterations.jsonl` exists AND `opencode-data/` is a directory; retain on
`outcome_only`/unknown telemetry, missing/unparseable summary, missing
iterations. Runner prunes at run end only when `buildOpenCodeArtifacts`
returned non-null (same condition). Only the `opencode-data` subtree is ever
deleted (basename guard); sidecars/slices untouchable by construction.

**AC1 (PASS, smoke-style runs under the resident lock — NOT a full sweep;
stated per the briefing's either/or):** live one-shot against :11436 →
`code=0`, `telemetry=transcript`, `iterations.jsonl` non-empty, workspace
mutation landed, **`opencode-data/` absent** (pruned by the hook). Forced
degrade = dead-port compose override + caller `AbortController` at 10 s (the
cheapest deterministic degrade in the lib: `interrupted` skips normalization
entirely) → `terminal_status=interrupted`, `telemetry=outcome_only`,
**`opencode-data/` retained**.

**AC2 (PASS):** dry-run then `--apply` via the eval-runner image
(path-matched repo mount): 1,325 dirs scanned, **1,316 pruned / 779.9 MiB
freed**, 1 retained (no `run_summary.json` — `ffb32d6d…`, a never-settled
run), 8 no-data entries. Before→after: runDir count **1326 → 1326**;
`du -sh` **971M → 34M** (~29×; `du` overshoots apparent size because the git
snapshot trees are thousands of small files). Sidecar counts identical
before/after: run_summary 1321, iterations 1321, assertion_result 1317,
server.timings.jsonl 9, server-log.slice 1; find assertion: 0 transcript
runDirs still holding `opencode-data/`; spot-checked sidecars parse.

**AC3 (PASS):** `rotate-opencode-server-log.sh` — cap 50 MB
(`OC_ROTATE_CAP_BYTES`), tail 8 MB → `<log>.1`. Guards (all demoed, exit 2):
G1 sweep containers via `docker ps --filter label=mac-llm-lab.sweep`
(docker-unreachable also refuses); G2 fresh
`.claw-runtime/server-log-index.*.txt` (mtime < 30 min — refusal demoed
against the real 23:25 index); G3 mkdir-mutex on `/tmp/oc-resident.lock.d`
(`OC_ROTATE_HOLDING_LOCK=1` opt-out, refusal demoed). O_APPEND copytruncate
verified on a scratch file with a live appender (line 445 → `.1`, line 446 →
offset 0, zero loss/NULs), then ONE live rotation under the resident lock
with lowered cap (`OC_ROTATE_CAP_BYTES=100000`): 664,664 B → 0 B, tail
65,536 B saved; post-rotation completion request appended 3,651 B of real
text from offset 0 incl. a fresh `prompt eval/eval/total time` block; health
200 throughout, server never restarted. **No LaunchAgent shipped**: a
StartInterval timer can TOCTOU-race a sweep starting between guard check and
truncate (the driver holds no lock); supported invocations are manual
between-sweeps and a future driver-preflight rotation (→ #016).

**AC4 (PASS):** policy in OPENCODE-WORKSPACE-CONTRACT.md ("Runtime disk
hygiene (#015)") + rotation interaction in OPENCODE-SERVER-TIMINGS.md
("Resident log rotation (#015) — never mid-sweep"). Suite:
**250 tests / 249 pass / 1 skip / 0 fail** (baseline 234/233/1/0 + 16 new).

**Residual risks:** (1) rotation TOCTOU vs a sweep launched in the guard→
truncate window — mitigated by manual-only invocation, eliminated only by a
driver-preflight rotation (#016); (2) `smoke/` scratch trees keep their own
nested captures (out of scope, ~2 MB, freshDir'd each smoke run); (3) one
no-summary runDir retained by design.
