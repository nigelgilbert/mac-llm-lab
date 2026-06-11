#!/usr/bin/env bash
# ============================================================================
# run-config-ab.sh — generic config-vs-config sweep driver for the tier-eval
# panel (issue #010; successor to the #013 claw-vs-opencode phase-swap driver).
#
# Runs the SAME test cells under N config arms and appends every arm's run-
# registry rows to ONE shared registry file, so lib/paired_bootstrap.js can
# pair them by task. Arms are OpenCode `CONFIG` ids (lib/config.js
# OPENCODE_CONFIGS — e.g. opencode-a, opencode-a+git, opencode-a+prompt;
# future arms: prompt variants, samplers, models, thinking on/off). The
# historical `claw-rig` config_id is readable in preserved registries but NOT
# runnable (claw stack retired in #008/#010; archived at tag claw-stack-final).
#
# ── Interface ───────────────────────────────────────────────────────────────
#   ARMS       space-separated runnable CONFIG ids to execute, in order
#              (default: "opencode-a"). Each arm runs every cell in
#              SMOKE_TESTS × CONFIG_AB_REPEATS and appends rows to the shared
#              registry.
#   BASELINE   the config_id the gate pairs each other arm against
#              (default: first word of ARMS). May be a config that is NOT in
#              ARMS — e.g. a historical claw-rig or a previously-swept arm —
#              when REUSE_ROWS=1 supplies its rows from an existing registry.
#
# After the sweep, the gate (scripts/config-ab-pairing-check.mjs) runs once
# per non-baseline arm with explicit `--treatment <arm> --baseline $BASELINE`,
# asserting every row is config_id-stamped and both sides bucketed. Verdicts
# are NOT rendered here — run scripts/config-ab-verdict.mjs with the same
# --treatment/--baseline flags against the registry afterwards.
#
# config_id is NOT set per-arm by hand. The single CONFIG env swapped between
# sub-phases drives BOTH the runner selection (lib/runAgent.js selectRunner)
# AND the row's config_id (lib/registry_emit.js → resolveConfigId), so a row's
# bundle label can never disagree with the runner that produced it. Rows are
# emitted INLINE (RUN_REGISTRY_EMIT=1) — never via the offline harvester.
#
# ── Server topology ─────────────────────────────────────────────────────────
# One OpenCode-dedicated llama-server per TIER (host/llama-server/scripts/
# opencode-server): tier 64 → :11436 (the RESIDENT launchd daemon — normally
# already green; this driver uses it as found and NEVER stops it), tier 16 →
# :11437 and tier 32 → :11438 (on-demand: started here iff not already green,
# and stopped on exit ONLY if THIS script started it — leave the lab as found).
#
# ── Runner image (issue #009) ───────────────────────────────────────────────
# Every arm runs in the BAKED eval-runner image (node + git + docker CLI +
# compose preinstalled). Build it once (rebuild only when Dockerfile.runner
# changes):
#
#   cd host/test && docker compose build runner
#   # equivalently: docker build -f host/test/Dockerfile.runner \
#   #                 -t mac-llm-lab-eval-runner:local host/test
#
# Preflight fails loud with that hint if the image is missing. The image bakes
# TOOLCHAIN ONLY — no repo sources: the live-sources contract (path-matched
# repo mount, -w into host/test) and the /workspace bind are unchanged
# (mount contract: host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md).
#
# ── Reuse-existing-rows mode (REUSE_ROWS=1) ─────────────────────────────────
# Append THIS sweep's arms to an EXISTING registry (REGISTRY_OUT required,
# non-empty, under host/test/.claw-runtime/) instead of starting a fresh one —
# e.g. add a new arm against an already-swept baseline without re-burning it.
# In fresh mode (default) REGISTRY_OUT must not already exist, so rows from
# different sweeps can't mix silently. (The historical "REGISTRY_OUT split-file
# bug" died with the claw phase: every arm AND the gate now address the same
# absolute host path through the path-matched repo mount.)
#
# ── Knobs (env) ─────────────────────────────────────────────────────────────
#   SMOKE_TESTS        space-separated tier-eval test_id stems   (default: deep-equal)
#   CONFIG_AB_REPEATS  runs per cell per arm (→ N per bucket)    (default: 1)
#   TIER               hardware tier: 64 | 16 | 32               (default: 64)
#   ARMS               runnable CONFIG ids to sweep              (default: opencode-a)
#   BASELINE           gate baseline config_id                   (default: first ARMS entry)
#   PER_TEST_TIMEOUT   per-cell wallclock ceiling, seconds       (default: 600)
#   REUSE_ROWS         1 = append to existing REGISTRY_OUT       (default: 0)
#   REGISTRY_OUT       explicit shared-registry path             (default: auto-timestamped)
#   RUNNER_IMAGE       baked eval-runner image (#009)            (default: mac-llm-lab-eval-runner:local)
#
# Examples:
#   # one-cell smoke of the default arm on the resident tier-64 daemon:
#   host/test/run-config-ab.sh
#
#   # sidecar-port pair at tier 16 (driver starts :11437, stops it after):
#   TIER=16 ARMS="opencode-a+git opencode-a+prompt" BASELINE=opencode-a+git \
#     SMOKE_TESTS="deep-equal" host/test/run-config-ab.sh
#
#   # tier-32 cells (#011): on-demand :11438, arm vs itself = row-discipline smoke
#   TIER=32 ARMS="opencode-a" SMOKE_TESTS="deep-equal wordy" \
#     host/test/run-config-ab.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---- config / knobs --------------------------------------------------------
SMOKE_TESTS="${SMOKE_TESTS:-deep-equal}"
REPEATS="${CONFIG_AB_REPEATS:-1}"
TIER="${TIER:-64}"
PER_TEST_TIMEOUT="${PER_TEST_TIMEOUT:-600}"
ARMS="${ARMS:-opencode-a}"
BASELINE="${BASELINE:-${ARMS%% *}}"
REUSE_ROWS="${REUSE_ROWS:-0}"

# Baked arm runner (#009): node + git + docker CLI + compose preinstalled
# (Dockerfile.runner). Also hosts the gate (it just needs node + the repo mount).
RUNNER_IMAGE="${RUNNER_IMAGE:-mac-llm-lab-eval-runner:local}"
OC_COMPOSE="$REPO_DIR/client/opencode/docker-compose.yml"
OC_SERVER="$REPO_DIR/host/llama-server/scripts/opencode-server"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

# Tier → OpenCode server port + client config (#019 wiring, #002 tier-32 port).
# The OpenCode container's serving endpoint lives in its mounted
# opencode(.NN).json, NOT in OC_PORT — OC_PORT only health-checks the server.
# Each arm MUST get the matching config or OpenCode dials the wrong port and
# every cell ConnectionRefused-loops to timeout (iters=1, 0 tokens). Consumed
# by client/opencode/docker-compose.yml's ${OPENCODE_CONFIG_JSON} mount.
case "$TIER" in
  64) OC_PORT=11436; OC_CONFIG_JSON=./opencode.json ;;
  16) OC_PORT=11437; OC_CONFIG_JSON=./opencode.16.json ;;
  32) OC_PORT=11438; OC_CONFIG_JSON=./opencode.32.json ;;
  *)  err "TIER=$TIER is not a known tier (64 | 16 | 32)" ;;
esac
OC_HEALTH="http://127.0.0.1:$OC_PORT/health"

# Shared registry every arm appends to (path-matched → same host file in every
# sibling). Lives under the gitignored runtime root by convention.
STAMP="$(date +%Y%m%d-%H%M%S)"
CLAW_RT_DIR="$REPO_DIR/host/test/.claw-runtime"
HOST_REG="${REGISTRY_OUT:-$CLAW_RT_DIR/run_registry.config-ab-${STAMP}.jsonl}"
case "$HOST_REG" in
  "$CLAW_RT_DIR"/*) : ;;
  *) err "REGISTRY_OUT must be a path under $CLAW_RT_DIR (gitignored runtime root; visible through the path-matched repo mount); got: $HOST_REG" ;;
esac
if [ "$REUSE_ROWS" = 1 ]; then
  # Reuse mode: BASELINE (and pairing) may come from rows already in the file.
  [ -s "$HOST_REG" ] || err "REUSE_ROWS=1 appends to existing rows — set REGISTRY_OUT to an existing non-empty registry under $CLAW_RT_DIR; got empty/missing: $HOST_REG"
else
  [ ! -s "$HOST_REG" ] || err "REGISTRY_OUT already exists ($HOST_REG) — set REUSE_ROWS=1 to append to it, or pick a fresh path (rows from different sweeps must not mix silently)"
fi

# Per-arm shared workspace H for the opencode sibling (mount contract §"What
# the driver must do"). Gitignored, host-shareable, sibling of the oc sidecar root.
H="$REPO_DIR/client/opencode/.opencode-runtime/phase-ws"
GIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Build the per-arm cell filter: each test stem repeated REPEATS times so a
# single sub-phase invocation emits N rows per cell.
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
[ -f "$OC_COMPOSE" ] || err "missing opencode compose: $OC_COMPOSE"
[ -x "$OC_SERVER" ]  || err "missing/non-exec opencode-server: $OC_SERVER"
# Fail loud BEFORE any server/container is touched if the baked runner image is
# absent (fresh clone, pruned image cache): no arm can run without it.
docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1 \
  || err "missing baked eval-runner image $RUNNER_IMAGE (issue #009) — build it: (cd $SCRIPT_DIR && docker compose build runner)  [equivalently: docker build -f $SCRIPT_DIR/Dockerfile.runner -t $RUNNER_IMAGE $SCRIPT_DIR]"

# Validate ARMS/BASELINE against the SINGLE source of truth (lib/config.js)
# instead of duplicating the enum in bash: every arm must be RUNNABLE
# (OPENCODE_CONFIGS); the baseline must be a VALID config_id (it may be a
# historical, non-runnable one — e.g. claw-rig rows in a reused registry).
docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -e ARMS="$ARMS" -e BASELINE="$BASELINE" -e CONFIG_JS="$REPO_DIR/host/test/lib/config.js" \
  --entrypoint node "$RUNNER_IMAGE" -e '
    import(process.env.CONFIG_JS).then(({ VALID_CONFIGS, OPENCODE_CONFIGS }) => {
      const arms = process.env.ARMS.trim().split(/\s+/);
      const baseline = process.env.BASELINE;
      const bad = arms.filter((a) => !OPENCODE_CONFIGS.includes(a));
      if (bad.length) {
        console.error(`ARMS entries not runnable (must be in OPENCODE_CONFIGS {${OPENCODE_CONFIGS.join(", ")}}): ${bad.join(", ")}`);
        process.exit(1);
      }
      if (!VALID_CONFIGS.includes(baseline)) {
        console.error(`BASELINE "${baseline}" not in VALID_CONFIGS {${VALID_CONFIGS.join(", ")}}`);
        process.exit(1);
      }
    });
  ' || err "ARMS/BASELINE validation failed (see message above)"

# ---- cleanup-on-exit: leave the lab as found -------------------------------
STARTED_OC=0      # set to 1 iff we start the oc server (→ we stop it)
cleanup() {
  local rc=$?
  log ""
  log "[cleanup] restoring lab state (driver rc=$rc)..."

  # Reap any sibling run containers this sweep may have orphaned (a wedged
  # opencode run reaped by runOpenCode's own timeout normally clears these;
  # this is the backstop for one that slipped through). Best-effort; never fatal.
  local orphans
  orphans="$(docker ps -aq --filter 'name=oc-run-' 2>/dev/null || true)"
  if [ -n "$orphans" ]; then
    log "[cleanup] reaping orphaned oc-run-* containers: $(echo "$orphans" | wc -l | tr -d ' ')"
    # shellcheck disable=SC2086
    docker rm -f $orphans >/dev/null 2>&1 || true
  fi

  # Stop the oc server ONLY if we started it (else leave it as we found it —
  # in particular the resident tier-64 daemon on :11436 is never touched).
  if [ "$STARTED_OC" = 1 ]; then
    log "[cleanup] stopping oc-$TIER server (we started it)..."
    OPENCODE_TIER="$TIER" "$OC_SERVER" stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

log "==> run-config-ab.sh  tier=$TIER  tests=[$SMOKE_TESTS] repeats=$REPEATS"
log "    arms=[$ARMS]  baseline=$BASELINE  reuse_rows=$REUSE_ROWS"
log "    shared registry → $HOST_REG"
log "    harness_version (GIT_SHA) = $GIT_SHA"

# ---- server: up iff needed (stop iff started — see cleanup) -----------------
if [ "$(http "$OC_HEALTH")" = 200 ]; then
  log "==> oc-$TIER already green on :$OC_PORT — using as found (will not stop it)"
else
  log "==> starting oc-$TIER server on :$OC_PORT..."
  OPENCODE_TIER="$TIER" "$OC_SERVER" start || err "oc-$TIER server failed to reach green /health"
  # Set ONLY after a start THIS driver performed succeeded (#005 defect 2):
  # setting it before start meant a failed start (e.g. against another owner's
  # mid-load server reached via the shared per-tier pidfile) made the cleanup
  # trap stop a server this driver never started — violating stop-iff-I-
  # started-it. On any start failure STARTED_OC stays 0 and cleanup leaves
  # whatever is (or was coming) up on :$OC_PORT untouched.
  STARTED_OC=1
fi
[ "$(http "$OC_HEALTH")" = 200 ] || err "oc-$TIER not green at $OC_HEALTH"

# Per-sweep shared workspace H, emptied IN PLACE. We deliberately do NOT
# `rm -rf "$H" && mkdir` it: churning H's inode right before bind-mounting it can
# leave OrbStack's file-share with a stale handle, so /workspace shows up EMPTY
# or ABSENT in the sibling and every cell false-fails at workspace.reset() with a
# cryptic `mkdir '/workspace'` ENOENT (observed once under co-resident load). Keep
# the dir, drop only its contents; workspace.reset() clears per-cell anyway.
mkdir -p "$H"
find "$H" -mindepth 1 -exec rm -rf {} + 2>/dev/null || true
log "    shared workspace H = $H"

# ============================================================================
# Arm sub-phases: one per ARMS entry, all appending to the same registry
# ============================================================================
# Each arm runs in the path-matched BAKED runner image $RUNNER_IMAGE: node +
# git + docker CLI + compose are preinstalled at build time (Dockerfile.runner,
# #009) — no per-sweep apk add, no network dependency at phase start. It mounts
# the host socket + the repo at its own path + H at /workspace and runs the
# LIVE test sources (so lib/* is the working tree, not a baked copy — the
# runner image bakes toolchain only, never repo sources). The per-cell loop
# runs inline below. The sidecar-port arms (opencode-a+git / opencode-a+prompt)
# git-init the workspace per-cell inside runAgent.js, which is why `git` is
# baked into the runner image.
#
# RUN_REGISTRY_TESTS_DIR is the path-matched tests dir (the emit default
# /test/... only exists in the baked test image). RUN_REGISTRY_MODEL_CONFIG_ID
# is deliberately UNSET so the emit path auto-picks the (arm, tier) serving
# fingerprint via modelConfigIdFor(); an explicit value would defeat that.
ARMS_RC=0
for ARM in $ARMS; do
log ""
log "==> arm $ARM (oc llama-server :$OC_PORT; filter: $FILTER)"
set +e
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$H:/workspace" \
  -e CONFIG="$ARM" \
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
[ "$SUB_RC" -ne 0 ] && ARMS_RC=1
log "==> arm $ARM exit rc=$SUB_RC (cell failures are tolerated; rows still emitted)"
done
log ""
log "==> all arms done (arms rc=$ARMS_RC)"

# ============================================================================
# Gate — every row config_id-stamped, both sides of each pair bucketed
# ============================================================================
log ""
log "==> Gate: paired_bootstrap must bucket BOTH configs of every (arm, baseline) pair"
if [ ! -s "$HOST_REG" ]; then
  err "no registry rows at $HOST_REG — no arm emitted anything (check arm output above)"
fi

# Run the gate in the runner image (it has node), against the LIVE registry +
# libs via the path-matched mount. One gate run per non-baseline arm, with
# EXPLICIT --treatment/--baseline. A single-arm sweep where ARM == BASELINE
# degenerates to a row-discipline smoke (delta trivially 0) — still asserts
# every row carries an in-enum config_id.
GATE_RC=0
TREATMENTS=""
for ARM in $ARMS; do
  [ "$ARM" = "$BASELINE" ] || TREATMENTS="$TREATMENTS $ARM"
done
[ -n "$TREATMENTS" ] || TREATMENTS="$BASELINE"
set +e
for TREATMENT in $TREATMENTS; do
log "[gate] treatment=$TREATMENT vs baseline=$BASELINE"
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  --entrypoint node "$RUNNER_IMAGE" \
  scripts/config-ab-pairing-check.mjs "$HOST_REG" --tier "$TIER" --treatment "$TREATMENT" --baseline "$BASELINE"
SUB_RC=$?
[ "$SUB_RC" -ne 0 ] && GATE_RC=1
done
set -e

log ""
log "==> Done. registry: $HOST_REG   (arms rc=$ARMS_RC, gate rc=$GATE_RC)"
log "    verdicts: docker run --rm -v \"$REPO_DIR:$REPO_DIR\" -w \"$REPO_DIR/host/test\" --entrypoint node $RUNNER_IMAGE scripts/config-ab-verdict.mjs \"$HOST_REG\" --tier $TIER --treatment <arm> --baseline $BASELINE"
exit "$GATE_RC"
