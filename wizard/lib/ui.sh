#!/usr/bin/env bash
# ui.sh — ANSI helpers, banner, prompts, slider. Pure bash 3.2 safe.
# Source-only; do not execute directly.

# --- ANSI helpers ----------------------------------------------------------
ok()    { printf "  \033[32m✓\033[0m  %s\n" "$*"; }
warn()  { printf "  \033[33m!\033[0m  %s\n" "$*"; }
fail()  { printf "  \033[31m✗\033[0m  %s\n" "$*"; }
info()  { printf "     %s\n" "$*"; }
hdr()   { printf "\n\033[1m%s\033[0m\n" "$*"; }
skip()  { printf "  \033[2m✓ already done — %s\033[0m\n" "$*"; }
act()   { printf "  \033[1;36m▸\033[0m  %s\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m" "$*"; }

# --- banner ---------------------------------------------------------------
banner() {
  printf '\n'
  printf '\033[1;36m'
  cat <<'EOF'
   __  ___          __    __    __  ___
  /  |/  /__ ____  / /   / /   /  |/  /
 / /|_/ / _ `/ __// /__ / /__ / /|_/ /
/_/  /_/\_,_/\__//____//____//_/  /_/
EOF
  printf '\033[0m'
  printf '\n  install wizard — code stack\n\n'
}

# --- y/n prompt -----------------------------------------------------------
# prompt_yn "Question?" [default=y|n]
# Returns 0 for yes, 1 for no.
prompt_yn() {
  local q="$1"
  local default="${2:-y}"
  local hint="[Y/n]"
  [ "$default" = "n" ] && hint="[y/N]"
  local ans
  while true; do
    printf "  %s %s " "$q" "$hint" >&2
    if ! IFS= read -r ans; then
      ans="$default"
    fi
    [ -z "$ans" ] && ans="$default"
    case "$ans" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO)   return 1 ;;
      *) printf "    please answer y or n\n" >&2 ;;
    esac
  done
}

# --- text prompt with default --------------------------------------------
# prompt_str "Label" "default-value" -> echoes value on stdout
prompt_str() {
  local label="$1"
  local def="$2"
  local ans
  printf "  %s [%s]: " "$label" "$def" >&2
  if ! IFS= read -r ans; then
    ans=""
  fi
  [ -z "$ans" ] && ans="$def"
  printf '%s\n' "$ans"
}

# --- arrow-key horizontal slider -----------------------------------------
# slider_pick "Title" OPT1 OPT2 OPT3 ...
# Echoes the chosen value on stdout. UI on stderr.
# Honors $SLIDER_DEFAULT (option label) for initial position.
# Falls back to numbered select on non-TTY or TERM=dumb.
slider_pick() {
  local title="$1"; shift
  local opts=("$@")
  local n=${#opts[@]}
  local idx=0 i

  if [ -n "${SLIDER_DEFAULT:-}" ]; then
    for i in $(seq 0 $((n - 1))); do
      if [ "${opts[$i]}" = "$SLIDER_DEFAULT" ]; then
        idx=$i
        break
      fi
    done
  fi

  if [ ! -t 0 ] || [ ! -t 2 ] || [ "${TERM:-dumb}" = "dumb" ]; then
    # Non-TTY fallback: numbered select.
    {
      printf "  %s:\n" "$title"
      for i in $(seq 0 $((n - 1))); do
        printf "    %d) %s\n" $((i + 1)) "${opts[$i]}"
      done
      printf "  default %s — press Enter or pick number: " "${opts[$idx]}"
    } >&2
    local pick
    if IFS= read -r pick; then
      if [ -n "$pick" ] && [ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le "$n" ] 2>/dev/null; then
        idx=$((pick - 1))
      fi
    fi
    printf '%s\n' "${opts[$idx]}"
    return 0
  fi

  _ui_slider_render() {
    local i out=""
    for i in $(seq 0 $((n - 1))); do
      if [ "$i" -eq "$idx" ]; then
        out="$out  \033[1;30;46m ${opts[$i]} \033[0m"
      else
        out="$out  \033[2m${opts[$i]}\033[0m "
      fi
    done
    # \r + clear-line + redraw
    printf '\r\033[K  %s:%b   \033[2m(←/→  Enter)\033[0m' "$title" "$out" >&2
  }

  _ui_slider_render
  local key rest
  # Hide cursor for the duration of the picker.
  printf '\033[?25l' >&2
  while IFS= read -rsn1 key; do
    if [ "$key" = $'\033' ]; then
      # Read the rest of the escape sequence unconditionally; bash 3.2 has
      # no fractional read -t timeouts, so we accept that bare-Esc cancel
      # is unsupported (Ctrl-C still exits the process).
      IFS= read -rsn2 rest
      case "$rest" in
        '[C') idx=$(( (idx + 1) % n )) ;;
        '[D') idx=$(( (idx - 1 + n) % n )) ;;
      esac
    elif [ -z "$key" ]; then
      # Enter
      break
    fi
    _ui_slider_render
  done
  printf '\033[?25h\n' >&2
  printf '%s\n' "${opts[$idx]}"
}

# --- spinner --------------------------------------------------------------
# spin "label" -- command [args...]
# Runs the command, shows a spinner, returns the command's exit code.
# Output of the command is captured into wizard/.logs/install-<ts>.log via log.sh tee.
spin() {
  local label="$1"; shift
  if [ "${1:-}" = "--" ]; then shift; fi
  if [ ! -t 2 ]; then
    "$@"
    return $?
  fi
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0 pid rc
  printf "  \033[1;36m▸\033[0m  %s " "$label" >&2
  "$@" &
  pid=$!
  printf '\033[?25l' >&2
  while kill -0 "$pid" 2>/dev/null; do
    local f=${frames:$((i % 10)):1}
    printf '\b%s' "$f" >&2
    i=$((i + 1))
    sleep 0.08
  done
  wait "$pid"; rc=$?
  printf '\033[?25h' >&2
  if [ "$rc" -eq 0 ]; then
    printf '\b\033[32m✓\033[0m\n' >&2
  else
    printf '\b\033[31m✗\033[0m  (rc=%d)\n' "$rc" >&2
  fi
  return $rc
}
