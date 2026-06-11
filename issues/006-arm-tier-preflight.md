# Arm×tier preflight: fail the sweep before burning wall-clock

**Type**: AFK

**Status:** ✅ Complete

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

## Result

Implemented in `host/test/run-config-ab.sh` (preflight) +
`host/test/lib/registry_emit.js` (emit-failure rc) (2026-06-10, tranche 2).

- The driver's existing node -e/lib/config.js enum check now also resolves
  `modelConfigIdFor({configId, tier})` for every ARMS entry plus BASELINE
  (a non-opencode baseline, e.g. claw-rig, returns undefined without
  throwing) and exits 1 BEFORE the server/arm phases, naming every missing
  pair.
- Secondary: `writeAssertionResult`'s emit catch (it lives in
  `lib/registry_emit.js`, not runAgent.js as guessed) now sets
  `process.exitCode = 1` — still no throw (a throw mid-reporter would abort
  the flush of later cells), but the cell's `node --test` exits nonzero, so
  ARMS_RC / the #003 exit path sees the lost row.

Per-AC evidence (real command output, 2026-06-10):

- [x] **Unmapped pair dies in preflight**: `TIER=64 ARMS="opencode-a+prompt"
  ./run-config-ab.sh` → **EXIT=1** with `arm×tier preflight (#006): no
  model_config_id mapped for: opencode-a+prompt × 64 …`; zero server-start /
  arm lines in the log (no eval container ran).
- [x] **Mapped combos pass**: the same node route passed for
  opencode-a × {16,32,64}, opencode-a+git × {16,32,64},
  opencode-a+prompt × {16,32}, and BASELINE=claw-rig (historical, tolerated)
  — matching lib/config.js's actual maps (+prompt has no 64 key; +git falls
  through to the plain opencode-a map, which covers all three tiers).
- [x] **Forced emit failure fails the cell rc**: with REGISTRY_OUT's parent
  a regular file, a live deep-equal cell PASSED its test (`pass 1 / fail 0`,
  `=== deep-equal (tier-64) === PASS`) yet `[run-registry] emit failed …
  EEXIST` flipped the cell to `>>> cell deep-equal rc=1`, ARMS_RC=1, sweep
  **EXIT=1** (audit also named the lost cell). Unit-pinned in
  `__tests__/lib/registry-emit-failure.test.js` (catch path sets
  exitCode=1 without throwing; flag-off path leaves it untouched).
- [x] **Suite green / config-selector throw intact**: runner-image suite
  204 tests, 201 pass, 1 skip; the only 2 fails are a sibling agent's
  mid-flight `dockerComposeArgv` `--` change vs. its not-yet-updated contract
  test (outside this issue's files). `config-selector.test.js` (unmapped-
  combo throw) passes unchanged — lib/config.js was not touched.
