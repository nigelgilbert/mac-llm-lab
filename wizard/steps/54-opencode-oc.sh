#!/usr/bin/env bash
# 54-opencode-oc.sh — put the `oc` daily-driver wrapper (#003) on PATH
# (#007 / decision §2.10). Symlink (the step-42 llama-server convention:
# ~/.local/bin -> repo), so the wrapper tracks the repo without reinstalls;
# oc is self-locating, so a symlink works.
#
# Never clobbers a foreign `oc` at the target (warn + leave, the house
# conflict convention); a DANGLING symlink is replaced — that's debris, not
# user intent.

step_54_src()  { printf '%s' "${REPO_ROOT}/client/opencode/bin/oc"; }
step_54_link() { printf '%s' "${HOME}/.local/bin/oc"; }

step_54_is_done() {
  local src link
  src=$(step_54_src)
  link=$(step_54_link)
  [ -L "$link" ] && [ "$(readlink "$link")" = "$src" ] && [ -x "$src" ]
}

step_54_path_note() {
  case ":$PATH:" in
    *":${HOME}/.local/bin:"*) ;;
    *) warn "\${HOME}/.local/bin is not on your PATH — add it in your shell profile to call \`oc\` directly" ;;
  esac
}

step_54_main() {
  hdr "oc wrapper on PATH (~/.local/bin/oc)"
  local src link
  src=$(step_54_src)
  link=$(step_54_link)

  if [ ! -f "$src" ]; then
    fail "oc source missing: ${src}"
    return 1
  fi
  [ -x "$src" ] || chmod +x "$src" 2>/dev/null || { fail "oc source not executable: ${src}"; return 1; }

  if step_54_is_done; then
    skip "oc -> ${src}"
    step_54_path_note
    return 0
  fi

  if [ -e "$link" ] || [ -L "$link" ]; then
    if [ -L "$link" ] && [ ! -e "$link" ]; then
      act "replacing dangling oc symlink (was: $(readlink "$link"))"
      rm -f "$link"
    else
      warn "a different \`oc\` already exists at ${link} — leaving as-is (never clobbering)"
      info "wizard would link: ${src}"
      info "remove the existing one and re-run to adopt the repo wrapper"
      return 0
    fi
  fi

  act "symlinking ${link} -> ${src}"
  mkdir -p "$(dirname "$link")" || { fail "could not create $(dirname "$link")"; return 1; }
  ln -s "$src" "$link" || { fail "symlink failed"; return 1; }
  if "$link" help >/dev/null 2>&1; then
    ok "oc installed (\`oc help\` OK)"
  else
    fail "oc linked but \`oc help\` failed — check ${src}"
    return 1
  fi
  step_54_path_note
}
