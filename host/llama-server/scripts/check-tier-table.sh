#!/usr/bin/env bash
# ============================================================================
# check-tier-table.sh — #016 cross-consumer tier-identity assertion.
# ============================================================================
# For every tier in tiers.conf TIERS_ALL, resolves the tier identity through
# EVERY consumer and asserts they all agree with the table:
#
#   ref   tiers.conf tier_resolve                     (the reference)
#   srv   scripts/opencode-server status              (launcher; parsed output)
#   oc    client/opencode/bin/oc -t N status          (user CLI; parsed output)
#   drv   host/test/run-config-ab.sh                  (driver; PRINT_TIER_RESOLUTION=1)
#   w51   wizard/steps/51 step_51_resolve             (sourced + invoked)
#   w52   wizard/steps/52 step_52_config_ok           (rendered config dials table port)
#   js    lib/config.js parseTiersConf + FALLBACK_TIER_TABLE +
#         lib/opencode_server_timings.js defaultServerLogPath
#         (via the baked eval-runner image; FAIL-soft to WARN when the image
#          is absent — the suite's tier-table contract test covers it too)
#
# READ-ONLY: status subcommands + /health curls only; never starts, stops,
# installs or rotates anything. Safe against the live resident daemon.
#
# Exit: 0 all consumers agree; 1 any mismatch (each named on stderr).
# Run after ANY edit to tiers.conf / a consumer / lib/config.js FALLBACK.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAMA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$LLAMA_DIR/../.." && pwd)"
RUNNER_IMAGE="${RUNNER_IMAGE:-mac-llm-lab-eval-runner:local}"

FAILS=0
pass() { printf '  ok   %s\n' "$*"; }
failn() { printf '  FAIL %s\n' "$*" >&2; FAILS=$((FAILS + 1)); }
warn() { printf '  warn %s\n' "$*" >&2; }

# --- reference: the table itself ---------------------------------------------
# shellcheck source=../tiers.conf
source "$LLAMA_DIR/tiers.conf" || { echo "FATAL: cannot source tiers.conf" >&2; exit 1; }

echo "== tiers.conf reference (TIERS_ALL=$TIERS_ALL, default=$TIER_DEFAULT) =="
for t in $TIERS_ALL; do
  tier_resolve "$t" || { failn "ref: tier_resolve $t failed"; continue; }
  printf '  tier %-3s port=%s config=%s label=%s tag=[%s] log=%s\n' \
    "$t" "$TIER_PORT" "$TIER_OPENCODE_CONFIG" "$TIER_LAUNCHD_LABEL" "$TIER_LOG_TAG" "$TIER_LOG_PATH"
done

# --- 1. launcher: opencode-server status --------------------------------------
echo "== opencode-server (launcher) =="
for t in $TIERS_ALL; do
  tier_resolve "$t"
  out="$(OPENCODE_TIER="$t" "$LLAMA_DIR/scripts/opencode-server" status 2>&1)" \
    || { failn "srv tier $t: status rc=$?"; continue; }
  # port: always present in the "health :" line (.../127.0.0.1:PORT/health)
  port="$(printf '%s\n' "$out" | sed -n 's/.*127\.0\.0\.1:\([0-9]*\)\/health.*/\1/p' | head -1)"
  [ "$port" = "$TIER_PORT" ] && pass "srv tier $t port :$port" \
    || failn "srv tier $t port: got '$port', table says $TIER_PORT"
  # label: launchd line carries the label, or the on-demand-only wording
  if [ "$TIER_LAUNCHD_LABEL" = "-" ]; then
    printf '%s\n' "$out" | grep -q 'launchd: none (.*on-demand only' \
      && pass "srv tier $t launchd: none (on-demand only) — matches table '-'" \
      || failn "srv tier $t launchd: expected on-demand-only wording for table label '-'; got: $(printf '%s\n' "$out" | grep '^launchd')"
  else
    printf '%s\n' "$out" | grep -q "launchd: .*($TIER_LAUNCHD_LABEL)" \
      && pass "srv tier $t launchd label $TIER_LAUNCHD_LABEL" \
      || failn "srv tier $t launchd label: expected $TIER_LAUNCHD_LABEL; got: $(printf '%s\n' "$out" | grep '^launchd')"
  fi
done

# --- 2. user CLI: oc -t N status ----------------------------------------------
echo "== oc (user CLI) =="
for t in $TIERS_ALL; do
  tier_resolve "$t"
  out="$("$REPO_ROOT/client/opencode/bin/oc" -t "$t" status 2>&1)" \
    || { failn "oc tier $t: status rc=$?"; continue; }
  port="$(printf '%s\n' "$out" | sed -n 's/^tier *: .*(port :\([0-9]*\)).*/\1/p' | head -1)"
  cfg="$(printf '%s\n' "$out" | sed -n 's/^config *: //p' | head -1)"
  [ "$port" = "$TIER_PORT" ] && pass "oc  tier $t port :$port" \
    || failn "oc tier $t port: got '$port', table says $TIER_PORT"
  [ "$(basename "$cfg")" = "$TIER_OPENCODE_CONFIG" ] && pass "oc  tier $t config $(basename "$cfg")" \
    || failn "oc tier $t config: got '$cfg', table says $TIER_OPENCODE_CONFIG"
done

# --- 3. sweep driver: PRINT_TIER_RESOLUTION=1 ----------------------------------
echo "== run-config-ab.sh (sweep driver) =="
for t in $TIERS_ALL; do
  tier_resolve "$t"
  out="$(TIER="$t" PRINT_TIER_RESOLUTION=1 "$REPO_ROOT/host/test/run-config-ab.sh" 2>&1)" \
    || { failn "drv tier $t: rc=$?: $out"; continue; }
  want="TIER=$t OC_PORT=$TIER_PORT OC_CONFIG_JSON=./$TIER_OPENCODE_CONFIG OC_LOG_TAG=$TIER_LOG_TAG"
  [ "$out" = "$want" ] && pass "drv tier $t: $out" \
    || failn "drv tier $t: got '$out', want '$want'"
done

# --- 4. wizard steps 51/52 ------------------------------------------------------
echo "== wizard steps 51/52 =="
# step files only DEFINE functions at source time; mains are never called here.
# step_51_resolve/step_52_config_ok need REPO_ROOT (exported above pattern).
export REPO_ROOT
# fail/info shims: step helpers call them on error paths.
fail() { :; }
info() { :; }
# shellcheck source=../../../wizard/steps/51-opencode-server.sh
source "$REPO_ROOT/wizard/steps/51-opencode-server.sh"
# shellcheck source=../../../wizard/steps/52-opencode-client.sh
source "$REPO_ROOT/wizard/steps/52-opencode-client.sh"
for t in $TIERS_ALL; do
  tier_resolve "$t"
  want_port="$TIER_PORT" want_cfg="$TIER_OPENCODE_CONFIG" want_label="$TIER_LAUNCHD_LABEL"
  [ "$want_label" = "-" ] && want_label=""
  if step_51_resolve "$t"; then
    [ "$OC_PORT" = "$want_port" ] && [ "$OC_LABEL" = "$want_label" ] \
      && pass "w51 tier $t port :$OC_PORT label '${OC_LABEL:-<none>}'" \
      || failn "w51 tier $t: port=$OC_PORT label='$OC_LABEL', table says port=$want_port label='$want_label'"
  else
    failn "w51 tier $t: step_51_resolve rc=$?"
  fi
  # step_51_resolve re-sourced tiers.conf (same file) — re-resolve for clarity.
  tier_resolve "$t"
  if step_52_config_ok "$want_cfg" "$want_port"; then
    pass "w52 tier $t rendered $want_cfg dials :$want_port (autoupdate pinned)"
  else
    failn "w52 tier $t: rendered $want_cfg does NOT dial table port :$want_port (or autoupdate unpinned/missing)"
  fi
done
if ! step_51_resolve 99 2>/dev/null; then
  pass "w51 rejects unknown tier 99"
else
  failn "w51 accepted unknown tier 99"
fi

# --- 5. JS side: parsed conf == embedded fallback; log paths derive ------------
echo "== JS (lib/config.js + lib/opencode_server_timings.js) =="
if docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
  js_out="$(docker run --rm -v "$REPO_ROOT:$REPO_ROOT" -w "$REPO_ROOT/host/test" \
    --entrypoint node "$RUNNER_IMAGE" --input-type=module -e "
      import assert from 'node:assert/strict';
      import { loadTierTable, FALLBACK_TIER_TABLE } from './lib/config.js';
      import { defaultServerLogPath } from './lib/opencode_server_timings.js';
      const live = loadTierTable();
      assert.ok(live, 'tiers.conf unreadable through the repo mount');
      assert.deepEqual(live, FALLBACK_TIER_TABLE,
        'tiers.conf and lib/config.js FALLBACK_TIER_TABLE have DRIFTED');
      for (const [t, row] of Object.entries(live.tiers)) {
        assert.equal(defaultServerLogPath(t, {}), row.log_path,
          'defaultServerLogPath(' + t + ') does not derive from the table');
        console.log('JS tier ' + t + ' port=' + row.port + ' config=' + row.opencode_config +
          ' label=' + row.launchd_label + ' tag=[' + row.log_tag + '] log=' + row.log_path);
      }
      console.log('JS-AGREES');
    " 2>&1)"
  if printf '%s\n' "$js_out" | grep -q '^JS-AGREES$'; then
    printf '%s\n' "$js_out" | grep '^JS tier' | sed 's/^/  /'
    pass "js  parsed tiers.conf == FALLBACK_TIER_TABLE; defaultServerLogPath derives from it"
    # cross-check JS rows against the bash reference, field by field
    for t in $TIERS_ALL; do
      tier_resolve "$t"
      want="JS tier $t port=$TIER_PORT config=$TIER_OPENCODE_CONFIG label=$TIER_LAUNCHD_LABEL tag=[$TIER_LOG_TAG] log=$TIER_LOG_PATH"
      printf '%s\n' "$js_out" | grep -qF "$want" \
        && pass "js  tier $t row matches bash reference" \
        || failn "js tier $t row mismatch: wanted '$want'"
    done
  else
    failn "js side disagreement or error: $js_out"
  fi
else
  warn "runner image $RUNNER_IMAGE absent — JS cross-check skipped here (covered by the suite's tier-table contract test on conf-visible seats)"
fi

echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "TIER-TABLE CHECK: PASS — all consumers resolve identical tier identity from tiers.conf"
  exit 0
else
  echo "TIER-TABLE CHECK: FAIL — $FAILS mismatch(es) above" >&2
  exit 1
fi
