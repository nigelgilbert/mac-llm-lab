#!/usr/bin/env bash
# ============================================================================
# validate-tool-calls.sh — LIVE native tool-call validation for the
# OpenCode-dedicated llama-server (Config B, :11436).  Issue #006.
#
# This is the single biggest empirical risk in the OpenCode A/B effort: prove
# tool-calls fire END-TO-END on Qwen3.6-35B-A3B + llama.cpp on this Mac BEFORE
# any container/runner work depends on it.  Unlike templates/verify-template.sh
# (which only exercises /apply-template — template formatting, no inference),
# this driver does REAL generation: POST /v1/chat/completions with a tools spec
# and a forcing prompt, then inspects what the model actually emitted.
#
# It proves the three things the setup guide flagged as unverified:
#   (1) PARSED emission — choices[].message.tool_calls[] is populated, and the
#       raw <tool_call>/<function=...> XML is NOT sitting in message.content
#       (the "naked-XML freeze", opencode#24316 / llama.cpp#20260).
#   (2) no prose-before-<tool_call> parse failure on the live path.
#   (3) the llama.cpp#20198 arguments-type behavior on build 5594d13 —
#       tool_calls[].function.arguments as a JSON STRING (OpenAI-strict) vs a
#       JSON OBJECT — documented, so the runner can shim if needed.
#
# It runs the battery BOTH non-streaming AND streaming (stream:true is the path
# OpenCode actually uses; the freeze could in principle be streaming-specific),
# over 3 distinct tool-bearing prompts x REPEATS, using the server's own tuned
# sampler (temp 0.7 etc — we send NO sampler overrides), so a lucky single pass
# can't mask a flaky freeze.  Read-only against the server; it only POSTs chat
# completions and NEVER touches the claw server on :11435.
#
# Findings on build 5594d13 are written up in:
#   host/llama-server/docs/TOOL-CALL-VALIDATION.md
#
# Usage:
#   ./validate-tool-calls.sh                 # full battery (non-stream + stream)
#   REPEATS=3 ./validate-tool-calls.sh       # more samples per prompt (default 2)
#   SAVE_DIR=/tmp/tc006 ./validate-tool-calls.sh   # also dump raw responses
#   BASE=http://127.0.0.1:11436 ./validate-tool-calls.sh
#   # tier-16 reuse (#018): BASE=http://127.0.0.1:11437 MODEL=opencode-16 ./validate-tool-calls.sh
#   #   → host/llama-server/docs/TOOL-CALL-VALIDATION-TIER16.md (Qwen3.5-9B verdict)
#
# Exit 0 iff every run (both modes) emitted a parsed tool_calls[], no XML leak.
# ============================================================================
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:11436}"
REPEATS="${REPEATS:-2}"
SAVE_DIR="${SAVE_DIR:-}"
MODEL="${MODEL:-opencode}"

command -v python3 >/dev/null || { echo "ERROR: python3 required" >&2; exit 1; }
[[ -z "$SAVE_DIR" ]] || mkdir -p "$SAVE_DIR"

# --- preflight: server must be green (don't generate against a cold/missing server)
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)"
if [[ "$code" != "200" ]]; then
  echo "ERROR: server not green at $BASE/health (got HTTP $code)." >&2
  echo "       start it first:  host/llama-server/scripts/opencode-server start" >&2
  exit 1
fi

# --- shared toolset (OpenAI function format) — present in EVERY request, so the
#     model must SELECT the right tool, not just emit the only one available.
export TOOLS_JSON='[
  {"type":"function","function":{
    "name":"write_file",
    "description":"Write text content to a file at the given path, creating or overwriting it.",
    "parameters":{"type":"object","properties":{
      "path":{"type":"string","description":"File path to write"},
      "content":{"type":"string","description":"Exact text content to write"}
    },"required":["path","content"]}}},
  {"type":"function","function":{
    "name":"read_file",
    "description":"Read and return the contents of a file at the given path.",
    "parameters":{"type":"object","properties":{
      "path":{"type":"string","description":"File path to read"}
    },"required":["path"]}}},
  {"type":"function","function":{
    "name":"run_command",
    "description":"Run a shell command in the workspace and return its output.",
    "parameters":{"type":"object","properties":{
      "command":{"type":"string","description":"The shell command to run"}
    },"required":["command"]}}}
]'

export SYS="You are a coding agent operating in a sandboxed workspace. Use the provided tools to take actions directly. Do not ask for confirmation and do not explain — just call the appropriate tool."

# --- test matrix: name | expected-tool | forcing prompt -----------------------
CASES=(
  "write|write_file|Create a file named x.py containing exactly this single line: print(1)"
  "read|read_file|Show me the current contents of the file config.json"
  "command|run_command|List the files in the current working directory"
)

# build a request body from $SYS / $PROMPT / $TOOLS_JSON  (python = no bash JSON hell).
# STREAM=true/false toggles the stream flag.
build_body() {
  PROMPT="$1" STREAM="$2" python3 - <<'PY'
import json, os
print(json.dumps({
    "model": os.environ.get("MODEL_ID","opencode"),
    "messages": [
        {"role": "system", "content": os.environ["SYS"]},
        {"role": "user",   "content": os.environ["PROMPT"]},
    ],
    "tools": json.loads(os.environ["TOOLS_JSON"]),
    "tool_choice": "auto",                       # native decision, NOT forced (mirrors OpenCode)
    "stream": os.environ["STREAM"] == "true",
}))
PY
}

# assert a NON-STREAMING json response. Prints a verdict block + machine tokens.
assert_nonstream() {
  CASE="$1" EXPECTED="$2" RESP_FILE="$3" python3 - <<'PY'
import json, os
case=os.environ["CASE"]; expected=os.environ["EXPECTED"]
try:
    d=json.loads(open(os.environ["RESP_FILE"]).read(), strict=False)
except Exception as e:
    print(f"  FAIL  not JSON: {e}\nVERDICT=FAIL\nARGS_TYPE=none\nSELECTED="); raise SystemExit
if d.get("error") and not d.get("choices"):
    print(f"  FAIL  server error: {json.dumps(d['error'])[:200]}\nVERDICT=FAIL\nARGS_TYPE=none\nSELECTED="); raise SystemExit
ch=(d.get("choices") or [{}])[0]; msg=ch.get("message") or {}
fr=ch.get("finish_reason"); tcs=msg.get("tool_calls") or []
content=msg.get("content") or ""; reasoning=msg.get("reasoning_content") or ""
ok=True; notes=[]
if tcs: notes.append(f"tool_calls[]: {len(tcs)} PARSED")
else:   ok=False; notes.append("tool_calls[]: MISSING/empty")
if "<tool_call>" in content or "<function=" in content:
    ok=False; notes.append("content: RAW <tool_call>/<function=> XML LEAK -> naked-XML freeze")
else:
    notes.append(f"content: clean ({'empty' if not content else repr(content[:80])})")
notes.append(f"finish_reason: {fr}" + ("" if fr=="tool_calls" else "  (expected tool_calls)"))
if reasoning: notes.append(f"reasoning_content present (len {len(reasoning)})")
argtype=None; details=[]; selected=[]
for tc in tcs:
    fn=tc.get("function") or {}; name=fn.get("name"); selected.append(name or "?")
    args=fn.get("arguments"); tn=type(args).__name__
    if argtype is None: argtype=tn
    if isinstance(args,str):
        try:
            p=json.loads(args); details.append(f"{name}: arguments=STRING -> valid JSON keys={list(p.keys())} {json.dumps(p)[:120]}")
        except Exception as e:
            ok=False; details.append(f"{name}: arguments=STRING but NOT valid JSON: {e}")
    elif isinstance(args,dict):
        details.append(f"{name}: arguments=OBJECT keys={list(args.keys())}  <-- #20198 (not OpenAI-strict)")
    else:
        ok=False; details.append(f"{name}: arguments type {tn} (unexpected)")
print(f"  {'PASS' if ok else 'FAIL'}  (expected ~ {expected}; got: {','.join(selected) or 'none'})")
for n in notes:   print(f"      - {n}")
for dd in details:print(f"      · {dd}")
print(f"VERDICT={'PASS' if ok else 'FAIL'}")
print(f"ARGS_TYPE={'string' if argtype=='str' else ('object' if argtype=='dict' else (argtype or 'none'))}")
print(f"SELECTED={','.join(selected)}")
PY
}

# assert a STREAMING SSE response (the path OpenCode uses). tool calls must arrive
# as delta.tool_calls[] fragments, NOT as <tool_call> XML in delta.content.
assert_stream() {
  CASE="$1" EXPECTED="$2" SSE_FILE="$3" python3 - <<'PY'
import json, os
case=os.environ["CASE"]; expected=os.environ["EXPECTED"]
content=""; argfrag=""; names=[]; fr=None; saw_delta=False
for ln in open(os.environ["SSE_FILE"]).read().splitlines():
    if not ln.startswith("data:"): continue
    p=ln[5:].strip()
    if p=="[DONE]" or not p: continue
    try: ev=json.loads(p)
    except Exception: continue
    ch=(ev.get("choices") or [{}])[0]; d=ch.get("delta") or {}
    if ch.get("finish_reason"): fr=ch["finish_reason"]
    if d.get("content"): content+=d["content"]
    for tc in (d.get("tool_calls") or []):
        saw_delta=True; fn=tc.get("function") or {}
        if fn.get("name"): names.append(fn["name"])
        if fn.get("arguments"): argfrag+=fn["arguments"]
ok=True; notes=[]
if saw_delta: notes.append(f"delta.tool_calls: streamed ({len(names)} name(s))")
else:         ok=False; notes.append("delta.tool_calls: NONE (no streamed tool call)")
if "<tool_call>" in content or "<function=" in content:
    ok=False; notes.append("delta.content: RAW <tool_call>/<function=> XML LEAK -> naked-XML freeze")
else:
    notes.append(f"delta.content: clean ({'empty' if not content else repr(content[:80])})")
notes.append(f"finish_reason: {fr}" + ("" if fr=="tool_calls" else "  (expected tool_calls)"))
# reassembled arguments must be a valid JSON string
argtype="none"
if argfrag:
    try:
        p=json.loads(argfrag); argtype="string"
        notes.append(f"reassembled args=STRING -> valid JSON keys={list(p.keys())} {json.dumps(p)[:100]}")
    except Exception as e:
        ok=False; notes.append(f"reassembled args NOT valid JSON: {e} :: {argfrag[:80]!r}")
print(f"  {'PASS' if ok else 'FAIL'}  (expected ~ {expected}; got: {','.join(names) or 'none'})")
for n in notes: print(f"      - {n}")
print(f"VERDICT={'PASS' if ok else 'FAIL'}")
print(f"ARGS_TYPE={argtype}")
print(f"SELECTED={','.join(names)}")
PY
}

echo "=============================================================================="
echo " #006 LIVE tool-call validation — $BASE  model=$MODEL  (build 5594d13)"
echo " battery: ${#CASES[@]} prompts x ${REPEATS} repeats x 2 modes (non-stream + stream)"
echo "        = $(( ${#CASES[@]} * REPEATS * 2 )) live generations"
echo "=============================================================================="

total=0; passed=0; declare -a ARGS_TYPES=()
tmpbody="$(mktemp)"; tmpresp="$(mktemp)"
trap 'rm -f "$tmpbody" "$tmpresp"' EXIT

# returns the machine-token value for KEY from a captured verdict block
tok() { echo "$1" | grep "^$2=" | head -1 | cut -d= -f2-; }

for mode in nonstream stream; do
  echo
  echo "################################  MODE: $mode  ################################"
  [[ "$mode" == stream ]] && streamflag=true || streamflag=false
  for entry in "${CASES[@]}"; do
    IFS='|' read -r cname expected prompt <<<"$entry"
    for r in $(seq 1 "$REPEATS"); do
      total=$((total+1)); label="${mode}:${cname}#${r}"
      MODEL_ID="$MODEL" build_body "$prompt" "$streamflag" > "$tmpbody"
      echo; echo "── [$label] prompt: $prompt"
      if [[ "$mode" == stream ]]; then
        http="$(curl -s -N -o "$tmpresp" -w '%{http_code}' -X POST "$BASE/v1/chat/completions" \
                -H 'content-type: application/json' --data @"$tmpbody" 2>/dev/null || echo 000)"
      else
        http="$(curl -s -o "$tmpresp" -w '%{http_code}' -X POST "$BASE/v1/chat/completions" \
                -H 'content-type: application/json' --data @"$tmpbody" 2>/dev/null || echo 000)"
      fi
      [[ -n "$SAVE_DIR" ]] && { cp "$tmpresp" "$SAVE_DIR/$label"; cp "$tmpbody" "$SAVE_DIR/$label.req"; }
      if [[ "$http" != "200" ]]; then
        echo "  FAIL  HTTP $http"; [[ -s "$tmpresp" ]] && head -c 300 "$tmpresp" | sed 's/^/      /'; continue
      fi
      if [[ "$mode" == stream ]]; then out="$(assert_stream "$label" "$expected" "$tmpresp")"
      else                            out="$(assert_nonstream "$label" "$expected" "$tmpresp")"; fi
      echo "$out" | grep -v '^VERDICT=\|^ARGS_TYPE=\|^SELECTED='
      [[ "$(tok "$out" VERDICT)" == "PASS" ]] && passed=$((passed+1))
      ARGS_TYPES+=("$(tok "$out" ARGS_TYPE)")
    done
  done
done

echo
echo "=============================================================================="
echo " SUMMARY: $passed/$total runs emitted a parsed tool_calls[] with no XML leak"
uniq_types="$(printf '%s\n' "${ARGS_TYPES[@]}" | sort -u | grep -v '^none$' | paste -sd, -)"
echo " arguments type (build 5594d13, #20198): ${uniq_types:-unknown}  (STRING = OpenAI-strict, no shim)"
echo "=============================================================================="
echo
echo "Re-run ONE case by hand (the exact request shape this script sends):"
echo "  curl -s $BASE/v1/chat/completions -H 'content-type: application/json' \\"
echo "    -d '{\"model\":\"$MODEL\",\"tool_choice\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"Create a file x.py containing print(1)\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"write_file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"path\",\"content\"]}}}]}' | python3 -m json.tool"
echo
[[ "$passed" -eq "$total" ]] || { echo "RESULT: FAIL ($((total-passed)) run(s) did not produce a clean parsed tool call)"; exit 1; }
echo "RESULT: PASS (all $total runs produced a parsed tool_calls[] natively, no naked-XML freeze)"
