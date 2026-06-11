#!/usr/bin/env python3
"""opencode-grammar-active-probe.py — is claw.gbnf ACTUALLY constraining generation
on the --jinja OpenCode server, or is it silently overridden when `tools` are present?

This is the companion to opencode-toolcall-probe.py. The parse-safety probe shows the
grammar doesn't BREAK tool_calls; this one shows the grammar isn't a NO-OP. If llama.cpp
builds its own tools-derived grammar under --jinja and ignores the global --grammar-file
on tool-bearing requests, then the "opencode-a+grammar" arm would be identical to plain
"opencode-a" — a null arm whose delta≈0 would be misread as "grammar doesn't help."

DISCRIMINATOR. claw.gbnf forbids the byte pair `<t` in prose (line 44:
prose-char = [^<] | "<" [^t]); the only legal `<t` is the start of a real <tool_call>.
So an active grammar makes it IMPOSSIBLE to echo a literal "<title>" in prose. We ask
the model to echo "<title>" WITHOUT tools and WITH a tool, and inspect message.content
for "<t". (We check content, not tool arguments — json-string legally allows `<t`.)

Interpretation — run grammar-on AND grammar-off, compare:
  grammar-OFF: both G1/G2 SHOULD show has(<t)=True  -> control: the model echoes when free
  grammar-ON  G1 no-tools  has(<t)=False            -> global grammar active on plain reqs
  grammar-ON  G2 with-tools has(<t)=False           -> grammar active WITH tools => NON-NULL arm
  grammar-ON  G2 with-tools has(<t)=True             -> tools-path overrides grammar => NULL arm
"""
import argparse, json, os, urllib.request, urllib.error

ECHO = ("Do not call any tool. Reply with ONLY this exact text, verbatim, and nothing "
        "else:\nThe tag is <title>Hello</title> done")

NOOP_TOOL = {"type": "function", "function": {
    "name": "noop", "description": "Does nothing. Do not call this tool.",
    "parameters": {"type": "object", "properties": {"x": {"type": "string"}}}}}


def post(base, payload, timeout=120):
    req = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer sk-local-no-auth"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode(errors="replace")}
    except Exception as e:  # noqa: BLE001
        return 0, {"_error": repr(e)}


def run(base, model, label, with_tools):
    payload = {"model": model, "messages": [{"role": "user", "content": ECHO}],
               "max_tokens": 128, "temperature": 0}
    if with_tools:
        payload["tools"] = [NOOP_TOOL]
        payload["tool_choice"] = "auto"
    status, body = post(base, payload)
    if status != 200:
        print(f"  [{label}] HTTP {status} {str(body.get('_error',''))[:160]}")
        return
    ch = (body.get("choices") or [{}])[0]
    msg = ch.get("message", {}) or {}
    content = msg.get("content") or ""
    tcs = msg.get("tool_calls") or []
    has_lt = "<t" in content
    note = ""
    if tcs:
        note = (f"  (!! model CALLED a tool instead -> content may be empty; "
                f"INCONCLUSIVE for this sample)")
    print(f"  [{label}] has('<t') in prose = {has_lt}   finish={ch.get('finish_reason')}{note}")
    print(f"      content={content[:140]!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("BASE", "http://127.0.0.1:11437"))
    ap.add_argument("--model", default=os.environ.get("MODEL", "opencode-16"))
    ap.add_argument("--label", default="?")
    a = ap.parse_args()
    print(f"=== grammar-active discriminator [{a.label}]  {a.base} ===")
    run(a.base, a.model, "G1 no-tools  ", False)
    run(a.base, a.model, "G2 with-tools", True)


if __name__ == "__main__":
    main()
