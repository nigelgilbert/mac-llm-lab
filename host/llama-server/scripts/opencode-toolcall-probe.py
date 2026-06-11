#!/usr/bin/env python3
"""opencode-toolcall-probe.py — go/no-go gate for the hybrid "opencode-a+grammar" arm.

Does NATIVE tool_calls parsing survive a global --grammar-file on the OpenCode
llama-server?  Pure client against an OpenAI-compatible /v1/chat/completions endpoint.

WHY THIS EXISTS.  claw.gbnf was authored for the CLAW path, where the grammar
constrains *raw text* and LiteLLM/claw-code parse the `<tool_call>{...}</tool_call>`
wrapper downstream — the claw llama-server runs NO --jinja (plist: --grammar-file +
--chat-template-kwargs only).  The OpenCode server is the opposite: --jinja + the
corrected template, and it relies on llama.cpp's OWN parser to turn `<tool_call>` into
OpenAI `tool_calls`.  Stacking a global --grammar-file ON TOP of that --jinja tool path
is unproven: if the launch-time grammar and the per-request tools-derived grammar
conflict, tool_calls can stop being parsed and the wrapper leaks into message.content.

THE GATE.  Run this battery against the server booted WITHOUT grammar (baseline) and
WITH it.  A grammar-on run is RED if any tool case FAILs (HTTP error, raw `<tool_call>`
leak, or malformed/object arguments) and GREEN if tool_calls parse cleanly and prose
still flows.  A model simply *choosing* prose over a tool (INCONC) is not a parse break.

Usage:
  BASE=http://127.0.0.1:11437 python3 opencode-toolcall-probe.py --label grammar-on
Exit 0 iff no FAILs (INCONC tolerated); 1 otherwise.
"""
import argparse, json, os, sys, urllib.request, urllib.error


def post(base, payload, timeout=120):
    req = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json",
                 "authorization": "Bearer sk-local-no-auth"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode(errors="replace")}
    except Exception as e:  # noqa: BLE001 — surface any transport error as a check result
        return 0, {"_error": repr(e)}


WRITE_FILE = {"type": "function", "function": {
    "name": "write_file", "description": "Write text to a file in the workspace.",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "description": "file path"},
        "content": {"type": "string", "description": "file contents"}},
        "required": ["path", "content"]}}}

SEARCH_REPLACE = {"type": "function", "function": {
    "name": "search_replace", "description": "Replace an exact string in a file.",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string"}, "old": {"type": "string"}, "new": {"type": "string"}},
        "required": ["path", "old", "new"]}}}


def check_toolcall(name, base, model, tools, user, want_tool, want_keys, tool_choice, outdir):
    payload = {"model": model, "messages": [{"role": "user", "content": user}],
               "tools": tools, "tool_choice": tool_choice,
               "max_tokens": 512, "temperature": 0.2}
    status, body = post(base, payload)
    if outdir:
        with open(os.path.join(outdir, name + ".json"), "w") as fh:
            json.dump(body, fh, indent=2)
    if status != 200:
        return False, f"{name} (tc={tool_choice}): HTTP {status} — {str(body.get('_error',''))[:200]}"
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message", {}) or {}
    fr = choice.get("finish_reason")
    tcs = msg.get("tool_calls") or []
    content = msg.get("content") or ""
    # Parity with validate-tool-calls.sh: a leak is the wrapper OR the inner syntax —
    # the corrected qwen templates emit `<tool_call>\n<function=...`, so a stray
    # `<function=` without the wrapper is just as much a parse break.
    leak = "<tool_call>" in content or "<function=" in content
    if not tcs:
        if leak:
            return False, (f"{name} (tc={tool_choice}): NO tool_calls but raw <tool_call>/<function=> "
                           f"XML LEAKED into content (finish={fr}) → PARSING BROKE")
        return None, (f"{name} (tc={tool_choice}): model returned prose, no tool_call "
                      f"(finish={fr}); content[:80]={content[:80]!r} — inconclusive, not a parse break")
    fn = tcs[0].get("function", {}) or {}
    nm, args = fn.get("name"), fn.get("arguments")
    ok_name = nm == want_tool
    ok_str = isinstance(args, str)            # #20198: arguments MUST be a JSON string
    parsed, ok_parse = None, False
    if ok_str:
        try:
            parsed, ok_parse = json.loads(args), True
        except Exception:
            ok_parse = False
    elif isinstance(args, dict):              # object-vs-string regression — record but fail ok_str
        parsed, ok_parse = args, True
    ok_keys = ok_parse and isinstance(parsed, dict) and all(k in parsed for k in want_keys)
    ok = bool(ok_name and ok_str and ok_parse and ok_keys)
    return ok, (f"{name} (tc={tool_choice}): tool_calls={len(tcs)} name={nm!r}(want {want_tool!r}:{ok_name}) "
                f"args_is_string={ok_str} args_parses={ok_parse} keys{want_keys}={ok_keys} finish={fr}")


def check_prose(base, model, outdir):
    payload = {"model": model, "messages": [{"role": "user",
               "content": "Reply with exactly one short sentence. What is 2+2?"}],
               "max_tokens": 128, "temperature": 0.2}
    status, body = post(base, payload)
    if outdir:
        with open(os.path.join(outdir, "T2.prose.json"), "w") as fh:
            json.dump(body, fh, indent=2)
    if status != 200:
        return False, f"T2.prose: HTTP {status} — {str(body.get('_error',''))[:200]}"
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message", {}) or {}
    content = msg.get("content") or ""
    fr = choice.get("finish_reason")
    if msg.get("tool_calls"):
        return False, f"T2.prose: unexpected tool_calls on a prose request (finish={fr})"
    if not content.strip():
        return False, f"T2.prose: EMPTY content (finish={fr}) — grammar may be blocking prose"
    return True, f"T2.prose: ok content[:60]={content.strip()[:60]!r} finish={fr}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("BASE", "http://127.0.0.1:11437"))
    ap.add_argument("--model", default=os.environ.get("MODEL", "opencode-16"))
    ap.add_argument("--label", default="?")
    ap.add_argument("--outdir", default="")
    a = ap.parse_args()
    if a.outdir:
        os.makedirs(a.outdir, exist_ok=True)
    print(f"=== tool-call parse probe [{a.label}]  {a.base}  model={a.model} ===")
    results = [
        # auto = the realistic OpenCode path (model decides). required = forced parse stress.
        check_toolcall("T1.write_file.auto", a.base, a.model, [WRITE_FILE],
                       "Create the file report.txt containing exactly: hello world. "
                       "Call the write_file tool to do it. Do not ask for confirmation.",
                       "write_file", ["path", "content"], "auto", a.outdir),
        check_toolcall("T3.search_replace.auto", a.base, a.model, [SEARCH_REPLACE],
                       "In config.json, change the port value from 8080 to 9090. "
                       "Use the search_replace tool. Do not ask for confirmation.",
                       "search_replace", ["path", "old", "new"], "auto", a.outdir),
        check_toolcall("T4.write_file.required", a.base, a.model, [WRITE_FILE],
                       "Create the file notes.txt with the contents: ok.",
                       "write_file", ["path", "content"], "required", a.outdir),
        check_prose(a.base, a.model, a.outdir),
    ]
    for ok, detail in results:
        tag = "PASS" if ok is True else ("FAIL" if ok is False else "INCONC")
        print(f"  [{tag}] {detail}")
    fails = [d for ok, d in results if ok is False]
    tool_pass = any(ok is True and d.startswith(("T1", "T3", "T4")) for ok, d in results)
    verdict = ("RED — %d parse FAIL(s)" % len(fails) if fails
               else ("GREEN — tool_calls parse cleanly" if tool_pass
                     else "AMBER — no parse break, but model never emitted a tool_call (re-run)"))
    print(f"--- [{a.label}] VERDICT: {verdict} ---")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
