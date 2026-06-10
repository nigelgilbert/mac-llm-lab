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
# ── Runner image (Phase B toolchain, issue #009) ────────────────────────────
# The OpenCode phase runs in the BAKED eval-runner image (node + git + docker
# CLI + docker compose preinstalled) instead of stock docker:cli + a per-sweep
# `apk add`. Build it once (rebuild only when Dockerfile.runner changes):
#
#   cd host/test && docker compose build runner
#   # equivalently: docker build -f host/test/Dockerfile.runner \
#   #                 -t mac-llm-lab-eval-runner:local host/test
#
# Preflight fails loud with that hint if the image is missing. The image bakes
# TOOLCHAIN ONLY — no repo sources: the live-sources contract (path-matched
# repo mount, -w into host/test) and the /workspace bind are unchanged.
#
# ── Knobs (env) ─────────────────────────────────────────────────────────────
#   SMOKE_TESTS        space-separated tier-eval test_id stems   (default: deep-equal)
#   CONFIG_AB_REPEATS  runs per cell per phase (→ N per bucket)  (default: 1)
#   TIER               hardware tier                             (default: 64)
#   OC_CONFIGS         space-separated OpenCode CONFIG ids to run (default: opencode-a)
#                      as sequential Phase B sub-phases against the same registry.
#                      Sidecar-port arms (OPENCODE-SIDECAR-PORT-HANDOFF.md §4):
#                      OC_CONFIGS="opencode-a+git opencode-a+prompt"
#   CLAW_MODEL_CONFIG_ID   claw side model_config_id  (default: tier-64 v1-prod prod id)
#   PER_TEST_TIMEOUT   per-cell wallclock ceiling, seconds       (default: 600)
#   PHASE_SWAP         1 = launchd headroom swap (HITL)          (default: 0)
#   SKIP_PHASE_A       1 = reuse REGISTRY_OUT's claw rows, run   (default: 0)
#                      Phase B only (needs REGISTRY_OUT existing) (#019)
#   REGISTRY_OUT       explicit shared-registry path             (default: auto-timestamped)
#   RUNNER_IMAGE       baked Phase B runner image (#009)         (default: mac-llm-lab-eval-runner:local)
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
OC_CONFIGS="${OC_CONFIGS:-opencode-a}"
# SKIP_PHASE_A=1 (#019): reuse an existing registry's claw-rig rows and run ONLY
# Phase B (opencode-a), appending to that same file, then gate. For re-running a
# botched Phase B (e.g. the #019 oc-16 :11437 port wiring bug) without re-burning a
# good Phase A — and without bringing production claw down at all (oc never touches
# :11435). REQUIRES REGISTRY_OUT=<existing non-empty file under .claw-runtime>.
SKIP_PHASE_A="${SKIP_PHASE_A:-0}"

TEST_IMAGE="${TEST_IMAGE:-mac-llm-lab-test:local}"
# Baked Phase B runner (#009): node + git + docker CLI + compose preinstalled
# (Dockerfile.runner). Replaces stock docker:cli + apk-add-per-sweep.
RUNNER_IMAGE="${RUNNER_IMAGE:-mac-llm-lab-eval-runner:local}"
TEST_COMPOSE="$SCRIPT_DIR/docker-compose.yml"
OC_COMPOSE="$REPO_DIR/client/opencode/docker-compose.yml"
OC_SERVER="$REPO_DIR/host/llama-server/scripts/opencode-server"
ENV_FILE="$REPO_DIR/host/litellm/.env"
PLIST="$HOME/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist"

CLAW_HEALTH="http://127.0.0.1:11435/health"
BRIDGE_HEALTH="http://127.0.0.1:4000/health/liveliness"
OC_PORT="$([ "$TIER" = "16" ] && echo 11437 || echo 11436)"
OC_HEALTH="http://127.0.0.1:$OC_PORT/health"
# Tier-selectable OpenCode client config (#019). The OpenCode container's serving
# endpoint lives in its mounted opencode(.NN).json, NOT in OC_PORT — OC_PORT only
# health-checks the server. Phase B MUST pass the matching config or OpenCode dials
# the wrong port and every cell ConnectionRefused-loops to timeout (iters=1, 0
# tokens). tier-64 → opencode.json (:11436); tier-16 → opencode.16.json (:11437).
# Consumed by client/opencode/docker-compose.yml's ${OPENCODE_CONFIG_JSON} mount.
OC_CONFIG_JSON="$([ "$TIER" = "16" ] && echo ./opencode.16.json || echo ./opencode.json)"

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
# SKIP_PHASE_A preconditions: there must already BE claw rows to pair against, and
# downing claw for headroom makes no sense when claw isn't running this sweep.
if [ "$SKIP_PHASE_A" = 1 ]; then
  [ "$PHASE_SWAP" = 1 ] && err "SKIP_PHASE_A=1 is incompatible with PHASE_SWAP=1 (no claw phase to make headroom for)"
  [ -s "$HOST_REG" ] || err "SKIP_PHASE_A=1 reuses existing claw rows — set REGISTRY_OUT to an existing non-empty registry under $CLAW_RT_DIR; got empty/missing: $HOST_REG"
fi
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
# Fail loud BEFORE any server/container is touched if the baked runner image is
# absent (fresh clone, pruned image cache): Phase B cannot run without it.
docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1 \
  || err "missing baked eval-runner image $RUNNER_IMAGE (issue #009) — build it: (cd $SCRIPT_DIR && docker compose build runner)  [equivalently: docker build -f $SCRIPT_DIR/Dockerfile.runner -t $RUNNER_IMAGE $SCRIPT_DIR]"
# claw + bridge back ONLY Phase A; skip their preflight when Phase A is skipped
# (Phase B/opencode talks straight to the oc server on :$OC_PORT, never :11435/:4000).
if [ "$SKIP_PHASE_A" != 1 ]; then
  [ "$(http "$CLAW_HEALTH")"   = 200 ] || err "claw llama-server not green at $CLAW_HEALTH — this driver requires the production claw server up (it will NOT start one)"
  [ "$(http "$BRIDGE_HEALTH")" = 200 ] || err "LiteLLM bridge not green at $BRIDGE_HEALTH — start it: (cd $REPO_DIR/host/litellm && docker compose up -d)"
fi

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
if [ "$SKIP_PHASE_A" = 1 ]; then
log "==> Phase A: SKIPPED (SKIP_PHASE_A=1) — reusing existing claw-rig rows in:"
log "    $HOST_REG"
A_RC=0
else
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
fi

# ============================================================================
# Phase B — OpenCode arm(s): one sub-phase per OC_CONFIGS entry
# ============================================================================
log ""
log "==> Phase B: OpenCode arms [$OC_CONFIGS] (oc llama-server :$OC_PORT)"

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

# Opencode phase runs in the path-matched BAKED runner image $RUNNER_IMAGE (NOT
# the test image, which has no docker CLI): node + git + docker CLI + compose are
# preinstalled at build time (Dockerfile.runner, #009) — no per-sweep apk add, no
# network dependency at phase start. It mounts the host socket + the repo at its
# own path + H at /workspace and runs the LIVE test sources (so lib/* is the
# working tree, not a baked copy — the runner image bakes toolchain only, never
# repo sources). This is the proven #011/#012 incantation
# (scripts/opencode-workspace-roundtrip.mjs footer), extended to run the
# tier-eval suite with the registry reporter wired and RUN_REGISTRY_EMIT=1 so
# each cell emits a config_id-stamped row. We replicate entrypoint.sh's per-cell
# loop inline (no claw alias table needed on this side). One sub-phase per
# OC_CONFIGS entry, all appending to the same registry; the sidecar-port arms
# (opencode-a+git / opencode-a+prompt) git-init the workspace per-cell inside
# runAgent.js, which is why `git` is baked into the runner image.
#
# RUN_REGISTRY_TESTS_DIR is overridden to the path-matched tests dir (the default
# /test/... only exists in the baked test image). RUN_REGISTRY_MODEL_CONFIG_ID is
# deliberately UNSET so maybeEmitRegistryRow auto-picks the tier's per-config
# fingerprint via modelConfigIdFor(); an explicit value would defeat that.
B_RC=0
for OC_CONFIG in $OC_CONFIGS; do
log "[B] running smoke under $OC_CONFIG (filter: $FILTER)"
set +e
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$H:/workspace" \
  -e CONFIG="$OC_CONFIG" \
  -e HOST_WORKSPACE="$H" \
  -e TIER="$TIER" \
  -e OPENCODE_CONFIG_JSON="$OC_CONFIG_JSON" \
  -e TIER_EVAL_FILTER="$FILTER" \
  -e PER_TEST_TIMEOUT="$PER_TEST_TIMEOUT" \
  -e RUN_REGISTRY_EMIT=1 \
  -e RUN_REGISTRY_KIND=smoke \
  -e RUN_REGISTRY_HARDWARE_TIER="$TIER" \
  -e RUN_REGISTRY_TESTS_DIR="$REPO_DIR/host/test/__tests__/tier-eval" \
  -e RUN_REGISTRY_PATH="$HOST_REG" \
  -e GIT_SHA="$GIT_SHA" \
  --entrypoint sh "$RUNNER_IMAGE" -c '
    set -u
    # Toolchain assert (#009): everything below is BAKED into the runner image
    # (Dockerfile.runner) — if any tool is missing, someone pointed RUNNER_IMAGE
    # at a bare image; fail fast with the rebuild hint instead of mid-cell.
    for tool in node git docker timeout; do
      command -v "$tool" >/dev/null 2>&1 \
        || { echo "FATAL: $tool missing from runner image — rebuild it: (cd host/test && docker compose build runner)" >&2; exit 3; }
    done
    docker compose version >/dev/null 2>&1 \
      || { echo "FATAL: docker compose plugin missing from runner image — rebuild it: (cd host/test && docker compose build runner)" >&2; exit 3; }
    # Fail fast + loud if the shared workspace bind mount did not land — otherwise
    # every cell false-fails deep inside reset() with a cryptic ENOENT. A green
    # here means HOST_WORKSPACE crossed the container boundary (mount contract).
    if [ ! -d /workspace ]; then
      echo "FATAL: /workspace not visible in sibling (HOST_WORKSPACE=$HOST_WORKSPACE) — OrbStack share/mount issue; aborting before false-failing every cell." >&2
      exit 4
    fi
    rc=0
    for stem in $TIER_EVAL_FILTER; do
      echo ">>> $CONFIG cell: $stem (cap ${PER_TEST_TIMEOUT}s)"
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
SUB_RC=$?
set -e
[ "$SUB_RC" -ne 0 ] && B_RC=1
log "[B] $OC_CONFIG sub-phase exit rc=$SUB_RC (cell failures are tolerated; rows still emitted)"
done
log "[B] opencode phase exit rc=$B_RC"

# ============================================================================
# Gate — both sides bucketed, every row config_id-stamped
# ============================================================================
log ""
log "==> Gate: paired_bootstrap must bucket BOTH configs (claw baseline NOT dropped)"
if [ ! -s "$HOST_REG" ]; then
  err "no registry rows at $HOST_REG — both phases emitted nothing (check phase output above)"
fi

# Run the gate inside the test image (has node), against the LIVE registry + libs
# via a path-matched mount. One gate run per OpenCode arm (--treatment): with
# >2 configs in one registry the default treatment (opencode-a) would bucket
# zero rows for a sidecar-port-only sweep and falsely fail.
GATE_RC=0
set +e
for OC_CONFIG in $OC_CONFIGS; do
log "[gate] treatment=$OC_CONFIG vs baseline=claw-rig"
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  --entrypoint node "$TEST_IMAGE" \
  scripts/config-ab-pairing-check.mjs "$HOST_REG" --tier "$TIER" --treatment "$OC_CONFIG"
SUB_RC=$?
[ "$SUB_RC" -ne 0 ] && GATE_RC=1
done
set -e

log ""
log "==> Done. registry: $HOST_REG   (phaseA rc=$A_RC, phaseB rc=$B_RC, gate rc=$GATE_RC)"
exit "$GATE_RC"
