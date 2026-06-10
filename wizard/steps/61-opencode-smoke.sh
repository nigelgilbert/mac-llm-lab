#!/usr/bin/env bash
# 61-opencode-smoke.sh — end-to-end smoke for the NEW coding stack (#007),
# alongside the legacy claw/bridge smoke (60) until #008 retires it. Two
# assertions, both through the installed wrapper:
#
#   1. `oc probe` — the #001 deterministic injection oracle (wire capture:
#      an in-container mock records the /v1/chat/completions body, which
#      must contain "Instructions from: /root/.config/opencode/AGENTS.md").
#      Model-independent; needs no llama-server. A fresh install must not
#      ship a null prompt — injection failure is silent in OpenCode.
#   2. `oc run` — a real trivial task against the tier server (full-local:
#      the resident daemon; client-only: the LAN host via the rendered
#      remote config + OC_SERVER_HOST), asserting the artifact lands in the
#      mounted workspace with the expected token.
#
# client-only with no reachable LAN host: explicit SKIP with a reason
# (rc=0) — the install is complete, only the live verification is deferred.
#
# Like step 60 this is a probe, not provisioning: it re-runs on every
# install (its only writes are a /tmp scratch workspace, removed on pass,
# kept on fail for debugging). It never restarts a green server — `oc`
# itself waits for / never bootouts the resident daemon (#003 contract).

step_61_oc() { printf '%s' "${HOME}/.local/bin/oc"; }

step_61_main() {
  hdr "OpenCode smoke (injection probe + oc run)"
  local oc topo tier ohost="" oport
  oc=$(step_61_oc)
  topo=$(state_get TOPOLOGY 2>/dev/null || printf 'full-local')
  tier=$(state_get OPENCODE_TIER 2>/dev/null || printf '64')

  if [ ! -x "$oc" ]; then
    fail "oc not installed at ${oc} (step 54)"
    return 1
  fi

  if [ "$topo" = "client-only" ]; then
    ohost=$(state_get OPENCODE_HOST 2>/dev/null || printf 'mac-llm-lab.local')
    oport=$(state_get OPENCODE_PORT 2>/dev/null || printf '11436')
    if ! curl -fsS --max-time 4 "http://${ohost}:${oport}/health" >/dev/null 2>&1; then
      warn "SKIPPED: LAN opencode server not reachable at http://${ohost}:${oport}/health"
      info "client install is complete; bring the serving Mac's tier daemon up"
      info "and re-run './wizard/wizard install' to smoke against it"
      return 0
    fi
    info "client-only: smoking against LAN host ${ohost}:${oport}"
  fi

  # --- 1. injection assertion (deterministic, no model needed) --------------
  act "oc probe — asserting the global prompt reaches the agent system prompt"
  if "$oc" probe; then
    ok "injection PASS (wire capture saw the AGENTS.md attribution line)"
  else
    fail "injection probe FAILED — a fresh install must not ship a null prompt"
    info "debug: ls -l ~/.config/opencode/AGENTS.md ; ${oc} status"
    return 1
  fi

  # --- 2. real artifact through the tier server ------------------------------
  local ws token rc=0
  ws=$(mktemp -d /tmp/wizard-oc-smoke.XXXXXX) || { fail "mktemp failed"; return 1; }
  # git-root the scratch workspace (OpenCode snapshots/undo want git); a bare
  # dir would still inject + run (#001 bonus finding), so failure here is fine.
  command -v git >/dev/null 2>&1 && git -C "$ws" init -q >/dev/null 2>&1
  token="WIZARD-OC-SMOKE-$$"
  if [ "$topo" = "client-only" ]; then
    # Remote config dials the LAN host from inside the container; tier 64 is
    # the resident-daemon port family the remote render targets (:11436).
    act "oc run against ${ohost}:${oport} — create smoke.txt in ${ws}"
    ( cd "$ws" && OC_SERVER_HOST="$ohost" OPENCODE_TIER=64 \
        OPENCODE_CONFIG_JSON="${REPO_ROOT}/client/opencode/opencode.remote.json" \
        "$oc" run "create a file named smoke.txt containing exactly ${token}" ) || rc=$?
  else
    act "oc run (tier ${tier}) — create smoke.txt in ${ws}"
    ( cd "$ws" && OPENCODE_TIER="$tier" \
        "$oc" run "create a file named smoke.txt containing exactly ${token}" ) || rc=$?
  fi
  if [ "$rc" -eq 0 ] && [ -f "$ws/smoke.txt" ] && grep -q "$token" "$ws/smoke.txt"; then
    ok "oc run artifact verified — smoke.txt contains ${token}"
    rm -rf "$ws"
    return 0
  fi
  fail "oc run smoke failed (rc=${rc}; workspace kept for debugging: ${ws})"
  info "debug: ${oc} status   and './wizard/wizard doctor'"
  return 1
}
