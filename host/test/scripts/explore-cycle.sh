#!/usr/bin/env bash
# Sprint 1.21 exploratory cycle driver.
#
# Wraps run-overnight-screen.sh with TIER_EVAL_FILTER scoped to the 12 new
# difficulty-pack tests (host/test/docs/difficulty-pack/PLAN.md). Designed for
# 2-cycle N=3 exploration before the deeper N=5 pilot — see
# difficulty-pack/1.21-handsolve-log.md for the per-test design intent.
#
# After the sweep, runs explore-summarize.mjs to produce a per-(test, tier)
# summary at host/test/docs/difficulty-pack/explore/c<N>/summary.md, plus
# one model-session snapshot per failing cell under .../snapshots/. The
# summary is what the analyze-agent reads to propose tweaks.
#
# Usage:
#   host/test/scripts/explore-cycle.sh <cycle-N> [tiers]
#
# Examples:
#   host/test/scripts/explore-cycle.sh 1            # cycle 1, t32 only (default)
#   host/test/scripts/explore-cycle.sh 2 "16 32"    # cycle 2, both tiers
#
# Env knobs:
#   EVAL_REPS    reps per tier (default: 3)
#   DRY_RUN      1 = print plan and exit (passes through to run-overnight-screen.sh)
#
# Hard preconditions (checked by run-overnight-screen.sh):
#   - bridge healthy at http://127.0.0.1:4000
#   - llama-server llama-server image present
#   - thermal-watch.sh running in a separate terminal (warned if missing)
#
# Soft conventions:
#   - Operator runs cycles serially: cycle 1 → review → cycle 2 → review →
#     deeper N=5 pilot.
#   - Author commit boundary AFTER each cycle's analysis-agent edits land.

set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <cycle-N> [tiers]" >&2
  exit 2
fi

CYCLE="$1"
TIERS="${2:-32}"

case "$CYCLE" in
  [1-9]|[1-9][0-9]) ;;
  *) echo "ERROR: cycle must be a positive integer (got: $CYCLE)" >&2; exit 2 ;;
esac

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEST_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
DOCS_DIR="$TEST_DIR/docs/difficulty-pack"
EXPLORE_DIR="$DOCS_DIR/explore/c${CYCLE}"

# Active difficulty-pack tests after Sprint 1.21 cycle 21. Four tests
# (alphametics, forth, semver-range, needle-haystack) live under
# __tests__/tier-eval/frontier/ and are not part of the screening filter:
# the first three as floor/frontier reserves, needle-haystack because the
# c21 N=3 sweep showed it surfaces t64 runtime instability (1 fast error,
# 1 21-min SSE deadlock, 1 missing-row) rather than model capability —
# tracked as a tooling probe in usability-pack/memos/. Order matches
# 1.21-handsolve-log.md table.
NEW_TESTS=(
  wordy book-store word-search two-bucket
  twelve-file-refactor ini-parser
)

# Honor a caller-supplied TIER_EVAL_FILTER (e.g. when re-sampling a subset or
# pulling in a frontier test from outside NEW_TESTS); otherwise default to the
# full active screening set.
EFFECTIVE_FILTER="${TIER_EVAL_FILTER:-${NEW_TESTS[*]}}"

DATESTAMP=$(date +%Y%m%d-%H%M)
SWEEP_LABEL="explore-c${CYCLE}-${DATESTAMP}"

mkdir -p "$EXPLORE_DIR/snapshots"

echo "==> Sprint 1.21 explore cycle ${CYCLE}"
echo "    tiers:        $TIERS"
echo "    reps:         ${EVAL_REPS:-3}"
echo "    sweep label:  $SWEEP_LABEL"
echo "    filter:       ${EFFECTIVE_FILTER}"
echo "    explore dir:  $EXPLORE_DIR"
echo ""

# Run the sweep. run-overnight-screen.sh reads TIER_EVAL_FILTER, EVAL_TIERS,
# EVAL_REPS, SWEEP_LABEL, RUN_REGISTRY_KIND, DRY_RUN from the environment.
TIER_EVAL_FILTER="$EFFECTIVE_FILTER" \
EVAL_TIERS="$TIERS" \
EVAL_REPS="${EVAL_REPS:-3}" \
SWEEP_LABEL="$SWEEP_LABEL" \
RUN_REGISTRY_KIND="pilot" \
DRY_RUN="${DRY_RUN:-0}" \
"$SCRIPT_DIR/run-overnight-screen.sh"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo ""
  echo "DRY_RUN=1 — skipping post-sweep summary."
  exit 0
fi

REGISTRY_JSONL="$TEST_DIR/.claw-runtime/run_registry.${SWEEP_LABEL}.jsonl"
REGISTRY_CSV="${REGISTRY_JSONL%.jsonl}.csv"

echo ""
echo "==> generating cycle-${CYCLE} summary"
docker run --rm \
  -v "$TEST_DIR:/test" \
  -w /test \
  node:24-bookworm-slim \
  node /test/scripts/explore-summarize.mjs \
    --registry "/test/.claw-runtime/$(basename "$REGISTRY_JSONL")" \
    --runtime-dir /test/.claw-runtime \
    --tests "$EFFECTIVE_FILTER" \
    --cycle "$CYCLE" \
    --out-dir "/test/docs/difficulty-pack/explore/c${CYCLE}" \
  || { echo "ERROR: explore-summarize.mjs failed" >&2; exit 1; }

echo ""
echo "==> cycle ${CYCLE} done"
echo "    registry:  $REGISTRY_JSONL"
echo "    csv:       $REGISTRY_CSV"
echo "    summary:   $EXPLORE_DIR/summary.md"
echo "    snapshots: $EXPLORE_DIR/snapshots/"
echo ""
echo "Next: spawn analyze-agent on $EXPLORE_DIR/summary.md"
