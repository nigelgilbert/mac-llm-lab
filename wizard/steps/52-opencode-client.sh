#!/usr/bin/env bash
# 52-opencode-client.sh — the OpenCode client half, part 1 (#007): the
# container image + the per-tier opencode configs. Runs in BOTH topologies
# (like step 49): the container is the client, wherever the server lives.
#
# - image: opencode:local, built from client/opencode/Dockerfile with the
#   pinned OPENCODE_VERSION (client/opencode/.env override, else the
#   Dockerfile ARG default). Idempotent: present + pin matches -> already
#   done. The pin is read back from the image's buildkit layer history;
#   if the history doesn't expose it (older builder), presence is accepted.
#   Plain `docker build` (not compose build) so a missing client/opencode/.env
#   (fresh machine) can't fail compose's ${WORKSPACE} volume interpolation.
# - tier configs: opencode.json/.16/.32 are REPO files that `oc` (#003)
#   bind-mounts at runtime — nothing to copy, but a fresh install must not
#   ship a broken one, so we verify each exists and pins autoupdate:false
#   (the #003 TUI self-update finding) and dials its own tier port (the
#   #019 wrong-port bug class).
# - client-only topology: additionally renders gitignored
#   opencode.remote{,.16,.32}.json with `host.docker.internal` swapped for
#   the LAN serving host (state OPENCODE_HOST, prompted once), so the
#   container dials the serving Mac directly. An IP is recommended: .local
#   mDNS names often don't resolve inside containers.

# Pinned version the wizard expects: client/opencode/.env wins (compose
# behavior), else the Dockerfile ARG default.
step_52_pin() {
  local envf="${REPO_ROOT}/client/opencode/.env" v=""
  if [ -f "$envf" ]; then
    v=$(grep -E '^OPENCODE_VERSION=' "$envf" 2>/dev/null | tail -n1 | cut -d= -f2-)
  fi
  if [ -z "$v" ]; then
    v=$(grep -E '^ARG OPENCODE_VERSION=' "${REPO_ROOT}/client/opencode/Dockerfile" 2>/dev/null \
          | head -n1 | cut -d= -f2-)
  fi
  printf '%s' "$v"
}

# Best-effort version read-back: buildkit records `|1 OPENCODE_VERSION=x.y.z`
# in the RUN layer history. Empty output = undeterminable.
step_52_image_version() {
  docker image history --no-trunc opencode:local 2>/dev/null \
    | grep -oE 'OPENCODE_VERSION=[0-9][^ ]*' | head -n1 | cut -d= -f2
}

step_52_image_ok() {
  docker image inspect opencode:local >/dev/null 2>&1 || return 1
  local want have
  want=$(step_52_pin)
  have=$(step_52_image_version)
  # Undeterminable on either side -> accept presence (never rebuild blind).
  [ -z "$want" ] || [ -z "$have" ] || [ "$want" = "$have" ]
}

# step_52_config_ok FILE PORT — present, readable, autoupdate pinned false,
# dials its own tier port.
step_52_config_ok() {
  local f="${REPO_ROOT}/client/opencode/$1" port="$2"
  [ -f "$f" ] && [ -r "$f" ] || return 1
  grep -q '"autoupdate"[[:space:]]*:[[:space:]]*false' "$f" || return 1
  grep -q ":${port}/v1" "$f"
}

# step_52_render_remote HOST — derive opencode.remote{,.16,.32}.json from the
# repo tier configs with host.docker.internal -> HOST. Derived + gitignored,
# so content-compare-then-rewrite (not never-overwrite): a changed host must
# not leave stale configs behind.
step_52_render_remote() {
  local host="$1" src dst body changed=0
  for src in opencode.json opencode.16.json opencode.32.json; do
    dst="${src/opencode./opencode.remote.}"
    body=$(cat "${REPO_ROOT}/client/opencode/${src}") || return 1
    body="${body//host.docker.internal/$host}"
    if [ -f "${REPO_ROOT}/client/opencode/${dst}" ] \
       && [ "$(cat "${REPO_ROOT}/client/opencode/${dst}")" = "$body" ]; then
      continue
    fi
    act "rendering client/opencode/${dst} (server host: ${host})"
    printf '%s\n' "$body" > "${REPO_ROOT}/client/opencode/${dst}" || return 1
    changed=1
  done
  if [ "$changed" -eq 0 ]; then
    skip "remote tier configs match (server host: ${host})"
  else
    ok "remote tier configs rendered for ${host}"
  fi
}

step_52_main() {
  hdr "OpenCode client (image + tier configs)"

  # --- image ----------------------------------------------------------------
  local want
  want=$(step_52_pin)
  if step_52_image_ok; then
    skip "opencode:local image present (pin ${want:-unverified})"
  else
    if docker image inspect opencode:local >/dev/null 2>&1; then
      warn "opencode:local present but pinned at $(step_52_image_version) — want ${want}"
    fi
    act "building opencode:local (OPENCODE_VERSION=${want:-Dockerfile default})"
    # No array: empty-array expansion breaks bash 3.2 under set -u.
    if [ -n "$want" ]; then
      ( cd "${REPO_ROOT}/client/opencode" \
          && docker build --build-arg "OPENCODE_VERSION=${want}" -t opencode:local . ) \
        || { fail "opencode image build failed"; return 1; }
    else
      ( cd "${REPO_ROOT}/client/opencode" && docker build -t opencode:local . ) \
        || { fail "opencode image build failed"; return 1; }
    fi
    step_52_image_ok || { fail "built, but opencode:local still fails the pin check"; return 1; }
    ok "opencode:local built (pin ${want:-Dockerfile default})"
  fi

  # --- tier configs (repo files, mounted at runtime by oc) -------------------
  local bad=""
  step_52_config_ok opencode.json    11436 || bad="$bad opencode.json(:11436)"
  step_52_config_ok opencode.16.json 11437 || bad="$bad opencode.16.json(:11437)"
  step_52_config_ok opencode.32.json 11438 || bad="$bad opencode.32.json(:11438)"
  if [ -n "$bad" ]; then
    fail "tier config check failed:${bad}"
    info "each must exist, pin \"autoupdate\": false, and dial its own tier port"
    return 1
  fi
  ok "tier configs OK (autoupdate:false, ports 11436/11437/11438)"

  # --- client-only: remote configs pointed at the LAN serving host -----------
  if [ "$(state_get TOPOLOGY 2>/dev/null)" = "client-only" ]; then
    local ohost
    if state_has OPENCODE_HOST; then
      ohost=$(state_get OPENCODE_HOST)
    else
      ohost=$(prompt_str "OpenCode server host (LAN address of the serving Mac; IP recommended — .local often fails inside containers)" "mac-llm-lab.local")
      state_set OPENCODE_HOST "$ohost"
    fi
    state_has OPENCODE_PORT || state_set OPENCODE_PORT 11436
    step_52_render_remote "$ohost" || { fail "remote config render failed"; return 1; }
  fi
}
