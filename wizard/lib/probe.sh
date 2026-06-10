#!/usr/bin/env bash
# probe.sh — verification probes that run inside the tester orb.
#
# These spin the wizard-tester:local image ephemerally and run smoke.sh
# with a mode argument. They never publish ports; communication is
# egress-only via host.docker.internal.

TESTER_DIR="${WIZARD_ROOT:-.}/tester"

# tester_run MODE -> 0 on success
tester_run() {
  local mode="$1"
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not on PATH — can't run tester orb"
    return 1
  fi
  if ! docker image inspect wizard-tester:local >/dev/null 2>&1; then
    fail "wizard-tester:local not built yet — run wizard/steps/44-build-tester.sh"
    return 1
  fi
  local bridge_host bridge_port key
  bridge_host=$(state_get BRIDGE_HOST 2>/dev/null || printf 'host.docker.internal')
  bridge_port=$(state_get BRIDGE_PORT 2>/dev/null || printf '4000')
  key=$(state_get LITELLM_MASTER_KEY 2>/dev/null || printf '')
  # NOTE: the tester image sets ENTRYPOINT ["/smoke.sh"], so pass ONLY the
  # mode as the arg — passing "/smoke.sh $mode" made smoke.sh see "/smoke.sh"
  # as its mode and fail dispatch (pre-existing bug; fixed during issue #006).
  BRIDGE_HOST="$bridge_host" BRIDGE_PORT="$bridge_port" LITELLM_MASTER_KEY="$key" \
  docker compose -f "${TESTER_DIR}/docker-compose.yml" run --rm \
    -e MODE="$mode" \
    tester "$mode"
}

probe_docker()  { tester_run docker; }
probe_ollama()  { tester_run ollama; }
probe_bridge()  { tester_run bridge; }
probe_models()  { tester_run models; }
probe_deep()    { tester_run deep; }
