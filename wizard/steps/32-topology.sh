#!/usr/bin/env bash
# 32-topology.sh — full-local vs client-only. In client-only mode the LAN
# serving host is prompted for later (step 52, state OPENCODE_HOST).

step_32_main() {
  hdr "Topology"
  local default
  default=$(detect_topology_default)
  info "default: ${default}"
  SLIDER_DEFAULT="$default"
  local picked
  picked=$(slider_pick "Topology" "full-local" "client-only")
  state_set TOPOLOGY "$picked"

  case "$picked" in
    full-local)
      ok "topology: full-local (host + client on this Mac)"
      ;;
    client-only)
      ok "topology: client-only (LAN host)"
      info "the OpenCode serving host is configured in the client step (52)"
      ;;
  esac
}
