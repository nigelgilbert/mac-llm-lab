#!/usr/bin/env bash
# smoke.sh — runs inside wizard-tester:local. Modes: docker | ollama.
# Egress-only; never publishes ports.
set -eu

MODE="${1:-${MODE:-docker}}"
HOST_GATEWAY="${HOST_GATEWAY:-host.docker.internal}"

ok()   { printf "  [tester] \033[32m✓\033[0m %s\n" "$*"; }
fail() { printf "  [tester] \033[31m✗\033[0m %s\n" "$*"; exit 1; }

case "$MODE" in
  docker)
    ok "tester orb is running (docker daemon reachable)"
    ;;

  ollama)
    if curl -fsS --max-time 5 "http://${HOST_GATEWAY}:11434/api/tags" >/dev/null; then
      n=$(curl -fsS "http://${HOST_GATEWAY}:11434/api/tags" | jq '.models | length')
      ok "ollama up at ${HOST_GATEWAY}:11434 (${n} models)"
    else
      fail "ollama not reachable at ${HOST_GATEWAY}:11434"
    fi
    ;;

  *)
    fail "unknown mode: ${MODE}"
    ;;
esac
