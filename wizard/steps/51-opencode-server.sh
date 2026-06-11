#!/usr/bin/env bash
# 51-opencode-server.sh — full-local only. Provision the OpenCode serving
# layer (migration decision §2.5 / issue #002 / wizard issue #006): the
# login-persistent launchd resident llama-server for the chosen tier, via
#     OPENCODE_TIER=<tier> host/llama-server/scripts/opencode-server install
# which renders the tier's plist from models.conf (corrected template,
# thinking-off kwarg, tier sampler, native tools grammar — no GBNF) and
# waits for a green /health. This is the production serving step (#008
# retired the claw steps 47/48/49).
#
# CRITICAL: `opencode-server install` bootouts a stale label as part of its
# direct-boot handover. We therefore refuse to invoke
# it while this tier's agent is already loaded AND healthy — strict
# idempotency means a live resident daemon (and anything mid-flight against
# it) is never disturbed.
#
# Tier identity comes from THE single tier table (#016):
# host/llama-server/tiers.conf — the same file scripts/opencode-server, oc and
# the sweep driver resolve, so the wizard can never disagree with the launcher
# it invokes. models.conf stays the MODEL table (GGUF + sampler).

# step_51_resolve TIER — sets OC_PORT / OC_LABEL / OC_TEMPLATE / OC_LOG from
# tiers.conf. Empty OC_LABEL means "no launchd path" (tiers.conf label "-",
# on-demand-only tier). Returns 1 on an unknown tier or a missing table.
step_51_resolve() {
  # shellcheck disable=SC1090,SC1091
  source "${REPO_ROOT}/host/llama-server/tiers.conf" 2>/dev/null || return 1
  tier_resolve "$1" || return 1
  OC_PORT="$TIER_PORT"
  OC_TEMPLATE="$TIER_TEMPLATE"
  OC_LOG="$TIER_LOG_PATH"
  if [ "$TIER_LAUNCHD_LABEL" = "-" ]; then OC_LABEL=""; else OC_LABEL="$TIER_LAUNCHD_LABEL"; fi
}

step_51_loaded() {
  launchctl print "gui/$(id -u)/${OC_LABEL}" >/dev/null 2>&1 \
    || launchctl list 2>/dev/null | grep -q "${OC_LABEL}\$"
}

step_51_healthy() {
  curl -fsS --max-time 3 "http://127.0.0.1:${OC_PORT}/health" >/dev/null 2>&1
}

step_51_is_done() {
  step_51_loaded && step_51_healthy
}

# Canonical admission probe — DELEGATED to `opencode-server probe` (#011).
# The previous curl-only twin asserted just 2 of cmd_probe's 3 template
# invariants (it was born without the old-suite-#017 per-request
# enable_thinking:false check), so a wizard-passing server could fail the
# canonical probe. One oracle, one place. NOTE (#010/#016): the probe is NOT
# read-only anymore — checks 1-3 are template-only /apply-template invariants,
# but check 4 is the LIVE tool-call battery (N=6 real generations via
# validate-tool-calls.sh, ~4-5 s on an idle server; the Layer-A admission
# gate). Only invoked on the no-install branch — `opencode-server install`
# runs the same probe itself as its final act (one battery per install path).
# $1 = tier.
step_51_probe() {
  ( cd "${REPO_ROOT}/host/llama-server" \
      && OPENCODE_TIER="$1" ./scripts/opencode-server probe )
}

step_51_main() {
  local tier
  tier=$(state_get TIER 2>/dev/null) || tier=$(detect_tier)
  hdr "OpenCode serving (resident llama-server, tier ${tier})"
  if [ "$(state_get TOPOLOGY)" = "client-only" ]; then
    skip "client-only topology — opencode serving lives on the host"
    return 0
  fi
  if ! step_51_resolve "$tier"; then
    fail "unknown tier '${tier}' — expected 16, 32 or 64"
    return 1
  fi
  # Recorded for the client-side opencode steps (#007): where this host serves.
  state_set OPENCODE_PORT "$OC_PORT"
  state_set OPENCODE_TIER "$tier"

  # --- tier-32: on-demand only (decision §2.5) — provision-check the config,
  # --- never leave a server resident.
  if [ -z "$OC_LABEL" ]; then
    local bin tmpl gguf missing=0
    bin="${LLAMA_SERVER:-$HOME/.local/bin/llama-server}"
    tmpl="${REPO_ROOT}/host/llama-server/templates/${OC_TEMPLATE}"
    # shellcheck disable=SC1090
    gguf=$(source "${REPO_ROOT}/host/llama-server/models.conf" 2>/dev/null; \
           eval "printf '%s' \"\${TIER_${tier}_GGUF:-}\"")
    [ -x "$bin" ]  || { warn "llama-server binary missing: ${bin} (step 42 builds it)"; missing=1; }
    [ -f "$gguf" ] || { warn "tier-${tier} GGUF missing: ${gguf} (step 46 fetches it)"; missing=1; }
    [ -f "$tmpl" ] || { warn "corrected template missing: ${tmpl}"; missing=1; }
    if [ "$missing" -ne 0 ]; then
      fail "tier-32 on-demand serving config incomplete"
      return 1
    fi
    skip "tier-32 serves on demand — config verified (binary + GGUF + corrected template)"
    info "no resident daemon by design (decision §2.5) — boot with:"
    info "  OPENCODE_TIER=32 host/llama-server/scripts/opencode-server start"
    if step_51_healthy; then
      info "note: a tier-32 server is currently up on :${OC_PORT} (direct-boot)"
    fi
    return 0
  fi

  # --- tiers 64/16: launchd resident daemon -------------------------------
  if step_51_is_done; then
    skip "${OC_LABEL} already loaded and healthy on :${OC_PORT}"
    info "refusing to call \`launchctl bootout\` on a running service"
    # No install ran on this branch, so step 51 owns the probe seat here
    # (#016 dedupe: exactly one battery-verified probe per install path).
    act "verifying live server via canonical probe (template invariants + #010 tool-call battery)"
    if step_51_probe "$tier"; then
      ok "canonical probe passed (system-not-first + thinking-off + tool-call battery)"
      return 0
    fi
    fail "live server on :${OC_PORT} FAILED the canonical probe"
    info "debug: OPENCODE_TIER=${tier} host/llama-server/scripts/opencode-server probe"
    return 1
  fi
  if step_51_loaded && ! step_51_healthy; then
    # #029: never return 0 on a red daemon. A crash-looping service (e.g. a
    # stale GGUF path under the new conditional-KeepAlive plists) also reads
    # "loaded but not healthy"; silently passing here deferred the failure to
    # step 61's 240 s smoke wait. Poll long enough for a legitimate cold model
    # load (tier-64 ≈ 21 GB; same 180 s bound as the launcher's
    # HEALTH_TIMEOUT), then FAIL the step with the daemon's own log lines so
    # the cause is visible at the step that owns it. Still never touches the
    # service (no bootout) — strict idempotency holds.
    local wait_s waited=0
    wait_s="${WIZARD_OC_HEALTH_WAIT:-180}"
    warn "service ${OC_LABEL} loaded but :${OC_PORT}/health not responding"
    act "polling /health up to ${wait_s}s (cold model load; a crash-looping daemon never goes green)"
    while [ "$waited" -lt "$wait_s" ]; do
      sleep 3; waited=$((waited+3))
      step_51_healthy && break
    done
    if step_51_healthy; then
      ok "service went green on :${OC_PORT} after ~${waited}s (model load)"
      # No install ran on this branch either — step 51 owns the probe seat
      # here, exactly like the already-healthy branch above (#016 dedupe).
      act "verifying live server via canonical probe (template invariants + #010 tool-call battery)"
      if step_51_probe "$tier"; then
        ok "canonical probe passed (system-not-first + thinking-off + tool-call battery)"
        return 0
      fi
      fail "live server on :${OC_PORT} FAILED the canonical probe"
      info "debug: OPENCODE_TIER=${tier} host/llama-server/scripts/opencode-server probe"
      return 1
    fi
    fail "${OC_LABEL} loaded but :${OC_PORT}/health never went green within ${wait_s}s — likely crash-looping (stale GGUF path / bad config?)"
    if [ -f "$OC_LOG" ]; then
      info "last daemon log lines (${OC_LOG}):"
      tail -n 12 "$OC_LOG" 2>/dev/null | sed 's/^/      /'
    else
      info "no daemon log at ${OC_LOG}"
    fi
    info "debug: launchctl print gui/$(id -u)/${OC_LABEL} ; tail -50 ${OC_LOG}"
    info "recover: fix models.conf, then OPENCODE_TIER=${tier} host/llama-server/scripts/opencode-server install"
    return 1
  fi
  act "invoking opencode-server install (tier ${tier}, :${OC_PORT})"
  # install waits for green /health (HEALTH_TIMEOUT, default 180 s) AND runs
  # the canonical probe — template invariants + the #010 live tool-call
  # battery — as its final act; a probe failure fails the install. Step 51
  # therefore does NOT probe again here (#016 dedupe: the pre-dedupe flow ran
  # the ~6-generation battery twice per wizard install — once in cmd_install,
  # once here). The gate guarantee holds: this path's one battery-verified
  # probe seat is inside install; the already-healthy branch above keeps its
  # own seat because no install runs there.
  ( cd "${REPO_ROOT}/host/llama-server" \
      && OPENCODE_TIER="$tier" ./scripts/opencode-server install ) \
    || { fail "opencode-server install failed (health or canonical-probe gate)"; return 1; }
  if step_51_is_done; then
    ok "opencode-server healthy on :${OC_PORT} (${OC_LABEL}; probe gate passed inside install)"
  else
    fail "install returned but ${OC_LABEL} is not loaded+green on :${OC_PORT}"
    return 1
  fi
}
