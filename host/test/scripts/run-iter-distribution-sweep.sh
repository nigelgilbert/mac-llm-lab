#!/usr/bin/env bash
# W2+W3 combined sweep for the iteration-distribution characterization
# (TODO-ITERATION-DISTRIBUTION-TEST.md).
#
# Design (per round-2 v2 plan):
#   - 3 failure-prone tier-64 tests: adversarial-input, deep-equal,
#     expression-eval (csv-parser & lru-cache dropped after the n=20 sweep
#     produced 0/40 failures each — non-error-prone tests carry no
#     failed-tail signal at this difficulty / sampler regime)
#   - 2 sampler arms: v1-prod (temp=0.7, presence_penalty=1.5) and
#     v3-deterministic (temp=0.3, presence_penalty=1.5)
#   - n=20 per (test, sampler) cell → 120 runs total
#   - Sequential execution (wallclock is the response variable; concurrency
#     would confound)
#   - Randomized blocked design within each test, seeded for reproduction
#
# Sampler arm switching:
#   v1-prod is the current production sampler; the llama-server is already
#   running with these settings. v3-deterministic requires a per-request
#   sampler override. llama.cpp's /v1/chat/completions accepts `temperature`
#   and `top_p` in the request body, but the request flows through claw,
#   which doesn't expose a CLI flag for sampler params. Two fallback paths
#   below are both pragmatic but neither is perfect:
#
#     (a) Bridge-side sampler override: LiteLLM model_list entries can pin
#         per-call params via `extra_body`. We add a `claw-llama-deterministic`
#         alias to litellm-config.yaml that injects temp=0.3 — tier-64-loaded
#         claw routes to it when the sampler arm is v3-deterministic.
#
#     (b) llama-server reload with a new --temp flag between cells. Doable
#         but adds ~30s per arm switch × 6 cells × the inner loop, plus
#         introduces a potential new variance source (model state reset).
#
#   This script chooses (a). The sampler-override route alias is a one-time
#   additive edit to litellm-config.yaml and is reverted at the end of the
#   sweep.
#
# Output:
#   host/test/.claw-runtime/<run-id>/{iterations.jsonl,run_summary.json}
#   host/test/.claw-runtime/_sweep-manifest.json (sweep-level provenance)
#
# Usage:
#   host/test/scripts/run-iter-distribution-sweep.sh [N]
#     N — repetitions per (test, sampler) cell. Default 20.
#
# Estimated wallclock at n=20: ~2-2.5h on M5. adversarial-input and deep-equal
# typical wallclock 30-90s; expression-eval typical wallclock 100-150s; n=20×3×2
# = 120 runs.

set -eu

N="${1:-20}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEST_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
HOST_DIR=$(cd "$TEST_DIR/.." && pwd)
REPO_DIR=$(cd "$HOST_DIR/.." && pwd)

RUNTIME_DIR="$TEST_DIR/.claw-runtime"
MANIFEST="$RUNTIME_DIR/_sweep-manifest.json"
LOG="$RUNTIME_DIR/_sweep.log"

mkdir -p "$RUNTIME_DIR"

GIT_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HARDWARE_INSTANCE="${HARDWARE_INSTANCE:-M5}"

TESTS=(adversarial-input deep-equal expression-eval)
SAMPLERS=(v1-prod v3-deterministic)

# Sampler defs (frozen — must match the v2 plan).
sampler_temperature() { case "$1" in v1-prod) echo 0.7 ;; v3-deterministic) echo 0.3 ;; esac; }
sampler_top_p()        { echo 0.8; }
sampler_top_k()        { echo 20; }
sampler_presence()     { echo 1.5; }
sampler_route()        { case "$1" in v1-prod) echo anthropic/claw-llama ;; v3-deterministic) echo anthropic/claw-llama-deterministic ;; esac; }

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }

err() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---- preflight ----
command -v docker >/dev/null 2>&1 || err "missing: docker"
docker image inspect mac-llm-lab-test:local >/dev/null 2>&1 \
  || err "missing image mac-llm-lab-test:local — build it: (cd $TEST_DIR && docker compose build)"
curl -fsS http://127.0.0.1:11435/health >/dev/null 2>&1 \
  || err "llama-server unreachable at port 11435"
curl -fsS http://127.0.0.1:4000/health/liveliness >/dev/null 2>&1 \
  || err "bridge unreachable at port 4000"

# Warn if the deterministic sampler route is missing — the cell will silently
# fall back to v1-prod sampling without it.
ROUTE_PRESENT=$(grep -c "claw-llama-deterministic" "$REPO_DIR/host/litellm/litellm-config.yaml" || true)
[ "$ROUTE_PRESENT" -gt 0 ] || err "litellm-config.yaml is missing the 'claw-llama-deterministic' route. Add it before sweeping (see this script's header)."

# Source bridge env so docker compose can interpolate ${LITELLM_MASTER_KEY}.
set -a
# shellcheck disable=SC1090,SC1091
. "$REPO_DIR/host/litellm/.env"
set +a

# ---- generate randomized blocked schedule ----
SEED=$(printf '%s\n' "${GIT_SHA}:${DATE}" | shasum -a 256 | cut -c1-16)
log "seed=$SEED git_sha=$GIT_SHA n_per_cell=$N"

# Build (test, sampler, repeat) tuples and shuffle each test's tuples
# independently with seeded shuffle.
SCHEDULE=$(python3 - "$SEED" "$N" "${TESTS[*]}" "${SAMPLERS[*]}" <<'PY'
import hashlib, random, sys
seed = int(sys.argv[1], 16)
n = int(sys.argv[2])
tests = sys.argv[3].split()
samplers = sys.argv[4].split()
out = []
for i, test in enumerate(tests):
    test_seed = seed ^ int(hashlib.sha256(test.encode()).hexdigest()[:16], 16)
    rng = random.Random(test_seed)
    block = []
    for sampler in samplers:
        for rep in range(n):
            block.append((test, sampler, rep + 1))
    rng.shuffle(block)
    out.extend(block)
for test, sampler, rep in out:
    print(f"{test}\t{sampler}\t{rep}")
PY
)

JOB_COUNT=$(printf '%s\n' "$SCHEDULE" | wc -l | tr -d ' ')
log "schedule_jobs=$JOB_COUNT"

# Write manifest up front so a partial sweep is still legible.
python3 - "$MANIFEST" "$DATE" "$GIT_SHA" "$SEED" "$N" "$HARDWARE_INSTANCE" "$JOB_COUNT" <<'PY'
import json, sys
manifest_path, date, git_sha, seed, n, hw, jobs = sys.argv[1:]
data = {
    "schema_version": 1,
    "started_at_utc": date,
    "git_sha": git_sha,
    "seed": seed,
    "n_per_cell": int(n),
    "tests": ["adversarial-input", "deep-equal", "expression-eval"],
    "samplers": ["v1-prod", "v3-deterministic"],
    "hardware_instance": hw,
    "concurrency": 1,
    "ctx": 65536,
    "scheduled_jobs": int(jobs),
}
with open(manifest_path, "w") as f:
    json.dump(data, f, indent=2)
PY

# ---- run loop ----
JOB_INDEX=0
START_MS=$(date +%s)
printf '%s\n' "$SCHEDULE" | while IFS=$'\t' read -r TEST SAMPLER REP; do
  JOB_INDEX=$((JOB_INDEX + 1))
  ROUTE=$(sampler_route "$SAMPLER")
  TEMP=$(sampler_temperature "$SAMPLER")
  log "[$JOB_INDEX/$JOB_COUNT] test=$TEST sampler=$SAMPLER rep=$REP route=$ROUTE temp=$TEMP"

  # Detach stdin: without `< /dev/null`, `docker compose run` attaches to the
  # loop's stdin (the schedule pipe) and the read loop terminates after the
  # first iteration. Inline -e VAR=VALUE form (rather than -e VAR
  # passthrough) so vars are visible inside the container regardless of how
  # the parent shell exported them.
  docker compose -f "$TEST_DIR/docker-compose.yml" run --rm \
    -e "ITER_DIST_TEST_ID=$TEST" \
    -e "ITER_DIST_SAMPLER_ID=$SAMPLER" \
    -e "CLAW_MODEL_OVERRIDE=$ROUTE" \
    -e "SAMPLER_TEMPERATURE=$TEMP" \
    -e "SAMPLER_TOP_P=$(sampler_top_p)" \
    -e "SAMPLER_TOP_K=$(sampler_top_k)" \
    -e "SAMPLER_PRESENCE_PENALTY=$(sampler_presence)" \
    -e "CTX=65536" \
    -e "GIT_SHA=$GIT_SHA" \
    -e "HARDWARE_INSTANCE=$HARDWARE_INSTANCE" \
    test node --test --test-concurrency=1 \
      --test-reporter=spec --test-reporter-destination=stdout \
      --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout \
      "__tests__/tier-eval/${TEST}.test.js" \
    </dev/null >>"$LOG" 2>&1 || log "  (test failed or timed out — telemetry sidecar should still be present)"
done

END_MS=$(date +%s)
ELAPSED_S=$((END_MS - START_MS))
log "sweep complete: elapsed=${ELAPSED_S}s"

# Append manifest closing.
python3 - "$MANIFEST" "$ELAPSED_S" <<'PY'
import json, sys
manifest_path, elapsed_s = sys.argv[1:]
with open(manifest_path) as f:
    data = json.load(f)
data["finished_at_utc"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
data["elapsed_s"] = int(elapsed_s)
with open(manifest_path, "w") as f:
    json.dump(data, f, indent=2)
PY

# Build the run table.
python3 "$SCRIPT_DIR/analysis/build-run-table.py"

log "wrote sweep manifest: $MANIFEST"
log "wrote run table: $RUNTIME_DIR/iter-distribution-runs.csv"
