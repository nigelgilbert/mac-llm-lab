# verify-template.sh: string-arguments fixture, --diff kill/rebind race, mktemp

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), serving/client findings 7 and 9. The vendored
templates exist to pin behavior; the verifier currently can't see the one
upstream change most likely to regress them.

## What to build

1. **String-`arguments` fixture (the important one).** Both corrected
   templates gate the parameter loop on `tool_call.arguments is mapping`.
   If history arguments reach the template as the OpenAI-wire JSON
   *string* — which is what OpenCode sends back — the branch is silently
   skipped and the re-rendered call becomes a parameterless
   `<function=name>` block, degrading every multi-turn tool conversation.
   Today minja's `requires_object_arguments` polyfill masks this by
   converting string→object, but the `M_TOOLCALL` fixture in
   `verify-template.sh` hardcodes object arguments, so a llama.cpp build
   upgrade that changes the polyfill would regress undetected (the #010
   battery is single-turn only). Add a multi-turn fixture whose history
   tool call carries **string** arguments and assert the render still
   contains the `<parameter=...>` lines. If the assertion can only pass
   via the polyfill, that's the point — the fixture pins the polyfill.

2. **--diff kill/rebind race.** `boot()` calls `cleanup` (async kill, no
   wait) then immediately checks the port; the dying server typically
   still holds the LISTEN socket, so the second boot exits 2 "port
   busy". Add the same bounded kill-0/lsof drain loop `opencode-server`'s
   `cmd_stop` got in the #005 remediation.

3. **Fixed temp paths.** `render()` uses `/tmp/_tplv.json` /
   `/tmp/_tplv_prompt.txt`, so concurrent runs clobber each other. Use
   `mktemp` and clean up in the existing trap.

## Acceptance criteria

- [x] New string-arguments fixture renders `<parameter=...>` for both qwen36 and qwen35 corrected templates on the current pinned llama.cpp build
- [x] `verify-template.sh --diff` completes both boots back-to-back without the port-busy exit (run it ≥3 times)
- [x] Two concurrent `verify-template.sh` invocations don't cross-contaminate renders (distinct mktemp paths observable in output/trace)
- [x] Existing verifier assertions unchanged and green; templates themselves untouched (verifier-only change) unless the new fixture exposes a real render bug — in which case stop and file it before touching the template

## Blocked by

None - can start immediately
