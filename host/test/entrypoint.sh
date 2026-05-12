#!/bin/sh
# Entry shim: write claw's alias table from the BACKEND env, then exec the
# real command.
#
# Why: claw has TWO model knobs — the main loop honors --model, but the
# built-in Agent subagent tool spawns with a hardcoded default
# (claude-opus-4-6, see ultraworkers/claw-code rust/crates/tools/src/lib.rs).
# In production those default IDs land on the bridge's `*` wildcard route,
# which is fine when memory permits. Under test they trip the
# 1-model-resident invariant.
#
# claw's USAGE.md documents an alias table at ~/.claw/settings.json that
# rewrites model names *before* request dispatch. We point every built-in
# alias and bare claude-* id at the same anthropic/claw-<backend> route the
# main loop is using, so all traffic exits via one bridge route.
#
# TEST_SUITE scoping: when TEST_SUITE is set, override $@ to run only that
# subdirectory so run-backend-ab.sh and run-model-ab.sh each fire their own
# tests. Unset (or "all") runs everything under __tests__/.
#
# TIER_EVAL_FILTER: when TEST_SUITE=tier-eval and this is a non-empty space-
# separated list of test_id stems (e.g. "wordy alphametics forth"), restrict
# the run to those files only. Used by Sprint 1.21 explore-cycle.sh for
# scoped pilot sweeps.

set -eu

case "${BACKEND:-llama-server}" in
  llama-server) target="anthropic/claw-llama"  ;;
  ollama)       target="anthropic/claw-ollama" ;;
  *) echo "entrypoint: unknown BACKEND=$BACKEND" >&2; exit 1 ;;
esac

mkdir -p /root/.claw
cat >/root/.claw/settings.json <<EOF
{
  "aliases": {
    "opus":   "$target",
    "sonnet": "$target",
    "haiku":  "$target",
    "claude-opus-4-6":            "$target",
    "claude-sonnet-4-6":          "$target",
    "claude-haiku-4-5-20251213":  "$target"
  }
}
EOF

# Scope to a test subdirectory when TEST_SUITE is set. The glob expands
# inside the container where the files exist. We collect the file list and
# then run each file under its own SIGKILL ceiling — see the comment block
# below the case statement.
files=""
case "${TEST_SUITE:-}" in
  backend-ab)   files="__tests__/backend-ab/*.test.js"  ;;
  model-ab)     files="__tests__/model-ab/*.test.js"    ;;
  settings-ab)  files="__tests__/settings-ab/*.test.js" ;;
  tier-eval)
    if [ -n "${TIER_EVAL_FILTER:-}" ]; then
      for stem in $TIER_EVAL_FILTER; do
        files="$files __tests__/tier-eval/${stem}.test.js"
      done
    else
      files="__tests__/tier-eval/*.test.js"
    fi
    ;;
  *) exec "$@" ;;
esac

# Per-test wallclock ceiling.
#
# Sprint 1.21 follow-up to a c21 sweep runaway: a single test cell
# (word-search v2.1) stayed alive for 76 minutes before its docker run
# returned, even though CLAW_TIMEOUT=285s and node:test had its own
# {timeout: CLAW_TIMEOUT + 20_000} guard. The failure mode is that
# node:test marks the test failed when its timer fires but does NOT
# reap the spawned claw child, so the test runner blocks on a Promise
# that never settles. The whole sweep stalls.
#
# This wrapper invokes one `node --test` per test file with GNU
# timeout(1) standing watch. SIGTERM at the cap, SIGKILL 15s later if
# the process refuses. A single stuck test can no longer sink the
# sweep — we lose only that cell, the loop continues.
#
# PER_TEST_TIMEOUT default 600s (10 min) is well above the 285s
# CLAW_TIMEOUT in lib/claw.js, so legitimate slow tests still finish
# normally. Override via env when sweeping a known-fast filter.
PER_TEST_TIMEOUT="${PER_TEST_TIMEOUT:-600}"
overall_rc=0
# shellcheck disable=SC2086
for testfile in $files; do
  echo ">>> running $testfile (per-test cap ${PER_TEST_TIMEOUT}s)"
  rc=0
  timeout --signal=TERM --kill-after=15s "${PER_TEST_TIMEOUT}s" \
    node --test --test-concurrency=1 \
      --test-reporter=spec --test-reporter-destination=stdout \
      --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout \
      "$testfile" \
    || rc=$?
  case "$rc" in
    0)        : ;;
    124|137)  echo ">>> TIMEOUT killed $testfile after ${PER_TEST_TIMEOUT}s (rc=$rc)"; overall_rc=1 ;;
    *)        echo ">>> $testfile failed with rc=$rc"; overall_rc=1 ;;
  esac
done
exit "$overall_rc"
