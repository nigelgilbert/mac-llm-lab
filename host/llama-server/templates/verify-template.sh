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
# production claw llama-server on :11435.
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
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true; }
trap cleanup EXIT

boot() { # $1 = template file
  cleanup; SRV_PID=""
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
POUT=/tmp/_tplv_prompt.txt
RCODE=""
render() {
  RCODE=$(curl -s -o /tmp/_tplv.json -w '%{http_code}' -X POST "$BASE/apply-template" \
    -H 'content-type: application/json' -d "$1")
  python3 -c "import json; d=json.load(open('/tmp/_tplv.json')); print(d.get('prompt',''))" \
    > "$POUT" 2>/dev/null || : > "$POUT"
}

# message-shape fixtures
M_SYS_NOT_FIRST='{"messages":[{"role":"user","content":"hi"},{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"2+2?"}]}'
M_TOOLS_SYS_NOT_FIRST='{"messages":[{"role":"user","content":"hi"},{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"make x.py"}],"tools":[{"type":"function","function":{"name":"write_file","description":"w","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]}'
M_SYS_FIRST='{"messages":[{"role":"system","content":"SYSTEM_SENTINEL_42"},{"role":"user","content":"hi"}]}'
M_TOOLCALL='{"messages":[{"role":"user","content":"make x.py"},{"role":"assistant","content":null,"tool_calls":[{"type":"function","function":{"name":"write_file","arguments":{"path":"x.py","content":"print(1)"}}}]},{"role":"tool","content":"ok"}],"tools":[{"type":"function","function":{"name":"write_file","description":"w","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}]}'
M_THINK_OFF='{"messages":[{"role":"user","content":"hi"}],"chat_template_kwargs":{"enable_thinking":false}}'
M_THINK_ON='{"messages":[{"role":"user","content":"hi"}],"chat_template_kwargs":{"enable_thinking":true}}'

PASS=0; FAIL=0
check() { # $1 desc ; $2 condition(0/1 via test outside) -- helper prints result
  if [ "$2" = "ok" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi
}
has() { case "$1" in *"$2"*) echo ok;; *) echo no;; esac; }

if [ "${1:-}" = "--diff" ]; then
  # Extract the stock template from the tier-64 GGUF and diff behaviour.
  STOCK="$(mktemp -t qwen36stock.XXXXXX.jinja)"
  PYTHONPATH="$HOME/src/llama.cpp/gguf-py" python3 - "$STOCK" <<'PY'
import sys
from gguf import GGUFReader
r = GGUFReader(f"{__import__('os').path.expanduser('~')}/.ollama/gguf/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")
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
