# Arm×tier preflight: fail the sweep before burning wall-clock

**Type**: AFK

**Status:** 🔲 Not started

## Parent

PR #6 xhigh review (2026-06-10), finding 6/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

`OPENCODE_PROMPT_MODEL_CONFIG_ID_BY_TIER` has no `'64'` key, so
`modelConfigIdFor({configId: 'opencode-a+prompt', tier: '64'})` throws — but
only post-cell, inside `writeAssertionResult`'s swallowing catch, after the
cell's agent wall-clock is spent. The driver validates ARMS against
`OPENCODE_CONFIGS` membership only and deliberately unsets
`RUN_REGISTRY_MODEL_CONFIG_ID` so the throwing path is always taken: a
TIER=64 sweep including `opencode-a+prompt` burns every cell and emits zero
rows, failing only at the end-of-sweep pairing gate.

Extend the driver's preflight to validate **arm×tier coverage**: for each arm
in ARMS (plus BASELINE), resolve `modelConfigIdFor({configId, tier})` via the
same node -e/config.js route the enum check already uses, and die before the
arms phase with the exact missing (arm, tier) pair. Secondarily, make the
per-cell emit failure loud enough to matter if a future gap slips through —
a swallowed `[run-registry] emit failed` should at minimum fail the cell's
rc rather than stderr-only.

## Acceptance criteria

- [ ] `TIER=64 ARMS="opencode-a+prompt" run-config-ab.sh ...` exits nonzero in preflight (before any container starts) naming `opencode-a+prompt × 64`
- [ ] All currently-mapped arm×tier combos still pass preflight (16/32 +prompt, +git everywhere)
- [ ] A forced emit failure inside a cell turns that cell's rc nonzero (visible in ARMS_RC / the #003 exit path), not stderr-only
- [ ] Runner-image suite green; config-selector tests still assert the throw for unmapped combos

## Blocked by

None - can start immediately (pairs naturally with #003's exit-code work)
