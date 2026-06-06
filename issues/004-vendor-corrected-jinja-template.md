# Source + vendor the corrected Qwen3.6 Jinja template

**Type**: HITL

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §5 ·
[OPENCODE-QWEN36-SETUP-GUIDE.md](../host/test/docs/OPENCODE-QWEN36-SETUP-GUIDE.md)

## What to build

Obtain a known-good corrected Qwen3.6 chat template and vendor it in-repo. The stock
Qwen3.5/3.6 template returns **HTTP 500** when a request's system message isn't
strictly first (the request shape OpenCode produces). The corrected template fixes
that and must be pinned/vendored so the second `llama-server` (#005) launches against
a stable, reviewed artifact rather than a moving community source.

HITL because choosing and validating a correct template requires human judgment over
community sources (see setup-guide references) — verify it round-trips a system-not-
first request without the 500, and preserves tool-call emission.

## Acceptance criteria

- [ ] Corrected Jinja template committed in-repo at a stable path, with provenance/source noted
- [ ] Rendering a request whose system message is **not** first no longer 500s
- [ ] Template preserves native `<tool_call>` emission and honors `enable_thinking` kwargs
- [ ] Source + the exact fix applied are documented alongside the vendored file

## Blocked by

None - can start immediately
