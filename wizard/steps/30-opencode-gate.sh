#!/usr/bin/env bash
# 30-opencode-gate.sh — gate. If user declines, the wizard exits cleanly.

step_30_main() {
  hdr "OpenCode (the code stack)"
  if prompt_yn "Install the OpenCode coding stack?" y; then
    state_set OPENCODE_REQUESTED yes
    ok "proceeding with the OpenCode install"
    return 0
  fi
  state_set OPENCODE_REQUESTED no
  skip "OpenCode declined — nothing to install"
  printf "\n  done.\n\n"
  exit 0
}
