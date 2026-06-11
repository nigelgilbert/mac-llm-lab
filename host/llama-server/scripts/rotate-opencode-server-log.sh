#!/bin/bash
# rotate-opencode-server-log.sh — guarded, between-sweeps size-cap rotation of
# the resident OpenCode llama-server log (#015).
#
# THE PROBLEM: the tier-64 launchd plist (launchd/com.mac-llm-lab.opencode-server.plist)
# appends stdout+stderr to /tmp/opencode-llama-server.log forever (KeepAlive
# daemon, --metrics, several lines per request) — unlike the direct-boot
# `opencode-server start` path, which truncates per start. Nothing ever caps it.
#
# THE CONSTRAINT (T2 carry-forward, issues/WORKLOG.md — NON-NEGOTIABLE):
# rotation MUST NOT fire mid-sweep. The #007/#008 server-timings capture
# brackets every run by BYTE OFFSETS into this log (lib/opencode_server_timings.js
# log cursor), and flag-on sweeps additionally keep a host-side size index
# (.claw-runtime/server-log-index.<sweep>.txt) that maps wall-clock -> byte
# offset for the virtiofs-freeze repair (scripts/repair-server-timings.mjs) and
# host-extracts <runDir>/server-log.slice from those offsets. Truncating the
# log mid-sweep silently corrupts ALL of these: open cursors, the index, and
# any not-yet-extracted slice windows. newsyslog (or any timer that can fire
# mid-sweep) is therefore explicitly OFF the table; this script only acts when
# it can establish that no sweep is active, and is expected to be invoked
# MANUALLY (or by the sweep driver as a pre-sweep preflight, BEFORE any cursor
# is opened — see issue #016 handoff).
#
# GUARDS (all must pass before any byte is touched; any failure -> exit 2):
#   G1  no sweep containers: `docker ps --filter label=mac-llm-lab.sweep`
#       must list nothing. Every container a sweep spawns (eval-runner + the
#       oc-run-* siblings) carries this label (#004). docker unreachable
#       counts as a REFUSAL — we cannot verify, so we do not act.
#   G2  no fresh sweep index: no .claw-runtime/server-log-index.*.txt with
#       mtime within OC_ROTATE_INDEX_FRESH_MIN (default 30) minutes. The
#       ticker appends ~every 3 s for the whole sweep, so a fresh index means
#       a sweep is active — or finished so recently that its post-arm repair
#       pass may still be mapping byte windows. Catches the between-cells gap
#       where G1 can be momentarily empty.
#   G3  resident-lock mutex: acquire /tmp/oc-resident.lock.d (mkdir, single
#       non-blocking attempt) and hold it for the rotation; release on exit.
#       Serializes against manual live work on :11436. If the invoker already
#       holds the lock (live demo under an orchestrator lock), set
#       OC_ROTATE_HOLDING_LOCK=1 to skip acquisition.
#
# ROTATION (copytruncate-style — the server is NEVER stopped/restarted; the
# resident :11436 is read-only infrastructure):
#   1. save the last OC_ROTATE_TAIL_BYTES of the log to <log>.1 (one
#      generation, overwritten each rotation);
#   2. `: > <log>` — truncate the live file in place.
# This is safe under launchd because StandardOutPath/StandardErrorPath fds are
# opened O_APPEND: after truncation the next write lands at the new EOF
# (offset 0), not at the stale offset — no sparse NUL prefix. Verified
# empirically (#015): a live appender's writes continue seamlessly after
# `: >`, the file restarts near-empty and grows, first bytes are real text.
# A cursor opened AFTER the rotation sees consistent offsets; cursors opened
# BEFORE would be corrupted, which is exactly what G1-G3 exclude.
#
# CAP: rotation only happens at all when the log exceeds OC_ROTATE_CAP_BYTES
# (default 52428800 = 50 MB; ~50 sweeps of headroom at the observed growth of
# well under 1 MB/sweep). Below the cap the script is a no-op (exit 0).
#
# NO LAUNCHD TIMER SHIPS WITH THIS (#015 decision): a StartInterval agent can
# still race a sweep that begins between the guard checks and the truncate
# (TOCTOU — the driver does not hold the resident lock). The supported
# invocations are (a) manual, between sweeps, when `--dry-run` shows
# rotate-needed, and (b) a future driver preflight that rotates BEFORE the
# sweep opens any cursor (recommended to #016, which owns the driver next).
#
# Usage:
#   rotate-opencode-server-log.sh [--dry-run] [--log <path>]
# Env knobs:
#   OPENCODE_LLAMA_LOG          log path (default /tmp/opencode-llama-server.log;
#                               same variable opencode-server + the driver honor)
#   OC_ROTATE_CAP_BYTES         rotate only above this size   (default 52428800)
#   OC_ROTATE_TAIL_BYTES        bytes preserved into <log>.1  (default 8388608)
#   OC_ROTATE_INDEX_DIR         sweep-index dir (default <repo>/host/test/.claw-runtime)
#   OC_ROTATE_INDEX_FRESH_MIN   index-mtime freshness window  (default 30 min)
#   OC_ROTATE_HOLDING_LOCK=1    invoker already holds /tmp/oc-resident.lock.d
# Exit codes: 0 rotated-or-below-cap (or dry-run), 2 guard refusal, 1 error.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

LOG_PATH="${OPENCODE_LLAMA_LOG:-/tmp/opencode-llama-server.log}"
CAP_BYTES="${OC_ROTATE_CAP_BYTES:-52428800}"        # 50 MB
TAIL_BYTES="${OC_ROTATE_TAIL_BYTES:-8388608}"        # 8 MB kept in <log>.1
INDEX_DIR="${OC_ROTATE_INDEX_DIR:-$REPO_ROOT/host/test/.claw-runtime}"
FRESH_MIN="${OC_ROTATE_INDEX_FRESH_MIN:-30}"
LOCK_DIR="/tmp/oc-resident.lock.d"
SWEEP_LABEL="mac-llm-lab.sweep"

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --log) shift; LOG_PATH="${1:?--log needs a path}" ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

log()    { printf '%s\n' "$*" >&2; }
refuse() { log "REFUSED: $*"; exit 2; }

# ---- size / cap check (cheap, before any guard) -----------------------------
[ -f "$LOG_PATH" ] || { log "no log at $LOG_PATH — nothing to rotate"; exit 0; }
SIZE="$(stat -f %z "$LOG_PATH" 2>/dev/null || wc -c < "$LOG_PATH" | tr -d ' ')"
if [ "$SIZE" -le "$CAP_BYTES" ]; then
  log "below cap: $LOG_PATH is ${SIZE} B <= cap ${CAP_BYTES} B — nothing to do"
  exit 0
fi
log "over cap: $LOG_PATH is ${SIZE} B > cap ${CAP_BYTES} B — rotation needed"

# ---- G1: no sweep containers ------------------------------------------------
if ! SWEEPS="$(docker ps -q --filter "label=$SWEEP_LABEL" 2>/dev/null)"; then
  refuse "docker unreachable — cannot verify no sweep is active (G1)"
fi
if [ -n "$SWEEPS" ]; then
  refuse "sweep container(s) running (label $SWEEP_LABEL): $(echo "$SWEEPS" | tr '\n' ' ') (G1)"
fi

# ---- G2: no fresh sweep index -----------------------------------------------
if [ -d "$INDEX_DIR" ]; then
  FRESH="$(find "$INDEX_DIR" -maxdepth 1 -name 'server-log-index.*.txt' -mmin "-$FRESH_MIN" 2>/dev/null | head -1)"
  if [ -n "$FRESH" ]; then
    refuse "fresh sweep index (mtime < ${FRESH_MIN}m): $FRESH — sweep active or its repair pass may still need byte offsets (G2)"
  fi
fi

# ---- G3: resident-lock mutex --------------------------------------------------
TOOK_LOCK=0
release_lock() { [ "$TOOK_LOCK" = 1 ] && rmdir "$LOCK_DIR" 2>/dev/null; return 0; }
if [ "${OC_ROTATE_HOLDING_LOCK:-0}" != 1 ]; then
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    TOOK_LOCK=1
    trap release_lock EXIT
  else
    refuse "resident lock held ($LOCK_DIR exists) and OC_ROTATE_HOLDING_LOCK != 1 (G3)"
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  log "DRY RUN: all guards pass; would save last ${TAIL_BYTES} B to $LOG_PATH.1 and truncate $LOG_PATH (currently ${SIZE} B)"
  exit 0
fi

# ---- rotate (copytruncate) ---------------------------------------------------
tail -c "$TAIL_BYTES" "$LOG_PATH" > "$LOG_PATH.1"
SAVED="$(stat -f %z "$LOG_PATH.1" 2>/dev/null || wc -c < "$LOG_PATH.1" | tr -d ' ')"
: > "$LOG_PATH"
NEW_SIZE="$(stat -f %z "$LOG_PATH" 2>/dev/null || wc -c < "$LOG_PATH" | tr -d ' ')"
log "rotated: $LOG_PATH ${SIZE} B -> ${NEW_SIZE} B (tail ${SAVED} B saved to $LOG_PATH.1)"
exit 0
