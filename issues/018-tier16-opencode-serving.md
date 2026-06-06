# tier-16 OpenCode serving (9B) + tool-call validation

**Type**: HITL

**Status:** ✅ Done — 4ea6bdb

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0, §4.2

## What to build

Stand up the second `llama-server` for tier-16 serving the `Qwen3.5-9B IQ4_XS` GGUF
with OpenCode's config and the thinking-parity policy from #017, then validate native
tool-calls the same way as tier-64 (#006). The three 35B-A3B fixes may not all apply
to the 9B — determine which are needed (template, thinking flag, `-n`) and validate
empirically rather than assuming the tier-64 recipe transfers.

## Acceptance criteria

- [x] Second `llama-server` serves the tier-16 GGUF on its own port, green `/health`, sampler mirroring tier-16
- [x] Thinking mode set to match the #017 parity decision
- [x] A raw request returns parsed `tool_calls[]` on the 9B (naked-XML freeze absent or mitigated)
- [x] Which of the tier-64 fixes are/aren't needed for the 9B is documented

## Resolution (2026-06-06)

**Record:** [host/llama-server/docs/TOOL-CALL-VALIDATION-TIER16.md](../host/llama-server/docs/TOOL-CALL-VALIDATION-TIER16.md).

- **Server:** `OPENCODE_TIER=16 host/llama-server/scripts/opencode-server start` → green
  `/health` on **`:11437`**, alias `opencode-16`, ctx 65536, `TIER_16_*` sampler
  (confirmed via `/props`). claw `:11435` + opencode-64 `:11436` untouched. The #005
  script was **parameterized by `OPENCODE_TIER`** (tier-64 path byte-unchanged); added
  the tier-16 launchd plist sibling.
- **Which tier-64 fixes the 9B needed (empirical):**
  - **Template (#004 analogue): NEEDED — and harder.** Stock 9B **HTTP 500**s on
    system-not-first (`raise_exception('System message must be at the beginning.')`) vs the
    35B's silent drop. Vendored `templates/qwen35-corrected.jinja` (same 2-region surgical
    fix); `verify-template.sh` 13/13 PASS + 6/6 byte-equivalence on non-fix shapes.
  - **Thinking-off (#017): NEEDED.** The 9B serves thinking-**ON** by default (llama.cpp
    injects `enable_thinking=true`); the flag flips it to closed `<think></think>`. Asserted
    live on `:11437` (launch-default **and** per-request forms). NB the 9B's template branch
    has the **opposite default polarity** from the 35B — preserved byte-for-byte.
  - **Generous `-n`: carried over unchanged** (`-n 8192`); no truncation.
- **Tool-calls on the 9B:** validator (`BASE=:11437 MODEL=opencode-16 REPEATS=3`) →
  **18/18** parsed `tool_calls[]`, both modes, **no naked-XML freeze**, `arguments` is a
  JSON STRING (no #20198 shim). The tier-64 freeze-absent result **transfers to the 9B**.
- **Caveat:** tier-16 here is a **capability proxy** on the 64 GB box, not 16 GB memory pressure.

## Blocked by

- #017
- #006
