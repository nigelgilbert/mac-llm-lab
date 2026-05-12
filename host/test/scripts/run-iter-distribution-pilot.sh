#!/usr/bin/env bash
# Pilot driver for the new iter-distribution candidates (per
# host/llama-server/docs/TIER-EVAL-SUITE-AUDIT.md and the implementation plan
# at ~/.claude/plans/you-re-a-senior-software-unified-eich.md).
#
# Difference from run-iter-distribution-sweep.sh:
#   - Pilots agent-single (audit K-rated, not yet in sweep) plus the four new
#     test candidates (Proposals 1, 3, 4, 5 — Proposal 2 skipped per plan).
#   - Default N=5 per (test, sampler) cell — 50 runs total, ~60-90 min wall.
#   - Writes a separate manifest at _pilot-manifest.json so it does not
#     clobber the production sweep manifest.
#   - On completion, builds the run table and prints per-cell pass-rates
#     filtered to the pilot test_ids so the promote/drop/redesign decision
#     (plan §P3.1) can be made off the printed summary.
#
# This script is safe to re-run; each invocation overwrites _pilot-manifest.json
# and _pilot.log but leaves prior run-id sidecars in place. To start clean,
# move .claw-runtime/<old-run-ids> aside before re-piloting.
#
# Usage:
#   host/test/scripts/run-iter-distribution-pilot.sh [N]
#     N — repetitions per (test, sampler) cell. Default 5.

set -eu

N="${1:-5}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEST_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
HOST_DIR=$(cd "$TEST_DIR/.." && pwd)
REPO_DIR=$(cd "$HOST_DIR/.." && pwd)

RUNTIME_DIR="$TEST_DIR/.claw-runtime"
MANIFEST="$RUNTIME_DIR/_pilot-manifest.json"
LOG="$RUNTIME_DIR/_pilot.log"

mkdir -p "$RUNTIME_DIR"

GIT_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HARDWARE_INSTANCE="${HARDWARE_INSTANCE:-M5}"

TESTS=(
  agent-single
  eight-functions
  subtle-broken-spec
  large-refactor
  api-evolution
)
SAMPLERS=(v1-prod v3-deterministic)

# Sampler defs — must match run-iter-distribution-sweep.sh exactly so pilot
# data is comparable to production-sweep data.
sampler_temperature() { case "$1" in v1-prod) echo 0.7 ;; v3-deterministic) echo 0.3 ;; esac; }
sampler_top_p()       { echo 0.8; }
sampler_top_k()       { echo 20; }
sampler_presence()    { echo 1.5; }
sampler_route()       { case "$1" in v1-prod) echo anthropic/claw-llama ;; v3-deterministic) echo anthropic/claw-llama-deterministic ;; esac; }

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

ROUTE_PRESENT=$(grep -c "claw-llama-deterministic" "$REPO_DIR/host/litellm/litellm-config.yaml" || true)
[ "$ROUTE_PRESENT" -gt 0 ] || err "litellm-config.yaml is missing the 'claw-llama-deterministic' route. Add it before piloting (see run-iter-distribution-sweep.sh header)."

# Source bridge env so docker compose can interpolate ${LITELLM_MASTER_KEY}.
set -a
# shellcheck disable=SC1090,SC1091
. "$REPO_DIR/host/litellm/.env"
set +a

# ---- generate randomized blocked schedule ----
SEED=$(printf '%s\n' "${GIT_SHA}:${DATE}:pilot" | shasum -a 256 | cut -c1-16)
log "PILOT seed=$SEED git_sha=$GIT_SHA n_per_cell=$N tests=${TESTS[*]}"

SCHEDULE=$(python3 - "$SEED" "$N" "${TESTS[*]}" "${SAMPLERS[*]}" <<'PY'
import hashlib, random, sys
seed = int(sys.argv[1], 16)
n = int(sys.argv[2])
tests = sys.argv[3].split()
samplers = sys.argv[4].split()
out = []
for test in tests:
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

# Write the pilot manifest up front so a partial run is still legible.
TESTS_JSON=$(printf '%s\n' "${TESTS[@]}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
python3 - "$MANIFEST" "$DATE" "$GIT_SHA" "$SEED" "$N" "$HARDWARE_INSTANCE" "$JOB_COUNT" "$TESTS_JSON" <<'PY'
import json, sys
manifest_path, date, git_sha, seed, n, hw, jobs, tests_json = sys.argv[1:]
data = {
    "schema_version": 1,
    "kind": "pilot",
    "started_at_utc": date,
    "git_sha": git_sha,
    "seed": seed,
    "n_per_cell": int(n),
    "tests": json.loads(tests_json),
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
log "pilot complete: elapsed=${ELAPSED_S}s"

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

# Build the run table (covers all .claw-runtime/<run-id>/ entries; pilot rows
# are identifiable by test_id ∈ TESTS).
python3 "$SCRIPT_DIR/analysis/build-run-table.py"

# ---- pilot summary: per-(test, sampler) pass-rate filtered to pilot tests ----
TESTS_CSV=$(IFS=,; echo "${TESTS[*]}")
python3 - "$RUNTIME_DIR/iter-distribution-runs.csv" "$TESTS_CSV" <<'PY'
import csv, sys
from collections import defaultdict
csv_path, tests_csv = sys.argv[1:]
pilot_tests = set(tests_csv.split(','))
cells = defaultdict(lambda: {"n": 0, "passed": 0})
with open(csv_path) as f:
    for row in csv.DictReader(f):
        if row.get("test_id") not in pilot_tests:
            continue
        key = (row["test_id"], row["sampler_id"])
        cells[key]["n"] += 1
        if row.get("passed", "").lower() == "true":
            cells[key]["passed"] += 1

print()
print("=== pilot pass-rates (filtered to pilot tests) ===")
print(f"{'test':<40} {'sampler':<20} {'n':>4} {'pass':>5} {'rate':>7}")
for (test, sampler), c in sorted(cells.items()):
    n, p = c["n"], c["passed"]
    rate = (p / n) if n else 0
    print(f"{test:<40} {sampler:<20} {n:>4} {p:>5} {rate*100:>6.1f}%")
print()
print("Decision rule (plan §P3.1):")
print("  - fail-rate >=15% (pass-rate <=85%) AND class signal matches → promote")
print("  - <15% fail (>85% pass) → too easy; redesign or drop")
print("  - signal-class mismatch → keep but tag actual class for taxonomy bookkeeping")
PY

log "wrote pilot manifest: $MANIFEST"
log "wrote run table: $RUNTIME_DIR/iter-distribution-runs.csv"
