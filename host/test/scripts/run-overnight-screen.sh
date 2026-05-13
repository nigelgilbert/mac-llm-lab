#!/usr/bin/env bash
# Sprint 1 overnight cross-tier screen driver.
#
# Wraps run-tier-eval.sh's plist-swap pattern with N reps per tier and the
# registry-row auto-emit hook (RUN_REGISTRY_EMIT=1). All rows land in a
# sweep-specific JSONL under host/test/.claw-runtime/ so the canonical
# registry stays clean if the run aborts mid-night.
#
# Hardware: single M5 Max MBP, serial — three-machine parallel is not
# available for the foreseeable future (TIER-EVAL-V2-SPRINT-PLAN.md §2).
# Tier 16/32/64 are realized by switching the llama-server plist between
# blocks, NOT by separate machines. Latency rows are therefore
# single-hardware-config latency, not final product-tier latency.
#
# Order: rep-outer × tier-middle × test-inner (via the existing
# `node --test __tests__/tier-eval/*.test.js` runner). True
# tier × test × seed interleave (one plist swap per cell) would add
# ~5 hours of swap overhead on a 600-cell night and is not used here.
# For SCREENING purposes (no admission decisions) the cheaper rep-outer
# pattern is acceptable — see plan §4 "Allowed conclusions."
#
# Pre-flight (operator):
#   1. Confirm the bridge is up and the model GGUFs for all requested
#      tiers are on disk (this script's preflight checks them).
#   2. Confirm the working tree is at the SHA you want recorded as
#      harness_version — no rebuilds mid-sweep.
#
# Usage:
#   host/test/scripts/run-overnight-screen.sh
#   EVAL_TIERS="16 32" EVAL_REPS=8 host/test/scripts/run-overnight-screen.sh
#
# Env knobs:
#   EVAL_TIERS                   space-separated tiers (default: "16 32 64")
#   EVAL_REPS                    full-suite passes per tier (default: 10)
#   SWEEP_LABEL                  subdir suffix under .claw-runtime/ (default: a timestamp)
#   DRY_RUN                      1 = print plan + tier installs but do not run claw
#   AUTO_REBUILD                 1 (default) = rebuild mac-llm-lab-test:local if any
#                                input under host/test/{Dockerfile,package.json,lib,
#                                __tests__,entrypoint.sh} is newer than the image.
#                                0 = refuse with rebuild instructions instead.
#   SKIP_IMAGE_FRESHNESS_CHECK   1 = bypass the freshness check entirely (use with care).

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEST_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(cd "$TEST_DIR/../.." && pwd)
INSTALL="$REPO_DIR/host/llama-server/scripts/install"
LABEL="com.mac-llm-lab.llama-server"

COMPOSE="$TEST_DIR/docker-compose.yml"
LLAMA_HEALTH="http://127.0.0.1:11435/health"
BRIDGE_HEALTH="http://127.0.0.1:4000/health/liveliness"

EVAL_TIERS="${EVAL_TIERS:-16 32 64}"
EVAL_REPS="${EVAL_REPS:-10}"
SWEEP_LABEL="${SWEEP_LABEL:-overnight-$(date +%Y%m%d-%H%M)}"
DRY_RUN="${DRY_RUN:-0}"

REGISTRY_PATH="$TEST_DIR/.claw-runtime/run_registry.${SWEEP_LABEL}.jsonl"
EXPECTED_PATH="$TEST_DIR/.claw-runtime/expected_attempts.${SWEEP_LABEL}.csv"
RESULTS_FILE="$TEST_DIR/logs/OVERNIGHT-SCREEN-${SWEEP_LABEL}.md"
mkdir -p "$TEST_DIR/logs" "$TEST_DIR/.claw-runtime"

GIT_SHA="$(cd "$REPO_DIR" && git rev-parse --short HEAD)"

# Tier → model_config_id mapping. Must match an entry in lib/model_configs.json.
# Defaults track the current production models.conf lock-in (Sprint 1.19, 2026-05-01).
tier_config_id() {
  case "$1" in
    16) echo "${T16_CANDIDATE_CONFIG_ID:-qwen35-9b-iq4xs-ctx64k-v6antiloop-pp01}" ;;
    32) echo "${T32_CANDIDATE_CONFIG_ID:-qwen35-9b-q5kxl-ctx64k-v7noreppen-pp01}" ;;
    64) echo "qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01" ;;
    *) echo ""; return 1 ;;
  esac
}

log() { printf '%s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---- preflight ----
command -v docker >/dev/null 2>&1 || err "missing: docker"
[ -x "$INSTALL" ] || err "missing or non-executable install script: $INSTALL"
docker image inspect mac-llm-lab-test:local >/dev/null 2>&1 \
  || err "missing image mac-llm-lab-test:local — build it: (cd $TEST_DIR && docker compose build)"
curl -fsS "$BRIDGE_HEALTH" >/dev/null 2>&1 \
  || err "bridge unreachable at $BRIDGE_HEALTH — start it: (cd $REPO_DIR/host/litellm && docker compose up -d)"

# ---- image freshness check (Sprint 1.21 cycle-4 postmortem) ----
# Test code is COPYed into mac-llm-lab-test:local at build time, NOT mounted.
# c4 ran with a pre-corrective-work image because the operator (me) forgot to
# rebuild after editing tests; result: cascade-eight checksum gate + two-bucket
# revert silently did not run. RUN_REGISTRY_HARNESS_VERSION on rows is the
# host's git rev, not the image's, so the misalignment is invisible until
# forensics. Refuse (or auto-rebuild) when any input baked into the Dockerfile
# (Dockerfile, package.json, lib/, __tests__/, entrypoint.sh) is newer than
# the last successful build through this script.
#
# Implementation: a marker file (.image-fresh-marker) is `touch`ed after every
# successful rebuild. We compare input mtimes against the marker, not against
# the image's docker-reported `.Created`, because BuildKit is content-hash
# cached: a `touch` of a file with unchanged bytes produces a no-op rebuild
# and the image's `Created` timestamp does NOT advance. The marker sidesteps
# that. If the marker is missing (first run, or operator built manually
# outside this script), we rebuild conservatively — cheap when cache is warm.
#
# Caveat: this does NOT cover the claw-code:local upstream — if you rebuilt
# claw, also rebuild this image manually (the marker won't notice). Quick
# forcing knob: `touch host/test/Dockerfile` bumps a watched mtime and the
# next sweep will rebuild. The smoke signal that you forgot is rows with an
# unchanged RUN_REGISTRY_HARNESS_VERSION but visibly different claw behavior.
FRESHNESS_MARKER="$TEST_DIR/.claw-runtime/.image-fresh-marker"
stat_mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }

if [ "${SKIP_IMAGE_FRESHNESS_CHECK:-0}" = "1" ]; then
  log "[freshness] SKIP_IMAGE_FRESHNESS_CHECK=1 — skipping (operator override)"
else
  newest_epoch=0
  newest_path=""
  while IFS= read -r f; do
    m=$(stat_mtime "$f") || continue
    [ -z "$m" ] && continue
    if [ "$m" -gt "$newest_epoch" ]; then
      newest_epoch=$m
      newest_path=$f
    fi
  done < <(find \
      "$TEST_DIR/Dockerfile" \
      "$TEST_DIR/package.json" \
      "$TEST_DIR/lib" \
      "$TEST_DIR/__tests__" \
      "$TEST_DIR/entrypoint.sh" \
      -type f 2>/dev/null)

  marker_epoch=0
  marker_reason="absent"
  if [ -f "$FRESHNESS_MARKER" ]; then
    marker_epoch=$(stat_mtime "$FRESHNESS_MARKER")
    marker_reason="last build"
  fi

  if [ "$newest_epoch" -gt "$marker_epoch" ]; then
    marker_human=$(date -r "$marker_epoch" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo "never")
    newer_human=$(date -r "$newest_epoch" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || echo "$newest_epoch")
    log ""
    log "[freshness] mac-llm-lab-test:local marker is STALE ($marker_reason)"
    log "[freshness]   marker mtime:   $marker_human"
    log "[freshness]   newer on disk:  $newer_human  $newest_path"
    if [ "${AUTO_REBUILD:-1}" = "1" ]; then
      log "[freshness] AUTO_REBUILD=1 (default) — running 'docker compose build test' now"
      log "[freshness]   to refuse instead of auto-rebuilding, set AUTO_REBUILD=0"
      log ""
      ( cd "$TEST_DIR" && docker compose build test ) \
        || err "auto-rebuild failed — run manually: (cd $TEST_DIR && docker compose build test)"
      touch "$FRESHNESS_MARKER"
      log ""
      log "[freshness] rebuild complete; marker bumped; continuing sweep"
    else
      err "image marker stale and AUTO_REBUILD=0 — rebuild manually: (cd $TEST_DIR && docker compose build test && touch $FRESHNESS_MARKER) [or set SKIP_IMAGE_FRESHNESS_CHECK=1 to ignore]"
    fi
  fi
fi

# Verify each tier has its GGUF and a manifest entry.
# shellcheck source=../../llama-server/models.conf
source "$REPO_DIR/host/llama-server/models.conf"
for t in $EVAL_TIERS; do
  case "$t" in 16|32|64) ;; *) err "invalid tier: $t (expected 16, 32, or 64)" ;; esac
  gguf_var="TIER_${t}_GGUF"
  gguf_path="${!gguf_var}"
  [ -f "$gguf_path" ] || err "tier ${t}GB: GGUF not found at $gguf_path"
  cfg_id="$(tier_config_id "$t")"
  [ -n "$cfg_id" ] || err "tier ${t}GB: no model_config_id mapping"
  grep -q "\"$cfg_id\"" "$TEST_DIR/lib/model_configs.json" \
    || err "tier ${t}GB: model_config_id '$cfg_id' missing from lib/model_configs.json"
done

# ---- cleanup: always restore production (64GB) plist on exit ----
# Skipped under DRY_RUN — we never touched the plist, so don't re-bootstrap.
cleanup() {
  if [ "$DRY_RUN" = "1" ]; then return 0; fi
  log ""
  log "[cleanup] restoring tier-64 (production) plist..."
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  sleep 1
  LLAMA_TIER=64 "$INSTALL" >/dev/null 2>&1 || log "[cleanup] WARN: tier-64 reinstall failed; check $INSTALL manually"
}
trap cleanup EXIT INT TERM

wait_llama() {
  label="$1"
  i=0
  log "[$label] waiting for llama-server..."
  while [ "$i" -lt 60 ]; do
    if curl -fsS "$LLAMA_HEALTH" >/dev/null 2>&1; then
      log "[$label] healthy after $((i * 2))s"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  err "[$label] llama-server did not become healthy within 120s"
}

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — printing plan and exiting before any plist swap or claw call."
  log "  Tiers:    $EVAL_TIERS"
  log "  Reps:     $EVAL_REPS"
  log "  Sweep:    $SWEEP_LABEL"
  log "  Reg:      $REGISTRY_PATH (would be created on real run)"
  log "  Expected: $EXPECTED_PATH (would be created on real run)"
  log "  Log:      $RESULTS_FILE  (would be created on real run)"
  for t in $EVAL_TIERS; do
    log "    tier-${t} → $(tier_config_id "$t")"
  done
  exit 0
fi

# ---- write expected-attempts manifest (Sprint 1.14) ----
log ""
log "==> writing expected-attempts manifest..."
EXPECTED_ARGS=(plan
  --tests-dir /test/__tests__/tier-eval
  --tiers "$EVAL_TIERS"
  --reps "$EVAL_REPS"
  --out "/test/.claw-runtime/$(basename "$EXPECTED_PATH")"
)
if [ -n "${TIER_EVAL_FILTER:-}" ]; then
  EXPECTED_ARGS+=(--filter "${TIER_EVAL_FILTER}")
fi
docker run --rm \
  -v "$TEST_DIR:/test" \
  -w /test \
  node:24-bookworm-slim \
  node /test/scripts/expected-attempts.mjs "${EXPECTED_ARGS[@]}" \
  || err "failed to write expected-attempts manifest"

# ---- header ----
{
  echo "# Overnight Cross-Tier Screen — $SWEEP_LABEL"
  echo ""
  echo "- Date: $(date '+%Y-%m-%d %H:%M')"
  echo "- Tiers: $EVAL_TIERS"
  echo "- Reps per tier: $EVAL_REPS"
  echo "- Harness git SHA: $GIT_SHA"
  echo "- Registry: $REGISTRY_PATH"
  echo "- Order: rep-outer × tier-middle × test-inner (cheap interleave)"
  echo ""
} > "$RESULTS_FILE"

# ---- main loop ----
run_one_pass() {
  rep="$1"
  tier="$2"
  cfg_id="$(tier_config_id "$tier")"
  log ""
  log "==> rep=${rep}/${EVAL_REPS} tier=${tier} cfg=${cfg_id}"

  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    j=0
    while [ "$j" -lt 30 ] && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; do
      j=$((j + 1)); sleep 1
    done
  fi

  log "[tier-${tier}] installing plist..."
  if [ -n "${INSTALL_OVERRIDE:-}" ]; then
    log "[tier-${tier}] using INSTALL_OVERRIDE=$INSTALL_OVERRIDE"
    eval "$INSTALL_OVERRIDE"
  else
    LLAMA_TIER="$tier" "$INSTALL"
  fi
  wait_llama "tier-${tier}"

  {
    echo "## rep=${rep} tier=${tier}"
    echo ""
    echo '```'
  } >> "$RESULTS_FILE"

  rc=0
  set -o pipefail
  docker compose --env-file "$REPO_DIR/host/litellm/.env" -f "$COMPOSE" \
    run --rm \
    -e BACKEND=llama-server \
    -e TIER="$tier" \
    -e TEST_SUITE=tier-eval \
    -e TIER_EVAL_FILTER="${TIER_EVAL_FILTER:-}" \
    -e RUN_REGISTRY_EMIT=1 \
    -e RUN_REGISTRY_KIND="${RUN_REGISTRY_KIND:-overnight_screen}" \
    -e RUN_REGISTRY_HARDWARE_TIER="$tier" \
    -e RUN_REGISTRY_MEMORY_GB="$tier" \
    -e RUN_REGISTRY_MODEL_CONFIG_ID="$cfg_id" \
    -e RUN_REGISTRY_HARNESS_VERSION="$GIT_SHA" \
    -e RUN_REGISTRY_CANONICAL_STATUS="canonical" \
    -e RUN_REGISTRY_PATH="/workspace/.claw-runtime/$(basename "$REGISTRY_PATH")" \
    test 2>&1 | tee -a "$RESULTS_FILE" || rc=$?
  set +o pipefail

  {
    echo '```'
    echo ""
    echo "Exit code: ${rc} (rep=${rep} tier=${tier})"
    echo ""
  } >> "$RESULTS_FILE"

  log "[tier-${tier}] rep=${rep} done (exit=${rc})"
}

for rep in $(seq 1 "$EVAL_REPS"); do
  for tier in $EVAL_TIERS; do
    run_one_pass "$rep" "$tier"
  done
done

# ---- post-sweep CSV view ----
# Run via the test image — `node` is not installed on the host.
log ""
log "==> sweep complete; exporting CSV view"
CSV_OUT="${REGISTRY_PATH%.jsonl}.csv"
docker run --rm \
  -v "$TEST_DIR:/test" \
  -w /test \
  node:24-bookworm-slim \
  node /test/scripts/registry-to-csv.mjs \
    --registry "/test/.claw-runtime/$(basename "$REGISTRY_PATH")" \
    --out      "/test/.claw-runtime/$(basename "$CSV_OUT")" \
  || log "WARN: registry-to-csv.mjs failed; jsonl is still authoritative"

ROW_COUNT=$(wc -l < "$REGISTRY_PATH" 2>/dev/null || echo 0)

# ---- post-sweep observed-vs-expected diff (Sprint 1.14) ----
log ""
log "==> diffing observed JSONL vs expected manifest..."
DIFF_OUT="$TEST_DIR/.claw-runtime/expected_attempts.${SWEEP_LABEL}.diff.txt"
# pipefail so `tee` doesn't mask the diff's non-zero exit and the WARN actually
# fires when observed diverges from expected.
set -o pipefail
docker run --rm \
  -v "$TEST_DIR:/test" \
  -w /test \
  node:24-bookworm-slim \
  node /test/scripts/expected-attempts.mjs diff \
    --expected "/test/.claw-runtime/$(basename "$EXPECTED_PATH")" \
    --registry "/test/.claw-runtime/$(basename "$REGISTRY_PATH")" \
  | tee "$DIFF_OUT" \
  || log "WARN: observed diverged from expected; see $DIFF_OUT"
set +o pipefail

log ""
log "==> done"
log "    sweep label:  $SWEEP_LABEL"
log "    registry:     $REGISTRY_PATH ($ROW_COUNT rows)"
log "    csv view:     ${REGISTRY_PATH%.jsonl}.csv"
log "    expected:     $EXPECTED_PATH"
log "    diff:         $DIFF_OUT"
log "    log:          $RESULTS_FILE"
