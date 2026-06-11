#!/usr/bin/env bash
# ============================================================================
# verify-template.sh — reproducible, on-hardware check of the corrected
# Qwen3.6 chat template (mac-llm-lab issue #004).
#
# Renders a battery of message shapes through the REAL llama.cpp minja engine
# via llama-server's /apply-template endpoint (no inference, no GPU work — the
# 500/drop bug lives in template formatting, which /apply-template exercises in
# full). The model weights are irrelevant to template rendering, so any small
# GGUF works as a load vehicle; --chat-template-file overrides whatever template
# the GGUF ships.
#
# Usage:
#   ./verify-template.sh                 # assert the corrected template passes
#   ./verify-template.sh --diff          # diff corrected vs the stock GGUF template
#   TEMPLATE=/path/to.jinja ./verify-template.sh
#   MODEL=/path/to/vehicle.gguf PORT=18080 ./verify-template.sh
#
# Exits non-zero if any acceptance check fails. Boots a throwaway server on its
# own PORT (default 18080) and tears it down on exit; it NEVER touches the
# resident opencode-server llama-server on :11436 (or any other tier port —
# see host/llama-server/tiers.conf).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${TEMPLATE:-$SCRIPT_DIR/qwen36-corrected.jinja}"
PORT="${PORT:-18080}"
HOST=127.0.0.1
BASE="http://$HOST:$PORT"
LLAMA_SERVER="${LLAMA_SERVER:-$HOME/.local/bin/llama-server}"

# Pick a small GGUF as a load vehicle (template rendering is weight-independent).
pick_model() {
  if [ -n "${MODEL:-}" ]; then echo "$MODEL"; return; fi
  for f in \
    "$HOME/.ollama/gguf/Qwen3.5-9B-IQ4_XS.gguf" \
    "$HOME/.ollama/gguf/Qwen3-8B-Q4_K_M.gguf" \
    "$HOME/.ollama/gguf/Qwen2.5-7B-Instruct-Q5_K_M.gguf"; do
    [ -f "$f" ] && { echo "$f"; return; }
  done
  echo "ERROR: no vehicle GGUF found; set MODEL=" >&2; exit 2
}
MODEL="$(pick_model)"

LOG="$(mktemp -t tplverify.XXXXXX.log)"
SRV_PID=""
STOP_TIMEOUT="${STOP_TIMEOUT:-30}"  # SIGTERM grace before SIGKILL (multi-GB unload)
cleanup() {
  if [ -n "$SRV_PID" ] && kill -0 "$SRV_PID" 2>/dev/null; then
    kill "$SRV_PID" 2>/dev/null || true
    # Bounded wait for the dying server to actually exit (#028; mirrors
    # opencode-server cmd_stop from the #005 remediation): a multi-GB
    # llama-server can take seconds to unload, and without this wait the
    # next boot()'s lsof preflight sees the dying server still LISTENing
    # and exits 2 "port busy" — reliably failing the second --diff boot.
    local waited=0
    while kill -0 "$SRV_PID" 2>/dev/null && [ "$waited" -lt "$STOP_TIMEOUT" ]; do
      sleep 1; waited=$((waited+1))
    done
    if kill -0 "$SRV_PID" 2>/dev/null; then
      echo "  pid $SRV_PID still alive ${STOP_TIMEOUT}s after SIGTERM — escalating to SIGKILL" >&2
      kill -9 "$SRV_PID" 2>/dev/null || true
      sleep 1
    fi
    # brief grace so the kernel releases the LISTEN socket before any re-bind
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      lsof -nP -iTCP:"$PORT" 2>/dev/null | grep -q LISTEN || break; sleep 1
    done
  fi
  SRV_PID=""
}
# EXIT trap (#028 follow-up): the scratch renders are always removed, but the
# server LOG is removed only on SUCCESS — on any failure it survives with its
# path printed, since it is the primary diagnostic (boot errors, template
# parse errors). Prior runs leaked one log per invocation into $TMPDIR.
on_exit() {
  rc=$?
  cleanup
  rm -f "${RJSON:-}" "${POUT:-}"
  if [ "$rc" -eq 0 ]; then
    rm -f "$LOG"
  else
    echo "server log kept for diagnostics: $LOG" >&2
  fi
}
trap on_exit EXIT

boot() { # $1 = template file
  cleanup
  if lsof -nP -iTCP:"$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "ERROR: port $PORT busy (refusing to touch it)"; exit 2
  fi
  "$LLAMA_SERVER" --model "$MODEL" --alias tplverify --jinja \
    --chat-template-file "$1" --host "$HOST" --port "$PORT" \
    --ctx-size 2048 -ngl 999 --no-warmup > "$LOG" 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  echo "ERROR: server failed to come up; log tail:"; tail -20 "$LOG"; exit 2
}

# render <json-body>: sets global RCODE and writes prompt text to $POUT.
# Must NOT be called inside $(...) — that would run it in a subshell and lose RCODE.
# Per-invocation mktemp scratch (#028): fixed /tmp paths made concurrent runs
# clobber each other's renders. Cleaned up in the EXIT trap above.
POUT="$(mktemp -t tplv_prompt.XXXXXX.txt)"
RJSON="$(mktemp -t tplv_resp.XXXXXX.json)"
echo "scratch  : json=$RJSON prompt=$POUT"
RCODE=""
render() {
  RCODE=$(curl -s -o "$RJSON" -w '%{http_code}' -X POST "$BASE/apply-template" \
    -H 'content-type: application/json' -d "$1")
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('prompt',''))" "$RJSON" \
    > "$POUT" 2>/dev/null || : > "$POUT"
}

# message-shape fixtures
M_SYS_NOT_FIRST='{"messages":[{"role":"user","content":"hi"},{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"2+2?"}]}'
M_TOOLS_SYS_NOT_FIRST='{"messages":[{"role":"user","content":"hi"},{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"make x.py"}],"tools":[{"type":"function","function":{"name":"write_file","description":"w","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]}'
M_SYS_FIRST='{"messages":[{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"hi"}]}'
M_TOOLCALL='{"messages":[{"role":"user","content":"make x.py"},{"role":"assistant","content":null,"tool_calls":[{"type":"function","function":{"name":"write_file","arguments":{"path":"x.py","content":"print(1)"}}}]},{"role":"tool","content":"ok"}],"tools":[{"type":"function","function":{"name":"write_file","description":"w","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}]}'
# #028: identical to M_TOOLCALL except "arguments" is the OpenAI-wire JSON
# *string* (what OpenCode echoes back in multi-turn history), not an object.
# The corrected templates gate the parameter loop on `arguments is mapping`,
# so this render only contains <parameter=...> lines if minja's
# requires_object_arguments polyfill converts string→object first. The
# fixture pins that polyfill against llama.cpp build upgrades.
M_TOOLCALL_STRARGS='{"messages":[{"role":"user","content":"make x.py"},{"role":"assistant","content":null,"tool_calls":[{"type":"function","function":{"name":"write_file","arguments":"{\"path\":\"x.py\",\"content\":\"print(1)\"}"}}]},{"role":"tool","content":"ok"}],"tools":[{"type":"function","function":{"name":"write_file","description":"w","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}]}'
M_THINK_OFF='{"messages":[{"role":"user","content":"hi"}],"chat_template_kwargs":{"enable_thinking":false}}'
M_THINK_ON='{"messages":[{"role":"user","content":"hi"}],"chat_template_kwargs":{"enable_thinking":true}}'

PASS=0; FAIL=0
check() { # $1 desc ; $2 condition(0/1 via test outside) -- helper prints result
  if [ "$2" = "ok" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi
}
has() { case "$1" in *"$2"*) echo ok;; *) echo no;; esac; }

if [ "${1:-}" = "--diff" ]; then
  # Extract the stock template from a GGUF and diff behaviour. Defaults to the
  # tier-64 35B; override STOCK_GGUF= to diff the tier-16 9B (#018) or any other.
  STOCK_GGUF="${STOCK_GGUF:-$HOME/.ollama/gguf/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf}"
  STOCK="$(mktemp -t qwenstock.XXXXXX.jinja)"
  STOCK_GGUF="$STOCK_GGUF" PYTHONPATH="$HOME/src/llama.cpp/gguf-py" python3 - "$STOCK" <<'PY'
import sys, os
from gguf import GGUFReader
r = GGUFReader(os.environ["STOCK_GGUF"])
open(sys.argv[1],'w').write(r.get_field('tokenizer.chat_template').contents())
PY
  echo "== STOCK (embedded) on system-not-first =="
  boot "$STOCK";   render "$M_SYS_NOT_FIRST"; S_OUT="$(cat "$POUT")"; echo "$S_OUT" | sed 's/^/   /'
  echo "== CORRECTED on system-not-first =="
  boot "$TEMPLATE"; render "$M_SYS_NOT_FIRST"; C_OUT="$(cat "$POUT")"; echo "$C_OUT" | sed 's/^/   /'
  echo; echo "stock contains SYSTEM_SENTINEL_42:    $(has "$S_OUT" SYSTEM_SENTINEL_42)"
  echo "corrected contains SYSTEM_SENTINEL_42: $(has "$C_OUT" SYSTEM_SENTINEL_42)"
  exit 0
fi

echo "Template : $TEMPLATE"
echo "Vehicle  : $MODEL"
echo "Engine   : $($LLAMA_SERVER --version 2>&1 | grep -i '^version:' | head -1)"
echo
boot "$TEMPLATE"

echo "[AC: system-not-first no longer 500s / drops]"
render "$M_SYS_NOT_FIRST"; OUT="$(cat "$POUT")"
check "system-not-first returns HTTP 200 (was 500 upstream)" "$([ "$RCODE" = 200 ] && echo ok || echo no)"
check "system-not-first preserves system content (was dropped)" "$(has "$OUT" SYSTEM_SENTINEL_42)"
check "system-not-first emits an <|im_start|>system block" "$(has "$OUT" '<|im_start|>system')"

render "$M_TOOLS_SYS_NOT_FIRST"; OUT="$(cat "$POUT")"
check "tools + system-not-first returns HTTP 200" "$([ "$RCODE" = 200 ] && echo ok || echo no)"
check "tools + system-not-first preserves system content" "$(has "$OUT" SYSTEM_SENTINEL_42)"

echo "[AC: native <tool_call> emission preserved]"
render "$M_TOOLCALL"; OUT="$(cat "$POUT")"
check "tool_call returns HTTP 200" "$([ "$RCODE" = 200 ] && echo ok || echo no)"
check "emits <tool_call> wrapper" "$(has "$OUT" '<tool_call>')"
check "emits <function=write_file>" "$(has "$OUT" '<function=write_file>')"
check "emits <parameter=path>" "$(has "$OUT" '<parameter=path>')"
check "emits <tool_response> for tool role" "$(has "$OUT" '<tool_response>')"

echo "[AC #028: string-arguments history (OpenAI wire) still re-renders parameters]"
render "$M_TOOLCALL_STRARGS"; OUT="$(cat "$POUT")"
check "string-args tool_call returns HTTP 200" "$([ "$RCODE" = 200 ] && echo ok || echo no)"
check "string-args emits <function=write_file>" "$(has "$OUT" '<function=write_file>')"
check "string-args emits <parameter=path> (polyfill string->object)" "$(has "$OUT" '<parameter=path>')"
check "string-args emits <parameter=content>" "$(has "$OUT" '<parameter=content>')"

echo "[AC: enable_thinking kwargs honored]"
render "$M_THINK_OFF"; OUT="$(cat "$POUT")"
check "enable_thinking=false -> closed <think>\\n\\n</think> prefill" "$(has "$OUT" '<think>

</think>')"
render "$M_THINK_ON"; OUT="$(cat "$POUT")"
# thinking ON ends with an OPEN think block (no immediate close)
check "enable_thinking=true -> open <think> prefill (no close)" "$([ "$(has "$OUT" '<think>

</think>')" = no ] && [ "$(has "$OUT" '<think>')" = ok ] && echo ok || echo no)"

echo "[regression: system-first path unchanged]"
render "$M_SYS_FIRST"; OUT="$(cat "$POUT")"
check "system-first preserves system content" "$(has "$OUT" SYSTEM_SENTINEL_42)"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
