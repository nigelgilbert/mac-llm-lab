#!/usr/bin/env bash
# ============================================================================
# run-config-ab.sh — phase-swap A/B driver for the OpenCode adoption eval (#013)
#
#   Phase A = claw-rig    (ClawCode → LiteLLM → claw llama-server :11435)
#   Phase B = opencode-a  (OpenCode → OpenCode-dedicated llama-server :11436)
#
# It runs the SAME smoke test set under each config and appends BOTH phases' run-
# registry rows to ONE shared registry file, so the #015 paired-bootstrap can pair
# them by task. Modeled on run-backend-ab.sh. Parent: OPENCODE-HARNESS-AB-PLAN.md
# §4.2/§4.6; mount contract: host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md.
#
# config_id is NOT set by this script per-phase by hand. The single CONFIG env it
# swaps between phases drives BOTH the runner selection (lib/runAgent.js
# selectRunner) AND the row's config_id (lib/claw.js maybeEmitRegistryRow →
# resolveConfigId), so a row's bundle label can never disagree with the runner
# that produced it. We emit rows INLINE (RUN_REGISTRY_EMIT=1) — the path that
# stamps config_id — never via the offline harvester, whose single --ctx would
# mislabel one phase. config-ab-pairing-check.mjs then GATES the result: it fails
# the run if any row lacks a config_id or if the claw baseline bucketed zero.
#
# ── Server topology (default) ───────────────────────────────────────────────
# CO-RESIDENT, claw never touched. The production claw llama-server on :11435
# MUST stay green throughout (it backs Phase A and is the lab's production
# server). The OpenCode-dedicated server on :11436 is brought up for Phase B if
# it isn't already, and stopped on exit ONLY if THIS script started it (leave it
# as found). On a 64 GB box the two tier-64 GGUFs (~21 GB each) co-reside fine
# for a 1–2 test smoke; the ~50 GB co-residence pressure only matters for the
# precision full sweep (#014), which is why that one uses headroom mode.
#
# ── PHASE_SWAP=1 (memory-headroom mode, HITL, for #014) ─────────────────────
# Set PHASE_SWAP=1 to instead bring the claw launchd instance DOWN for Phase B
# and back UP afterwards (one server resident at a time, full headroom per side),
# mirroring run-backend-ab.sh's launchctl pattern. This stops the production claw
# server mid-run, so it is HITL: run it watched, never AFK. UNTESTED in the
# commit that introduced this script (the #013 DoD smoke ran the default co-
# resident path); audit before the #014 sweep.
#
# The EXIT/INT/TERM trap restores production state in BOTH modes (oc stopped iff
# we started it, claw launchd reloaded iff we downed it, orphaned oc-run-*
# sibling containers reaped) and asserts claw :11435 is still green on the way
# out — so a mid-run abort leaves the lab as it found it.
#
# ── Knobs (env) ─────────────────────────────────────────────────────────────
#   SMOKE_TESTS        space-separated tier-eval test_id stems   (default: deep-equal)
#   CONFIG_AB_REPEATS  runs per cell per phase (→ N per bucket)  (default: 1)
#   TIER               hardware tier                             (default: 64)
#   CLAW_MODEL_CONFIG_ID   claw side model_config_id  (default: tier-64 v1-prod prod id)
#   PER_TEST_TIMEOUT   per-cell wallclock ceiling, seconds       (default: 600)
#   PHASE_SWAP         1 = launchd headroom swap (HITL)          (default: 0)
#   REGISTRY_OUT       explicit shared-registry path             (default: auto-timestamped)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---- config / knobs --------------------------------------------------------
SMOKE_TESTS="${SMOKE_TESTS:-deep-equal}"
REPEATS="${CONFIG_AB_REPEATS:-1}"
TIER="${TIER:-64}"
CLAW_MODEL_CONFIG_ID="${CLAW_MODEL_CONFIG_ID:-qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01}"
PER_TEST_TIMEOUT="${PER_TEST_TIMEOUT:-600}"
PHASE_SWAP="${PHASE_SWAP:-0}"

TEST_IMAGE="${TEST_IMAGE:-mac-llm-lab-test:local}"
DOCKER_CLI_IMAGE="${DOCKER_CLI_IMAGE:-docker:cli}"
TEST_COMPOSE="$SCRIPT_DIR/docker-compose.yml"
OC_COMPOSE="$REPO_DIR/client/opencode/docker-compose.yml"
OC_SERVER="$REPO_DIR/host/llama-server/scripts/opencode-server"
ENV_FILE="$REPO_DIR/host/litellm/.env"
PLIST="$HOME/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist"

CLAW_HEALTH="http://127.0.0.1:11435/health"
BRIDGE_HEALTH="http://127.0.0.1:4000/health/liveliness"
OC_PORT="$([ "$TIER" = "16" ] && echo 11437 || echo 11436)"
OC_HEALTH="http://127.0.0.1:$OC_PORT/health"

# Shared registry both phases append to (path-matched → same host file in both
# containers). Lives under the gitignored runtime root by convention.
STAMP="$(date +%Y%m%d-%H%M%S)"
HOST_REG="${REGISTRY_OUT:-$REPO_DIR/host/test/.claw-runtime/run_registry.config-ab-${STAMP}.jsonl}"
# Phase A writes its row via the compose mount (host/test/.claw-runtime → the test
# container's /workspace/.claw-runtime), so it can ONLY land a file in that dir. Derive
# REGNAME from HOST_REG's basename and REQUIRE HOST_REG to live under .claw-runtime — else
# the two phases write different host files and the gate sees claw=0 (the REGISTRY_OUT
# footgun, #014). Fail loud here (before any server/container is touched; trap not yet set).
CLAW_RT_DIR="$REPO_DIR/host/test/.claw-runtime"
case "$HOST_REG" in
  "$CLAW_RT_DIR"/*) : ;;
  *) echo "ERROR: REGISTRY_OUT must be a path under $CLAW_RT_DIR (Phase A writes there via the compose mount); got: $HOST_REG" >&2; exit 1 ;;
esac
REGNAME="$(basename "$HOST_REG")"
# Per-phase shared workspace H for the opencode sibling (mount contract §"What
# #013 must do"). Gitignored, host-shareable, sibling of the oc sidecar root.
H="$REPO_DIR/client/opencode/.opencode-runtime/phase-ws"
GIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

# Build the entrypoint TIER_EVAL_FILTER: each test stem repeated REPEATS times so
# a single container invocation emits N rows per cell.
build_filter() {
  local out="" stem r
  for stem in $SMOKE_TESTS; do
    for r in $(seq 1 "$REPEATS"); do out="$out $stem"; done
  done
  printf '%s' "${out# }"
}
FILTER="$(build_filter)"

# ---- preflight -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || err "missing: docker"
command -v curl   >/dev/null 2>&1 || err "missing: curl"
[ -f "$ENV_FILE" ]    || err "missing LiteLLM env file (untracked secret): $ENV_FILE"
[ -f "$TEST_COMPOSE" ] || err "missing test compose: $TEST_COMPOSE"
[ -f "$OC_COMPOSE" ]  || err "missing opencode compose: $OC_COMPOSE"
[ -x "$OC_SERVER" ]   || err "missing/non-exec opencode-server: $OC_SERVER"
docker image inspect "$TEST_IMAGE" >/dev/null 2>&1 \
  || err "missing image $TEST_IMAGE — build it: (cd $SCRIPT_DIR && docker compose build)"
docker image inspect "$DOCKER_CLI_IMAGE" >/dev/null 2>&1 \
  || err "missing image $DOCKER_CLI_IMAGE — pull it: docker pull $DOCKER_CLI_IMAGE"
[ "$(http "$CLAW_HEALTH")"   = 200 ] || err "claw llama-server not green at $CLAW_HEALTH — this driver requires the production claw server up (it will NOT start one)"
[ "$(http "$BRIDGE_HEALTH")" = 200 ] || err "LiteLLM bridge not green at $BRIDGE_HEALTH — start it: (cd $REPO_DIR/host/litellm && docker compose up -d)"

# ---- cleanup-on-exit: always restore production state ----------------------
STARTED_OC=0      # set to 1 iff we start the oc server (→ we stop it)
CLAW_DOWNED=0     # set to 1 iff PHASE_SWAP downs the claw launchd (→ we reload it)
cleanup() {
  local rc=$?
  log ""
  log "[cleanup] restoring production state (driver rc=$rc)..."

  # Reap any sibling run containers this sweep may have orphaned (a wedged
  # opencode run reaped by runOpenCode's own timeout normally clears these; this
  # is the backstop for one that slipped through). Best-effort; never fatal.
  local orphans
  orphans="$(docker ps -aq --filter 'name=oc-run-' 2>/dev/null || true)"
  if [ -n "$orphans" ]; then
    log "[cleanup] reaping orphaned oc-run-* containers: $(echo "$orphans" | wc -l | tr -d ' ')"
    # shellcheck disable=SC2086
    docker rm -f $orphans >/dev/null 2>&1 || true
  fi

  # Stop the oc server ONLY if we started it (else leave it as we found it).
  if [ "$STARTED_OC" = 1 ]; then
    log "[cleanup] stopping oc-$TIER server (we started it)..."
    OPENCODE_TIER="$TIER" "$OC_SERVER" stop >/dev/null 2>&1 || true
  fi

  # Reload the production claw launchd instance iff PHASE_SWAP downed it.
  if [ "$CLAW_DOWNED" = 1 ]; then
    log "[cleanup] reloading production claw launchd..."
    launchctl load -w "$PLIST" >/dev/null 2>&1 || true
    local i=0
    while [ "$i" -lt 60 ]; do
      [ "$(http "$CLAW_HEALTH")" = 200 ] && break
      i=$((i + 1)); sleep 1
    done
  fi

  # Post-condition: claw MUST be green on the way out. Warn loudly otherwise —
  # the lab is the user's production environment.
  if [ "$(http "$CLAW_HEALTH")" = 200 ]; then
    log "[cleanup] claw :11435 green ✓"
  else
    log "[cleanup] ⚠⚠ claw :11435 is NOT green — production server is down; reload it: launchctl load -w $PLIST"
  fi
}
trap cleanup EXIT INT TERM

log "==> run-config-ab.sh  tier=$TIER  tests=[$SMOKE_TESTS] repeats=$REPEATS  mode=$([ "$PHASE_SWAP" = 1 ] && echo PHASE_SWAP-headroom || echo co-resident)"
log "    shared registry → $HOST_REG"
log "    harness_version (GIT_SHA) = $GIT_SHA"

# ============================================================================
# Phase A — claw-rig
# ============================================================================
log ""
log "==> Phase A: claw-rig (CONFIG=claw-rig, claw llama-server :11435)"
if [ "$PHASE_SWAP" = 1 ]; then
  # Headroom mode: ensure the oc server is DOWN so claw runs with full memory.
  if [ "$(http "$OC_HEALTH")" = 200 ]; then
    log "[A] PHASE_SWAP: stopping oc-$TIER for full claw headroom..."
    OPENCODE_TIER="$TIER" "$OC_SERVER" stop >/dev/null 2>&1 || true
  fi
fi
[ "$(http "$CLAW_HEALTH")" = 200 ] || err "[A] claw not green at $CLAW_HEALTH"

# Single container invocation; the baked entrypoint.sh loops FILTER (each cell →
# 1 row). RUN_REGISTRY_PATH points at the in-container claw-runtime mount, which
# is the host file $HOST_REG via the compose's ./.claw-runtime:/workspace/.claw-runtime.
#
# CRITICAL — path-match the repo + -w so this runs the LIVE working-tree lib/,
# NOT the baked image's lib/. The test image bakes a COPY of lib/ at build time;
# if it predates the #002 config_id dimension / #011 selector (it did, when this
# driver was written), maybeEmitRegistryRow emits rows with NO config_id — which
# paired_bootstrap then SILENTLY drops. The opencode phase already path-matches
# (it must, for the docker CLI); doing the same here makes BOTH sides run the
# same live row-assembly code, so config_id can never be stale on one side only.
# RUN_REGISTRY_TESTS_DIR is pointed at the live tests dir for the same reason
# (the baked /test/__tests__ default would read stale manifest headers). The gate
# is the backstop, but this closes the footgun at the root.
log "[A] running smoke under claw (filter: $FILTER)"
set +e
docker compose --env-file "$ENV_FILE" -f "$TEST_COMPOSE" run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -e BACKEND=llama-server \
  -e CONFIG=claw-rig \
  -e TEST_SUITE=tier-eval \
  -e TIER_EVAL_FILTER="$FILTER" \
  -e TIER="$TIER" \
  -e PER_TEST_TIMEOUT="$PER_TEST_TIMEOUT" \
  -e RUN_REGISTRY_EMIT=1 \
  -e RUN_REGISTRY_KIND=smoke \
  -e RUN_REGISTRY_HARDWARE_TIER="$TIER" \
  -e RUN_REGISTRY_MODEL_CONFIG_ID="$CLAW_MODEL_CONFIG_ID" \
  -e RUN_REGISTRY_TESTS_DIR="$REPO_DIR/host/test/__tests__/tier-eval" \
  -e RUN_REGISTRY_PATH="/workspace/.claw-runtime/$REGNAME" \
  -e GIT_SHA="$GIT_SHA" \
  test
A_RC=$?
set -e
log "[A] claw phase exit rc=$A_RC (cell failures are tolerated; rows still emitted)"

# ============================================================================
# Phase B — opencode-a
# ============================================================================
log ""
log "==> Phase B: opencode-a (CONFIG=opencode-a, oc llama-server :$OC_PORT)"

if [ "$PHASE_SWAP" = 1 ]; then
  log "[B] PHASE_SWAP: bringing claw launchd DOWN (headroom mode, HITL)..."
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  CLAW_DOWNED=1
fi

# Bring up the oc server if it isn't already (start iff needed → stop iff started).
if [ "$(http "$OC_HEALTH")" = 200 ]; then
  log "[B] oc-$TIER already green on :$OC_PORT — using as found (will not stop it)"
else
  log "[B] starting oc-$TIER server on :$OC_PORT..."
  STARTED_OC=1   # set BEFORE start so a partial start is still cleaned up
  OPENCODE_TIER="$TIER" "$OC_SERVER" start || err "[B] oc-$TIER server failed to reach green /health"
fi
[ "$(http "$OC_HEALTH")" = 200 ] || err "[B] oc-$TIER not green at $OC_HEALTH"

# Per-phase shared workspace H, emptied IN PLACE. We deliberately do NOT
# `rm -rf "$H" && mkdir` it: churning H's inode right before bind-mounting it can
# leave OrbStack's file-share with a stale handle, so /workspace shows up EMPTY
# or ABSENT in the sibling and every cell false-fails at workspace.reset() with a
# cryptic `mkdir '/workspace'` ENOENT (observed once under co-resident load). Keep
# the dir, drop only its contents; workspace.reset() clears per-cell anyway.
mkdir -p "$H"
find "$H" -mindepth 1 -exec rm -rf {} + 2>/dev/null || true
log "[B] shared workspace H = $H"

# Opencode phase runs in a path-matched docker:cli container (NOT the test image,
# which has no docker CLI): it mounts the host socket + the repo at its own path +
# H at /workspace, then adds node + the compose plugin and runs the LIVE test
# sources (so lib/* is the working tree, not a baked copy). This is the proven
# #011/#012 incantation (scripts/opencode-workspace-roundtrip.mjs footer),
# extended to run the tier-eval suite with the registry reporter wired and
# RUN_REGISTRY_EMIT=1 so each cell emits a config_id-stamped row. We replicate
# entrypoint.sh's per-cell loop inline (no claw alias table needed on this side).
#
# RUN_REGISTRY_TESTS_DIR is overridden to the path-matched tests dir (the default
# /test/... only exists in the baked test image). RUN_REGISTRY_MODEL_CONFIG_ID is
# deliberately UNSET so maybeEmitRegistryRow auto-picks the tier's opencode-a
# fingerprint via modelConfigIdFor(); an explicit value would defeat that.
log "[B] running smoke under opencode (filter: $FILTER)"
set +e
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$H:/workspace" \
  -e CONFIG=opencode-a \
  -e HOST_WORKSPACE="$H" \
  -e TIER="$TIER" \
  -e TIER_EVAL_FILTER="$FILTER" \
  -e PER_TEST_TIMEOUT="$PER_TEST_TIMEOUT" \
  -e RUN_REGISTRY_EMIT=1 \
  -e RUN_REGISTRY_KIND=smoke \
  -e RUN_REGISTRY_HARDWARE_TIER="$TIER" \
  -e RUN_REGISTRY_TESTS_DIR="$REPO_DIR/host/test/__tests__/tier-eval" \
  -e RUN_REGISTRY_PATH="$HOST_REG" \
  -e GIT_SHA="$GIT_SHA" \
  --entrypoint sh "$DOCKER_CLI_IMAGE" -c '
    set -u
    apk add --no-cache nodejs docker-cli-compose coreutils >/dev/null 2>&1 \
      || { echo "FATAL: apk add (nodejs/docker-cli-compose/coreutils) failed — no network?" >&2; exit 3; }
    # Fail fast + loud if the shared workspace bind mount did not land — otherwise
    # every cell false-fails deep inside reset() with a cryptic ENOENT. A green
    # here means HOST_WORKSPACE crossed the container boundary (mount contract).
    if [ ! -d /workspace ]; then
      echo "FATAL: /workspace not visible in sibling (HOST_WORKSPACE=$HOST_WORKSPACE) — OrbStack share/mount issue; aborting before false-failing every cell." >&2
      exit 4
    fi
    rc=0
    for stem in $TIER_EVAL_FILTER; do
      echo ">>> opencode cell: $stem (cap ${PER_TEST_TIMEOUT}s)"
      timeout --signal=TERM --kill-after=20s "${PER_TEST_TIMEOUT}s" \
        node --test --test-concurrency=1 \
          --test-reporter=spec --test-reporter-destination=stdout \
          --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout \
          "__tests__/tier-eval/${stem}.test.js"
      cell=$?
      [ "$cell" -ne 0 ] && { echo ">>> cell $stem rc=$cell (row still emitted; continuing)"; rc=1; }
    done
    exit $rc
  '
B_RC=$?
set -e
log "[B] opencode phase exit rc=$B_RC (cell failures are tolerated; rows still emitted)"

# ============================================================================
# Gate — both sides bucketed, every row config_id-stamped
# ============================================================================
log ""
log "==> Gate: paired_bootstrap must bucket BOTH configs (claw baseline NOT dropped)"
if [ ! -s "$HOST_REG" ]; then
  err "no registry rows at $HOST_REG — both phases emitted nothing (check phase output above)"
fi

# Run the gate inside the test image (has node), against the LIVE registry + libs
# via a path-matched mount.
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  --entrypoint node "$TEST_IMAGE" \
  scripts/config-ab-pairing-check.mjs "$HOST_REG" --tier "$TIER"
GATE_RC=$?

log ""
log "==> Done. registry: $HOST_REG   (phaseA rc=$A_RC, phaseB rc=$B_RC, gate rc=$GATE_RC)"
exit "$GATE_RC"
