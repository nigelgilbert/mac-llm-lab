#!/usr/bin/env bash
# run-tests.sh — wizard self-test harness. Runs INSIDE the harness orb where
# the repo is bind-mounted at /repo (read-only). Writes a tap-style log to
# /repo/wizard/.logs is impossible (ro mount) so logs go to /tmp/wizard-tests.
#
# Categories (see CLAUDE testing plan):
#   1. static / lint
#   2. bash 3.2 compat / banned constructs
#   3. state + keys idempotency
#   4. detection
#   5. step-level dry-runs (is_done predicates)
#   6. entrypoint dispatcher (bash + zsh)
#   7. end-to-end "idempotency-while-hot" simulation
#   8. tester orb modes (smoke.sh dispatch table only — no live HTTP)
#   9. negative / failure paths

set -u

REPO=/repo
RW=/tmp/wizard-rw
SHIMS=/tmp/shims
LOGS=/tmp/wizard-tests
mkdir -p "$LOGS"

# ---------------------------------------------------------------- TAP plumbing
PASS=0; FAIL=0; SKIP=0; N=0
declare -a FAILS=()
t_ok()    { N=$((N+1)); PASS=$((PASS+1)); printf 'ok %d - %s\n' "$N" "$1"; }
t_not_ok(){ N=$((N+1)); FAIL=$((FAIL+1)); printf 'not ok %d - %s\n' "$N" "$1"
            FAILS+=("$1"); [ -n "${2:-}" ] && printf '  # %s\n' "$2"; }
t_skip()  { N=$((N+1)); SKIP=$((SKIP+1)); printf 'ok %d - %s # SKIP %s\n' "$N" "$1" "${2:-}"; }
t_run()   { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then t_ok "$desc"; else t_not_ok "$desc" "exit=$?"; fi; }
t_run_fail() { local desc="$1"; shift; if ! "$@" >/dev/null 2>&1; then t_ok "$desc"; else t_not_ok "$desc" "expected nonzero, got 0"; fi; }
hdr()     { printf '\n# === %s ===\n' "$*"; }

# ----------------------------------------------------------- prepare RW copy
rm -rf "$RW"
mkdir -p "$RW"
cp -r "$REPO/wizard" "$RW/"
cp -r "$REPO/host"   "$RW/" 2>/dev/null || mkdir -p "$RW/host"
cp -r "$REPO/client" "$RW/" 2>/dev/null || mkdir -p "$RW/client"
chmod -R u+rwX "$RW"
export WIZARD_ROOT="$RW/wizard"
export REPO_ROOT="$RW"
export WIZARD_STATE_FILE="$RW/wizard/.state"

# Source libs from the rw copy.
# shellcheck disable=SC1091
source "$RW/wizard/lib/ui.sh"
source "$RW/wizard/lib/state.sh"
source "$RW/wizard/lib/log.sh"
source "$RW/wizard/lib/detect.sh"
source "$RW/wizard/lib/keys.sh"

# ============================================================================
# 1. STATIC / LINT
# ============================================================================
hdr "1. static / lint"
ALL_SH=$(find "$REPO/wizard" -type f -name '*.sh' | sort)
ENTRYPOINT="$REPO/wizard/wizard"

# 1a. bash -n parse
fail_parse=""
for f in $ALL_SH "$ENTRYPOINT"; do
  if ! bash -n "$f" 2>>"$LOGS/parse.log"; then fail_parse="$fail_parse $f"; fi
done
[ -z "$fail_parse" ] && t_ok "bash -n parses every .sh + entrypoint" \
  || t_not_ok "bash -n parse" "$fail_parse"

# 1b. zsh -n parse — user flagged this explicitly
fail_zsh=""
for f in $ALL_SH "$ENTRYPOINT"; do
  if ! zsh -n "$f" 2>>"$LOGS/zsh-parse.log"; then fail_zsh="$fail_zsh $f"; fi
done
[ -z "$fail_zsh" ] && t_ok "zsh -n parses every .sh + entrypoint" \
  || t_not_ok "zsh -n parse" "see $LOGS/zsh-parse.log: $fail_zsh"

# 1c. shebang audit
bad_shebang=""
for f in $ALL_SH "$ENTRYPOINT"; do
  head -n1 "$f" | grep -qE '^#!/usr/bin/env bash' \
    || bad_shebang="$bad_shebang $(basename "$f")"
done
[ -z "$bad_shebang" ] && t_ok "every script uses #!/usr/bin/env bash shebang" \
  || t_not_ok "shebang audit" "$bad_shebang"

# 1d. banned bash 4+ constructs
banned_hits=""
check_banned() {
  local pat="$1" desc="$2"
  local hits
  hits=$(grep -rEn --include='*.sh' "$pat" "$REPO/wizard" 2>/dev/null | grep -v 'run-tests.sh' || true)
  if [ -n "$hits" ]; then banned_hits="$banned_hits\n$desc:\n$hits"; fi
}
check_banned '\bmapfile\b'        "mapfile (bash 4+)"
check_banned '\breadarray\b'      "readarray (bash 4+)"
check_banned '\$\{[A-Za-z_]+,,\}' '${var,,} lowercase (bash 4+)'
check_banned '\$\{[A-Za-z_]+\^\^\}' '${var^^} uppercase (bash 4+)'
check_banned 'declare -A'         "associative arrays (bash 4+)"
check_banned 'read -t [0-9]*\.'   "fractional read -t (bash 3.2 silently fails)"
[ -z "$banned_hits" ] && t_ok "no banned bash 4+ constructs" \
  || t_not_ok "bash 3.2 compat scan" "$(printf '%b' "$banned_hits" | head -c 400)"

# 1e. shellcheck (warning level)
sc_log="$LOGS/shellcheck.log"
: > "$sc_log"
sc_failed=0
for f in $ALL_SH "$ENTRYPOINT"; do
  shellcheck -s bash -S warning -e SC1091,SC2155,SC2086,SC2034 "$f" >> "$sc_log" 2>&1 || sc_failed=1
done
if [ "$sc_failed" -eq 0 ]; then
  t_ok "shellcheck (warning, SC1091/2155/2086 ignored) clean"
else
  t_not_ok "shellcheck warnings" "see $sc_log ($(wc -l <"$sc_log") lines)"
fi

# ============================================================================
# 2. BASH 3.2 COMPAT — slider behavior
# ============================================================================
hdr "2. bash 3.2 / slider / prompts"

# 2a. slider non-TTY fallback returns default on Enter
out=$(printf '\n' | TERM=dumb slider_pick "tier" 16 32 64 2>/dev/null)
[ "$out" = "16" ] && t_ok "slider non-TTY fallback: empty input -> first option" \
  || t_not_ok "slider fallback default" "got [$out]"

# 2b. slider non-TTY fallback honors numbered pick
out=$(printf '3\n' | TERM=dumb slider_pick "tier" 16 32 64 2>/dev/null)
[ "$out" = "64" ] && t_ok "slider non-TTY fallback: '3' -> third option" \
  || t_not_ok "slider numeric pick" "got [$out]"

# 2c. slider non-TTY fallback honors SLIDER_DEFAULT
out=$(printf '\n' | TERM=dumb SLIDER_DEFAULT=32 slider_pick "tier" 16 32 64 2>/dev/null)
[ "$out" = "32" ] && t_ok "slider SLIDER_DEFAULT=32 honored on Enter" \
  || t_not_ok "slider default override" "got [$out]"

# 2d. slider out-of-range pick falls back to default
out=$(printf '99\n' | TERM=dumb slider_pick "tier" 16 32 64 2>/dev/null)
[ "$out" = "16" ] && t_ok "slider out-of-range pick falls back to default" \
  || t_not_ok "slider oob" "got [$out]"

# 2e. prompt_yn — default Y, empty input
( printf '\n' | (prompt_yn "Q?" y >/dev/null 2>&1) ) \
  && t_ok "prompt_yn: empty + default=y -> yes (rc=0)" \
  || t_not_ok "prompt_yn default Y empty"

# 2f. prompt_yn — default N, empty input
( printf '\n' | (prompt_yn "Q?" n >/dev/null 2>&1) ) \
  && t_not_ok "prompt_yn default N empty" "expected rc=1" \
  || t_ok "prompt_yn: empty + default=n -> no (rc=1)"

# 2g. prompt_yn — explicit y
printf 'y\n' | (prompt_yn "Q?" n >/dev/null 2>&1) \
  && t_ok "prompt_yn: explicit y overrides default=n" \
  || t_not_ok "prompt_yn explicit y"

# 2h. prompt_yn — invalid then valid
printf 'maybe\nn\n' | (prompt_yn "Q?" y >/dev/null 2>&1)
rc=$?
[ "$rc" -eq 1 ] && t_ok "prompt_yn: 'maybe' rejected, 'n' accepted" \
  || t_not_ok "prompt_yn retry loop" "rc=$rc"

# 2i. prompt_str — empty -> default
out=$(printf '\n' | prompt_str "label" "deflt" 2>/dev/null)
[ "$out" = "deflt" ] && t_ok "prompt_str: empty -> default" \
  || t_not_ok "prompt_str default" "got [$out]"

# 2j. prompt_str — explicit -> echoes input
out=$(printf 'hello world\n' | prompt_str "label" "deflt" 2>/dev/null)
[ "$out" = "hello world" ] && t_ok "prompt_str: explicit value preserves spaces" \
  || t_not_ok "prompt_str explicit" "got [$out]"

# ============================================================================
# 3. STATE + KEYS
# ============================================================================
hdr "3. state + keys idempotency"

WIZARD_STATE_FILE="$LOGS/state-test.txt"
rm -f "$WIZARD_STATE_FILE"

state_set FOO bar
out=$(state_get FOO)
[ "$out" = "bar" ] && t_ok "state_set/get round-trip" || t_not_ok "state set/get" "[$out]"

# 3b. overwrite same key — no duplicate lines
state_set FOO baz
state_set FOO qux
n=$(grep -c '^FOO=' "$WIZARD_STATE_FILE")
[ "$n" -eq 1 ] && t_ok "state_set overwrites without duplicate lines" \
  || t_not_ok "state dedupe" "$n FOO= lines"

# 3c. state_has
state_has FOO  && t_ok "state_has: present key returns 0"        || t_not_ok "state_has present"
state_has BAZQ && t_not_ok "state_has missing" "expected nonzero" || t_ok "state_has: absent key returns nonzero"

# 3d. state value with spaces, $, =
state_set TRICKY 'a b=c $d "e" '\''f'\'''
out=$(state_get TRICKY)
[ "$out" = 'a b=c $d "e" '\''f'\''' ] && t_ok "state value preserves spaces/=/\$/quotes" \
  || t_not_ok "state value escaping" "got [$out]"

# 3e. ensure_litellm_key — generation when nothing exists
WIZARD_STATE_FILE="$LOGS/state-key.txt"; rm -f "$WIZARD_STATE_FILE"
REPO_ROOT="$LOGS/empty-repo"; mkdir -p "$REPO_ROOT"
key1=$(ensure_litellm_key 2>/dev/null)
case "$key1" in
  sk-*) [ ${#key1} -eq 67 ] && t_ok "ensure_litellm_key generates sk-<64hex> (len=67)" \
        || t_not_ok "key length" "len=${#key1}" ;;
  *) t_not_ok "key prefix" "got [$key1]" ;;
esac

# 3f. second call returns same key (state-cached)
key2=$(ensure_litellm_key 2>/dev/null)
[ "$key1" = "$key2" ] && t_ok "ensure_litellm_key idempotent (state-cached)" \
  || t_not_ok "key reuse" "differs"

# 3g. key sourced from existing client/.env when state empty
WIZARD_STATE_FILE="$LOGS/state-key2.txt"; rm -f "$WIZARD_STATE_FILE"
REPO_ROOT="$LOGS/repo2"; mkdir -p "$REPO_ROOT/client/claw-code"
printf 'LITELLM_MASTER_KEY=sk-from-client\nFOO=1\n' > "$REPO_ROOT/client/claw-code/.env"
key3=$(ensure_litellm_key 2>/dev/null)
[ "$key3" = "sk-from-client" ] && t_ok "ensure_litellm_key reads from client/.env" \
  || t_not_ok "key source client/.env" "got [$key3]"

# 3h. render_template substitution + idempotent (no overwrite)
src="$LOGS/tmpl.in"; dst="$LOGS/tmpl.out"; rm -f "$dst"
printf 'KEY=${LITELLM_MASTER_KEY}\nWS=${WORKSPACE}\n' > "$src"
render_template "$src" "$dst" "LITELLM_MASTER_KEY=abc" "WORKSPACE=/w"
grep -q '^KEY=abc' "$dst" && grep -q '^WS=/w' "$dst" \
  && t_ok "render_template substitutes \${KEY} and \${WORKSPACE}" \
  || t_not_ok "render_template subst"

# 3i. second render call must NOT overwrite
echo 'sentinel' > "$dst"
render_template "$src" "$dst" "LITELLM_MASTER_KEY=changed" "WORKSPACE=/w2"
[ "$(cat $dst)" = "sentinel" ] && t_ok "render_template refuses to overwrite (idempotent)" \
  || t_not_ok "render_template overwrite guard"

# 3j. render_template missing src -> fail
render_template "$LOGS/does-not-exist" "$LOGS/x" "K=v" >/dev/null 2>&1
[ $? -ne 0 ] && t_ok "render_template missing src -> nonzero" \
  || t_not_ok "render_template missing src"

# 3k. render_template handles sed metacharacters in values (|, &, /, \)
src2="$LOGS/tmpl2.in"; dst2="$LOGS/tmpl2.out"; rm -f "$dst2"
printf 'P=${PATHY}\nA=${AMP}\nB=${BSL}\n' > "$src2"
render_template "$src2" "$dst2" \
  'PATHY=/a/b|c/d' 'AMP=x&y' 'BSL=back\slash'
grep -q '^P=/a/b|c/d$' "$dst2" \
  && grep -q '^A=x&y$' "$dst2" \
  && grep -q '^B=back\\slash$' "$dst2" \
  && t_ok "render_template handles |, &, \\ in values without escaping" \
  || t_not_ok "render_template metacharacter handling" "$(cat "$dst2" | tr '\n' '|')"

# 3l. state file is chmod 600 after state_set (key material protection)
WIZARD_STATE_FILE="$LOGS/state-perms.txt"; rm -f "$WIZARD_STATE_FILE"
state_set SECRETKEY "sk-abcdef"
perms=$(stat -c '%a' "$WIZARD_STATE_FILE" 2>/dev/null || stat -f '%Lp' "$WIZARD_STATE_FILE" 2>/dev/null)
[ "$perms" = "600" ] && t_ok "state_set chmods state file to 600" \
  || t_not_ok "state file perms" "got [$perms]"

# ============================================================================
# 4. DETECTION
# ============================================================================
hdr "4. detection"

# Stub sysctl on PATH.
mkdir -p "$SHIMS"
make_sysctl() {
  cat >"$SHIMS/sysctl" <<EOF
#!/bin/sh
case "\$*" in
  *hw.memsize*) echo $1 ;;
  *) echo 0 ;;
esac
EOF
  chmod +x "$SHIMS/sysctl"
}
ORIG_PATH="$PATH"
export PATH="$SHIMS:$ORIG_PATH"

# 8 GB
make_sysctl $((8*1024*1024*1024))
[ "$(detect_tier)" = "16" ] && t_ok "detect_tier: 8 GB -> 16" || t_not_ok "tier 8GB"

# 16 GB
make_sysctl $((16*1024*1024*1024))
[ "$(detect_tier)" = "16" ] && t_ok "detect_tier: 16 GB -> 16" || t_not_ok "tier 16GB"

# 32 GB
make_sysctl $((32*1024*1024*1024))
[ "$(detect_tier)" = "32" ] && t_ok "detect_tier: 32 GB -> 32" || t_not_ok "tier 32GB"

# 36 GB (just above 28 threshold)
make_sysctl $((36*1024*1024*1024))
[ "$(detect_tier)" = "32" ] && t_ok "detect_tier: 36 GB -> 32" || t_not_ok "tier 36GB"

# 64 GB
make_sysctl $((64*1024*1024*1024))
[ "$(detect_tier)" = "64" ] && t_ok "detect_tier: 64 GB -> 64" || t_not_ok "tier 64GB"

# 128 GB
make_sysctl $((128*1024*1024*1024))
[ "$(detect_tier)" = "64" ] && t_ok "detect_tier: 128 GB -> 64" || t_not_ok "tier 128GB"

# missing sysctl -> 16 default
rm -f "$SHIMS/sysctl"
out=$(detect_tier 2>/dev/null)
[ "$out" = "16" ] && t_ok "detect_tier: no sysctl -> 16 (safe default)" \
  || t_not_ok "tier default" "[$out]"

# detect_arch returns something
out=$(detect_arch)
[ -n "$out" ] && t_ok "detect_arch returns non-empty ($out)" \
  || t_not_ok "detect_arch empty"

# detect_topology_default: stub hostname to mac-llm-lab
cat >"$SHIMS/hostname" <<'EOF'
#!/bin/sh
echo mac-llm-lab
EOF
chmod +x "$SHIMS/hostname"
out=$(detect_topology_default)
[ "$out" = "full-local" ] && t_ok "detect_topology_default: hostname=mac-llm-lab -> full-local" \
  || t_not_ok "topology mac-llm-lab" "[$out]"

cat >"$SHIMS/hostname" <<'EOF'
#!/bin/sh
echo some-laptop
EOF
out=$(detect_topology_default)
[ "$out" = "client-only" ] && t_ok "detect_topology_default: other hostname -> client-only" \
  || t_not_ok "topology other" "[$out]"

export PATH="$ORIG_PATH"
rm -f "$SHIMS"/*

# ============================================================================
# 5. STEP-LEVEL is_done predicates
# ============================================================================
hdr "5. step is_done dry-runs"

# Source step files (need probe + deps stubs).
source "$RW/wizard/lib/probe.sh" 2>/dev/null || true
source "$RW/wizard/lib/deps.sh"  2>/dev/null || true
for s in "$RW"/wizard/steps/*.sh; do
  # shellcheck disable=SC1090
  source "$s"
done

# 47-llama-server: refuses to install when loaded+healthy.
# Stub launchctl exit 0, curl exit 0 -> step_47_is_done true.
mkdir -p "$SHIMS"
cat >"$SHIMS/launchctl" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"$SHIMS/curl" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$SHIMS"/launchctl "$SHIMS"/curl
export PATH="$SHIMS:$ORIG_PATH"

if step_47_is_done; then
  t_ok "step_47_is_done: loaded+healthy -> true (M5 mid-eval safety)"
else
  t_not_ok "step_47_is_done loaded+healthy"
fi

# launchctl fail -> not loaded -> not done
cat >"$SHIMS/launchctl" <<'EOF'
#!/bin/sh
exit 1
EOF
# Ensure no fallback path: also stub `grep` in PATH? No — launchctl list piped to grep.
# step_47_loaded checks (launchctl print) || (launchctl list | grep). Both will fail.
if ! step_47_is_done; then
  t_ok "step_47_is_done: not-loaded -> false"
else
  t_not_ok "step_47_is_done not-loaded should be false"
fi

# curl fail (loaded but unhealthy) -> not done
cat >"$SHIMS/launchctl" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"$SHIMS/curl" <<'EOF'
#!/bin/sh
exit 22
EOF
if ! step_47_is_done; then
  t_ok "step_47_is_done: loaded-but-unhealthy -> false"
else
  t_not_ok "step_47_is_done loaded-unhealthy should be false"
fi

# step_47_main with TOPOLOGY=client-only short-circuits.
WIZARD_STATE_FILE="$LOGS/state-step47.txt"; rm -f "$WIZARD_STATE_FILE"
state_set TOPOLOGY client-only
if step_47_main >/dev/null 2>&1; then
  t_ok "step_47_main: client-only topology returns 0 without invoking installer"
else
  t_not_ok "step_47_main client-only" "rc=$?"
fi

# 51-opencode-server: same never-bootout contract as 47, parameterized by tier.
# Shim state here: launchctl exit 0 (loaded), curl exit 22 (unhealthy).
step_51_resolve 64
if ! step_51_is_done; then
  t_ok "step_51_is_done: tier-64 loaded-but-unhealthy -> false"
else
  t_not_ok "step_51_is_done loaded-unhealthy should be false"
fi

cat >"$SHIMS/curl" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$SHIMS/curl"
if step_51_is_done; then
  t_ok "step_51_is_done: tier-64 loaded+healthy -> true (never bootout a green daemon)"
else
  t_not_ok "step_51_is_done loaded+healthy"
fi

step_51_resolve 16
[ "$OC_PORT" = "11437" ] && [ "$OC_LABEL" = "com.mac-llm-lab.opencode-server-16" ] \
  && t_ok "step_51_resolve: tier-16 -> :11437 / -16 label" \
  || t_not_ok "step_51_resolve tier-16" "port=$OC_PORT label=$OC_LABEL"

step_51_resolve 32
[ "$OC_PORT" = "11438" ] && [ -z "$OC_LABEL" ] \
  && t_ok "step_51_resolve: tier-32 -> :11438, no launchd label (on-demand only)" \
  || t_not_ok "step_51_resolve tier-32" "port=$OC_PORT label=$OC_LABEL"

if ! step_51_resolve 99; then
  t_ok "step_51_resolve: invalid tier -> nonzero"
else
  t_not_ok "step_51_resolve invalid tier should fail"
fi

# step_51_main with TOPOLOGY=client-only short-circuits (skip path).
WIZARD_STATE_FILE="$LOGS/state-step51.txt"; rm -f "$WIZARD_STATE_FILE"
state_set TOPOLOGY client-only
if step_51_main >/dev/null 2>&1; then
  t_ok "step_51_main: client-only topology returns 0 without invoking installer"
else
  t_not_ok "step_51_main client-only" "rc=$?"
fi

export PATH="$ORIG_PATH"
rm -f "$SHIMS"/*

# 50-bringup running check
cat >"$SHIMS/docker" <<'EOF'
#!/bin/sh
case "$*" in
  "inspect --format {{.State.Running}} mac-llm-lab-litellm") echo true ;;
  "inspect --format {{.State.Running}} claw-code") echo true ;;
  *) echo false ;;
esac
EOF
chmod +x "$SHIMS/docker"
export PATH="$SHIMS:$ORIG_PATH"

if step_50_running mac-llm-lab-litellm; then
  t_ok "step_50_running: stubbed running container detected"
else
  t_not_ok "step_50_running stub"
fi

if ! step_50_running absent-container; then
  t_ok "step_50_running: absent container -> false"
else
  t_not_ok "step_50_running absent"
fi

export PATH="$ORIG_PATH"
rm -f "$SHIMS"/*

# 49 is_done — needs both .env + image. Without either -> false.
rm -f "$RW/client/claw-code/.env"
if ! step_49_is_done; then
  t_ok "step_49_is_done: missing .env -> false"
else
  t_not_ok "step_49_is_done missing .env"
fi

# 48 is_done — both .env + image. Without either -> false.
rm -f "$RW/host/litellm/.env"
if ! step_48_is_done; then
  t_ok "step_48_is_done: missing .env -> false"
else
  t_not_ok "step_48_is_done missing .env"
fi

# 46 is_done — file exists but smaller than MIN_BYTES -> false (catches a
# half-finished resumable download that was abandoned mid-stream).
WIZARD_STATE_FILE="$LOGS/state-step46.txt"; rm -f "$WIZARD_STATE_FILE"
state_set TIER 16
state_set TOPOLOGY full-local
# Resolve the tier-16 target path the same way the step does, then plant a
# 1-byte file there. is_done must reject it (real GGUF is ~5 GB).
HOME_SAVE="$HOME"
export HOME="$LOGS/fakehome46"
mkdir -p "$HOME/.ollama/gguf"
step_46_resolve 16
mkdir -p "$(dirname "$TARGET_GGUF")"
printf 'x' > "$TARGET_GGUF"
if ! step_46_is_done 16; then
  t_ok "step_46_is_done: undersized GGUF (1 byte) -> false"
else
  t_not_ok "step_46_is_done undersized" "expected false for 1-byte file"
fi
rm -f "$TARGET_GGUF"
export HOME="$HOME_SAVE"

# ============================================================================
# 6. ENTRYPOINT DISPATCHER (bash + zsh)
# ============================================================================
hdr "6. entrypoint dispatcher (bash + zsh)"

WIZ="$RW/wizard/wizard"
chmod +x "$WIZ"

bash "$WIZ" --help 2>&1 | grep -qi 'install the mac-llm-lab' \
  && t_ok "entrypoint: --help under bash prints help banner" \
  || t_not_ok "bash --help"

bash "$WIZ" -h 2>&1 | grep -qi 'usage' \
  && t_ok "entrypoint: -h under bash prints usage" \
  || t_not_ok "bash -h"

bash "$WIZ" help 2>&1 | grep -qi 'usage' \
  && t_ok "entrypoint: 'help' under bash prints usage" \
  || t_not_ok "bash help"

# unknown subcommand -> nonzero
bash "$WIZ" frobnicate >/dev/null 2>&1
[ $? -ne 0 ] && t_ok "entrypoint: unknown subcommand exits nonzero" \
  || t_not_ok "unknown subcommand exit code"

# zsh invocation must not crash
zsh -c "$WIZ --help" 2>&1 | grep -qi 'install the mac-llm-lab' \
  && t_ok "entrypoint: --help under zsh works (user-flagged)" \
  || t_not_ok "zsh --help"

zsh -c "$WIZ help" 2>&1 | grep -qi 'usage' \
  && t_ok "entrypoint: 'help' under zsh works" \
  || t_not_ok "zsh help"

# `wizard doctor` against an empty state must not crash and must exit 0.
rm -f "$RW/wizard/.state"
if bash "$WIZ" doctor >/dev/null 2>&1; then
  t_ok "entrypoint: 'doctor' against empty state exits 0"
else
  t_not_ok "doctor empty state"
fi

# ============================================================================
# 7. END-TO-END idempotency-while-hot SIM
# ============================================================================
hdr "7. idempotency-while-hot sim (no install invocations)"

# Stage stubs for ALL external commands the install path could touch.
mkdir -p "$SHIMS"
TRACE="$LOGS/install-trace.log"
: > "$TRACE"

# A logging shim — records every call. Returns success for everything we
# stub. If install code reaches here with these args, it should be a no-op
# query, not a mutation.
make_logger() {
  local name="$1" body="$2"
  # Expand any $TRACE refs in body before writing — the shim runs under
  # /bin/sh with no TRACE in env, so substitutions must happen here.
  body="${body//\$TRACE/$TRACE}"
  cat >"$SHIMS/$name" <<EOF
#!/bin/sh
echo "[$name] \$*" >> "$TRACE"
$body
EOF
  chmod +x "$SHIMS/$name"
}

# launchctl: pretend service is loaded.
make_logger launchctl 'exit 0'
# curl: pretend health probe + everything 200.
make_logger curl 'exit 0'
# docker: report "running" for managed containers, image inspect succeeds.
cat >"$SHIMS/docker" <<EOF
#!/bin/sh
echo "[docker] \$*" >> "$TRACE"
case "\$*" in
  info*) exit 0 ;;
  "inspect --format {{.State.Running}} "*) echo true ;;
  "inspect --format {{.State.Status}} "*)  echo running ;;
  "image inspect "*) exit 0 ;;
  "compose "*"up "*) echo "REFUSED: compose up should not run when already running" >> "$TRACE"; exit 99 ;;
  "compose "*"build"*) echo "REFUSED: compose build should be image-cached" >> "$TRACE"; exit 99 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$SHIMS/docker"

# xcode-select: already installed.
make_logger xcode-select 'echo /Library/Developer/CommandLineTools'
# cmake: already installed v3.30.5.
make_logger cmake 'echo "cmake version 3.30.5"'
# llama-server: pretend on PATH.
make_logger llama-server 'echo "llama-server version stub"'
# ollama: pretend on PATH.
make_logger ollama 'echo "ollama version stub"'
# git: claim everything cloned.
make_logger git 'exit 0'
# hdiutil/unzip: must NOT be invoked.
make_logger hdiutil 'echo "REFUSED: hdiutil should not run idempotent" >> "$TRACE"; exit 99'
make_logger unzip   'echo "REFUSED: unzip should not run idempotent"   >> "$TRACE"; exit 99'
# scutil/hostname for topology
cat >"$SHIMS/scutil" <<'EOF'
#!/bin/sh
echo mac-llm-lab
EOF
chmod +x "$SHIMS/scutil"
cat >"$SHIMS/hostname" <<'EOF'
#!/bin/sh
echo mac-llm-lab
EOF
chmod +x "$SHIMS/hostname"
# sysctl: 64GB.
make_sysctl $((64*1024*1024*1024))

# Stage state to look fully provisioned.
WIZARD_STATE_FILE="$RW/wizard/.state"
: > "$WIZARD_STATE_FILE"
state_set TOPOLOGY full-local
state_set TIER 64
state_set BRIDGE_HOST host.docker.internal
state_set BRIDGE_PORT 4000
state_set LITELLM_MASTER_KEY "sk-deadbeef$(printf 'x%.0s' $(seq 1 56))"
mkdir -p "$RW/client/claw-code" "$RW/host/litellm"
echo "LITELLM_MASTER_KEY=sk-test" > "$RW/client/claw-code/.env"
echo "LITELLM_MASTER_KEY=sk-test" > "$RW/host/litellm/.env"

# Stage a fake llama-server binary in $HOME/.local/bin
export HOME="$LOGS/fakehome"
mkdir -p "$HOME/.local/bin"
cp "$SHIMS/llama-server" "$HOME/.local/bin/llama-server" 2>/dev/null || true
mkdir -p "$HOME/.ollama/gguf"
# Fake GGUFs >1GB? Use sparse files so we don't actually write 4GB.
truncate -s 5G "$HOME/.ollama/gguf/Qwen2.5-7B-Instruct-Q5_K_M.gguf" 2>/dev/null \
  || dd if=/dev/zero of="$HOME/.ollama/gguf/Qwen2.5-7B-Instruct-Q5_K_M.gguf" bs=1 count=0 seek=5G 2>/dev/null

# Run install with stubbed PATH; capture all output.
export PATH="$SHIMS:/usr/bin:/bin"
INSTALL_LOG="$LOGS/install-while-hot.log"
( bash "$WIZ" install </dev/null > "$INSTALL_LOG" 2>&1 ) || true

# Inspect trace — REFUSED entries indicate actual mutation attempts.
if grep -q 'REFUSED' "$TRACE"; then
  t_not_ok "idempotency-while-hot: NO mutation calls" "see $TRACE"
  grep 'REFUSED' "$TRACE" | head -20 | sed 's/^/  # /'
else
  t_ok "idempotency-while-hot: zero mutation calls (compose up/build/hdiutil/unzip)"
fi

# Should see lots of skip lines
skip_count=$(grep -c 'already done' "$INSTALL_LOG" 2>/dev/null)
skip_count="${skip_count:-0}"
if [ "$skip_count" -ge 3 ]; then
  t_ok "idempotency-while-hot: $skip_count 'already done' skip lines printed"
else
  t_not_ok "skip lines visible" "only $skip_count — expected ≥3 (see $INSTALL_LOG)"
fi

export PATH="$ORIG_PATH"
rm -f "$SHIMS"/*

# ============================================================================
# 8. TESTER ORB smoke.sh dispatch table
# ============================================================================
hdr "8. tester orb smoke.sh modes"

SMOKE="$REPO/wizard/tester/smoke.sh"
if [ -x "$SMOKE" ] || [ -f "$SMOKE" ]; then
  bash -n "$SMOKE" && t_ok "smoke.sh parses under bash" || t_not_ok "smoke.sh parse"
  zsh  -n "$SMOKE" && t_ok "smoke.sh parses under zsh"  || t_not_ok "smoke.sh zsh parse"
  # invalid mode -> nonzero
  bash "$SMOKE" not-a-mode >/dev/null 2>&1
  [ $? -ne 0 ] && t_ok "smoke.sh: invalid mode exits nonzero" \
    || t_not_ok "smoke.sh invalid mode"
else
  t_skip "smoke.sh missing" ""
fi

# Default mode must be 'models', NOT 'deep' — the gate that protects the M5
# from spurious 1-token chat round-trips during install.
if grep -qE 'MODE.*:-\s*models' "$SMOKE" 2>/dev/null; then
  t_ok "smoke.sh: default mode is 'models' (not 'deep' — protects M5)"
else
  t_not_ok "smoke.sh default mode" "expected MODE:-models default"
fi
# 60-smoke.sh and probe_models must call models mode, not deep.
if grep -q 'probe_models\|/v1/models' "$REPO/wizard/steps/60-smoke.sh" 2>/dev/null \
   && ! grep -q 'probe_deep\|smoke.sh deep' "$REPO/wizard/steps/60-smoke.sh"; then
  t_ok "60-smoke.sh: calls models probe, not deep"
else
  t_not_ok "60-smoke.sh deep-gate" "step calls deep mode"
fi

# ============================================================================
# 9. NEGATIVE / FAILURE PATHS
# ============================================================================
hdr "9. negative paths"

# 9a. ensure_litellm_key with no openssl
WIZARD_STATE_FILE="$LOGS/state-no-ossl.txt"; rm -f "$WIZARD_STATE_FILE"
REPO_ROOT="$LOGS/empty-repo2"; mkdir -p "$REPO_ROOT"
mkdir -p "$SHIMS"
# Create a sandbox PATH that lacks openssl.
( export PATH="$SHIMS"; ensure_litellm_key >/dev/null 2>&1 )
[ $? -ne 0 ] && t_ok "ensure_litellm_key: no openssl on PATH -> nonzero" \
  || t_not_ok "ensure_litellm_key no openssl"

# 9b. render_template with empty src arg
render_template "" "$LOGS/x" "K=v" >/dev/null 2>&1
[ $? -ne 0 ] && t_ok "render_template: empty src -> nonzero" \
  || t_not_ok "render_template empty src"

# 9c. slider with single option returns it immediately on Enter
out=$(printf '\n' | TERM=dumb slider_pick "single" only 2>/dev/null)
[ "$out" = "only" ] && t_ok "slider with N=1 returns the only option" \
  || t_not_ok "slider N=1" "got [$out]"

# ============================================================================
# SUMMARY
# ============================================================================
printf '\n1..%d\n' "$N"
printf '# pass: %d  fail: %d  skip: %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '# FAILED:\n'
  for f in "${FAILS[@]}"; do printf '#   - %s\n' "$f"; done
  exit 1
fi
exit 0
