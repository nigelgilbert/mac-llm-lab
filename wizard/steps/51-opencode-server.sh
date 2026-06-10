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
# Tier identity (mirrors scripts/opencode-server; host/llama-server/models.conf
# is the single source of truth for GGUF + sampler):
#   64 -> :11436  com.mac-llm-lab.opencode-server     RESIDENT (launchd)
#   16 -> :11437  com.mac-llm-lab.opencode-server-16  RESIDENT (launchd)
#   32 -> :11438  no plist BY DESIGN — on-demand only (decision §2.5)

# step_51_resolve TIER — sets OC_PORT / OC_LABEL / OC_TEMPLATE.
# Empty OC_LABEL means "no launchd path" (on-demand-only tier).
step_51_resolve() {
  case "$1" in
    64) OC_PORT=11436; OC_LABEL="com.mac-llm-lab.opencode-server";    OC_TEMPLATE="qwen36-corrected.jinja" ;;
    16) OC_PORT=11437; OC_LABEL="com.mac-llm-lab.opencode-server-16"; OC_TEMPLATE="qwen35-corrected.jinja" ;;
    32) OC_PORT=11438; OC_LABEL="";                                   OC_TEMPLATE="qwen35-corrected.jinja" ;;
    *)  return 1 ;;
  esac
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

# Read-only template probe (curl-only twin of `opencode-server probe`):
# the LIVE server must carry the system-not-first fix (#004/#018) and the
# thinking-off closed <think></think> prefill (#017). /apply-template is
# template-only — no tokens are generated, safe against a busy server.
step_51_probe() {
  local base="http://127.0.0.1:${OC_PORT}" out
  out=$(curl -fsS --max-time 10 -X POST "${base}/apply-template" \
          -H 'content-type: application/json' \
          -d '{"messages":[{"role":"user","content":"hi"},{"role":"system","content":"WIZARD_SENTINEL_51"},{"role":"user","content":"ok"}]}' 2>/dev/null)
  printf '%s' "$out" | grep -qF 'WIZARD_SENTINEL_51' || return 1
  printf '%s' "$out" | grep -qF '<|im_start|>system' || return 1
  out=$(curl -fsS --max-time 10 -X POST "${base}/apply-template" \
          -H 'content-type: application/json' \
          -d '{"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null)
  # In the raw JSON reply the closed prefill appears with escaped newlines.
  printf '%s' "$out" | grep -qF '<think>\n\n</think>'
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
    return 0
  fi
  if step_51_loaded && ! step_51_healthy; then
    warn "service loaded but :${OC_PORT}/health not responding"
    info "this may be a model that's still loading; not touching it"
    info "wait 60s and re-run the wizard if the issue persists"
    return 0
  fi
  act "invoking opencode-server install (tier ${tier}, :${OC_PORT})"
  ( cd "${REPO_ROOT}/host/llama-server" \
      && OPENCODE_TIER="$tier" ./scripts/opencode-server install ) \
    || { fail "opencode-server install failed"; return 1; }
  # install itself waits for green /health (HEALTH_TIMEOUT, default 180 s).
  if step_51_is_done; then
    ok "opencode-server healthy on :${OC_PORT} (${OC_LABEL})"
  else
    fail "install returned but ${OC_LABEL} is not loaded+green on :${OC_PORT}"
    return 1
  fi
  act "probing live template (system-not-first fix + thinking-off prefill)"
  if step_51_probe; then
    ok "template probe passed (corrected template, closed <think></think>)"
  else
    warn "template probe failed — server green but template behavior unexpected"
    info "debug: OPENCODE_TIER=${tier} host/llama-server/scripts/opencode-server probe"
  fi
}
