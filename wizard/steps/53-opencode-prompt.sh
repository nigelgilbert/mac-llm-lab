#!/usr/bin/env bash
# 53-opencode-prompt.sh — install the global OpenCode prompt (#007): the repo
# system prompt to ~/.config/opencode/AGENTS.md on the HOST. This is the #001
# winning delivery mechanism (decision §2.6): `oc` bind-mounts the file
# read-only at /root/.config/opencode/AGENTS.md inside the container, where
# OpenCode injects it into the agent system prompt ("Instructions from: ...").
#
# Injection failure is SILENT in OpenCode, so:
# - the source must be non-empty (an empty AGENTS.md mounts cleanly and
#   injects nothing),
# - an existing DIFFERENT AGENTS.md is never clobbered (same convention as
#   the .env never-overwrite rule) — the user may have customized it; we warn
#   and leave it, and `oc` will happily mount theirs,
# - the end-to-end injection assertion lives in the smoke step (61), via the
#   deterministic `oc probe` wire-capture oracle.

step_53_src() { printf '%s' "${REPO_ROOT}/host/llama-server/docs/system-prompt.md"; }
step_53_dst() { printf '%s' "${HOME}/.config/opencode/AGENTS.md"; }

step_53_is_done() {
  [ -f "$(step_53_dst)" ] && cmp -s "$(step_53_src)" "$(step_53_dst)"
}

step_53_main() {
  hdr "OpenCode global prompt (~/.config/opencode/AGENTS.md)"
  local src dst
  src=$(step_53_src)
  dst=$(step_53_dst)

  if [ ! -s "$src" ]; then
    fail "repo prompt source missing or empty: ${src}"
    info "refusing to install a null prompt — injection failure is silent"
    return 1
  fi

  if step_53_is_done; then
    skip "AGENTS.md installed and matches repo system-prompt.md"
    return 0
  fi

  if [ -e "$dst" ]; then
    if [ ! -f "$dst" ]; then
      fail "${dst} exists but is not a regular file — fix it by hand"
      info "(a directory there would bind-mount over the container path and inject nothing)"
      return 1
    fi
    warn "AGENTS.md exists with DIFFERENT content — leaving as-is (never clobbering a user prompt)"
    info "wizard source: ${src}"
    info "to adopt the repo prompt: cp \"${src}\" \"${dst}\" and re-run"
    return 0
  fi

  act "installing repo system-prompt.md -> ${dst}"
  mkdir -p "$(dirname "$dst")" || { fail "could not create $(dirname "$dst")"; return 1; }
  cp "$src" "$dst" || { fail "copy failed"; return 1; }
  if step_53_is_done; then
    ok "global prompt installed ($(wc -c < "$dst" | tr -d ' ') bytes)"
  else
    fail "installed file does not match source — check ${dst}"
    return 1
  fi
}
