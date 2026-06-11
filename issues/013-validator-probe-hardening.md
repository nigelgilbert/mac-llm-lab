# validate-tool-calls.sh + toolcall probe hardening

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), cut findings C7 and S2 — verified during the
review of <https://github.com/nigelgilbert/mac-llm-lab/pull/6> (not posted;
details below are the canonical statement).

## What to build

1. **Summary abort in the all-fail case** (verified on this host's
   /bin/bash 3.2.57). Under `set -euo pipefail`, the summary line
   `uniq_types="$(printf '%s\n' "${ARGS_TYPES[@]}" | sort -u | grep -v '^none$' | paste -sd, -)"`
   kills the script exactly when every run failed to produce a parsed tool
   call (all ARGS_TYPE `none` → `grep -v` exits 1 → pipefail → set -e), so
   the operator loses the arguments-type line, the re-run hints, and the
   RESULT diagnosis in the script's prime scenario. Additionally, the
   HTTP-non-200 branch `continue`s past the `ARGS_TYPES+=` push, so an
   all-non-200 battery leaves the array empty and bash 3.2 dies with an
   unbound-variable error. Guard both (`|| true` on the grep leg /
   `${ARGS_TYPES[@]+...}` expansion or a length check).

2. **Leak-detector parity in the probe.**
   `opencode-toolcall-probe.py`'s XML-leak check tests only `<tool_call>`
   in message content, while validate-tool-calls.sh FAILs on `<tool_call>`
   **or** `<function=` — and `<function=` is this stack's real inner syntax
   (the corrected qwen templates emit `<tool_call>\n<function=...`). A leak
   shape carrying inner `<function=` without the wrapper grades INCONC
   ("model returned prose") and exits 0. Align the probe's detector with the
   validator's two-pattern check.

3. While in the file: drop the dead `SELECTED=` machine token both heredoc
   asserters emit (the bash side greps it out of display and never consumes
   it via `tok()`).

## Acceptance criteria

- [x] Against a server/fixture where all runs yield ARGS_TYPE `none`, validate-tool-calls.sh prints the full SUMMARY + RESULT FAIL block and exits 1 (no mid-summary death) — testable by pointing BASE at a stub that returns prose
- [x] An all-non-200 battery prints a FAIL summary instead of an unbound-variable abort
- [x] A doctored response with `<function=` in content and empty tool_calls makes the probe record FAIL (not INCONC); a prose-only response still grades INCONC
- [x] `grep -c 'SELECTED=' host/llama-server/scripts/validate-tool-calls.sh` returns 0

## Blocked by

None - can start immediately

## Result

Completed 2026-06-10. Files changed:

- `host/llama-server/scripts/validate-tool-calls.sh` — summary line now uses
  `${ARGS_TYPES[@]+"${ARGS_TYPES[@]}"}` (bash 3.2 `set -u` empty-array guard) and
  `{ grep -v '^none$' || true; }` (pipefail guard); all `SELECTED=` emissions and
  the display grep for them removed.
- `host/llama-server/scripts/opencode-toolcall-probe.py` — leak detector is now
  `"<tool_call>" in content or "<function=" in content`, matching the validator.

All evidence gathered against a throwaway local stub (`/tmp/tc013_stub.py`,
python3 http.server on 127.0.0.1:**18099** — ports 1143x untouched), with the
validator run under the system **/bin/bash 3.2.57(1)-release**, `REPEATS=1`
(3 prompts x 1 repeat x 2 modes = 6 runs).

**AC1 — all-prose stub (every run ARGS_TYPE none): full summary, exit 1.**

```
$ MODE=prose python3 /tmp/tc013_stub.py &   # :18099
$ BASE=http://127.0.0.1:18099 REPEATS=1 /bin/bash host/llama-server/scripts/validate-tool-calls.sh
...
 SUMMARY: 0/6 runs emitted a parsed tool_calls[] with no XML leak
 arguments type (build 5594d13, #20198): unknown  (STRING = OpenAI-strict, no shim)
...
RESULT: FAIL (6 run(s) did not produce a clean parsed tool call)
EXIT_CODE=1
```

No mid-summary death; the re-run hint block and RESULT line both printed.

**AC2 — all-HTTP-500 stub (ARGS_TYPES array stays empty): FAIL summary, no
unbound-variable abort.**

```
$ MODE=http500 python3 /tmp/tc013_stub.py &
$ BASE=http://127.0.0.1:18099 REPEATS=1 /bin/bash host/llama-server/scripts/validate-tool-calls.sh
EXIT_CODE=1
30: SUMMARY: 0/6 runs emitted a parsed tool_calls[] with no XML leak
38:RESULT: FAIL (6 run(s) did not produce a clean parsed tool call)
$ grep -c unbound /tmp/tc013_ac2.log   # → 0 hits
```

Pre-fix repro on this interpreter (both legs were independently fatal):

```
$ /bin/bash -c 'set -euo pipefail; declare -a A=(); printf "%s\n" "${A[@]}"'
/bin/bash: A[@]: unbound variable          # rc=1
$ /bin/bash -c 'set -euo pipefail; u="$(printf "none\nnone\n" | sort -u | grep -v "^none$" | paste -sd, -)"; echo survived'
                                            # rc=1, "survived" never prints
```

**AC3 — probe leak parity.** Stub mode `leakfn` returns
`content="<function=write_file>..."` with `tool_calls: []` on tool-bearing
requests; mode `prose` returns plain prose.

```
$ BASE=http://127.0.0.1:18099 python3 host/llama-server/scripts/opencode-toolcall-probe.py --label ac3-leak
  [FAIL] T1.write_file.auto (tc=auto): NO tool_calls but raw <tool_call>/<function=> XML LEAKED into content (finish=stop) → PARSING BROKE
  [FAIL] T3.search_replace.auto ...
  [FAIL] T4.write_file.required ...
--- [ac3-leak] VERDICT: RED — 3 parse FAIL(s) ---   EXIT_CODE=1

$ BASE=http://127.0.0.1:18099 python3 host/llama-server/scripts/opencode-toolcall-probe.py --label ac3-prose
  [INCONC] T1.write_file.auto (tc=auto): model returned prose, no tool_call ...
--- [ac3-prose] VERDICT: AMBER — no parse break, but model never emitted a tool_call (re-run) ---   EXIT_CODE=0
```

**AC4 — dead token gone.**

```
$ grep -c 'SELECTED=' host/llama-server/scripts/validate-tool-calls.sh
0
```

**Happy-path sanity (no regression).** Stub mode `happy` returns a well-formed
parsed `tool_calls[]` (arguments as JSON STRING) non-stream, and
`delta.tool_calls` fragments + `finish_reason: tool_calls` over SSE:

```
 SUMMARY: 6/6 runs emitted a parsed tool_calls[] with no XML leak
 arguments type (build 5594d13, #20198): string  (STRING = OpenAI-strict, no shim)
RESULT: PASS (all 6 runs produced a parsed tool_calls[] natively, no naked-XML freeze)
EXIT_CODE=0
```
