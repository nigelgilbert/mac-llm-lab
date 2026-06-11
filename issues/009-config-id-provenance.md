# config_id provenance: no claw-rig default, explicit harvester labeling

**Type**: AFK

**Status:** ✅ Complete

## Parent

PR #6 xhigh review (2026-06-10), finding 11/15 — inline comments on
<https://github.com/nigelgilbert/mac-llm-lab/pull/6>.

## What to build

`assembleRow` defaults `config_id` to `'claw-rig'` when `ctx.config_id` is
absent, and the offline recovery harvester
(`host/test/scripts/harvest-runs-to-registry.mjs`) never threads it — its
documented `--ctx` schema omits the field entirely. The harvester is
format-compatible with opencode runDirs (it reads exactly the
`run_summary.json` / `iterations.jsonl` / `assertion_result.json` that
runOpenCode writes), so any opencode run recovered offline is silently
stamped as the historical baseline: `'claw-rig'` is in the schema enum,
passes the pairing gate's invariant 1, and both pairing and verdict scripts
default `baseline='claw-rig'` — the mislabeled row lands on the baseline
side of the A/B.

Fix at the source: make `config_id` required in `assembleRow` (throw instead
of defaulting — the live path always supplies it via `resolveConfigId()`),
and give the harvester an explicit required `--config-id` argument validated
against `VALID_CONFIGS`. `'claw-rig'` remains in the enum for the preserved
historical registries; it just can never again be minted by omission.

## Acceptance criteria

- [x] `assembleRow` without `ctx.config_id` throws with a message naming the field; unit test added
- [x] `harvest-runs-to-registry.mjs` without `--config-id` exits nonzero with usage; with `--config-id opencode-a+prompt` it emits rows carrying that label
- [x] Harvesting a real opencode runDir sidecar produces a row that passes `config-ab-pairing-check.mjs` under its true config, and no row labeled claw-rig
- [x] Runner-image suite green; preserved canonical registries unaffected (no rewrite)

## Blocked by

None - can start immediately

## Result

Completed 2026-06-10. Files changed: `host/test/lib/run_row.js`,
`host/test/scripts/harvest-runs-to-registry.mjs`,
`host/test/__tests__/lib/run-row-config-id.test.js` (extended), new
`host/test/__tests__/scripts/harvest-config-id.test.js`. The harvester's
`--config-id` is validated against `VALID_CONFIGS` from `host/test/lib/config.js`
(`claw-rig, opencode-a, opencode-a+git, opencode-a+prompt`); a conflicting
`config_id` inside the `--ctx` JSON is also refused (flag is the single source).

### AC1 — assembleRow throws on missing config_id

`assembleRow` now guards `config_id` explicitly (no `?? 'claw-rig'` left in the
row literal) and throws `RunRowAssemblyError`:

> ctx.config_id is required (no 'claw-rig' default — issue #009): pass the
> run's coarse bundle label explicitly (live path: resolveConfigId(); offline
> harvest: --config-id).

Unit tests (container, `node --test __tests__/lib/run-row-config-id.test.js`):

```
✔ throws when ctx omits config_id, naming the field
✔ throws on null and empty-string config_id too (no silent fallthrough)
✔ never mints claw-rig by omission: every assembled row carries the ctx label verbatim
✔ still accepts an EXPLICIT claw-rig (historical label stays in the enum)
```

### AC2 — harvester requires --config-id

Without the flag (real mount, otherwise-valid invocation):

```
--config-id required
Usage: node harvest-runs-to-registry.mjs --runtime-root <dir> --tests-dir <dir> --ctx <ctx.json> --config-id <id> [--registry <path>] [--run-id <id>] [--since <ms>] [--dry-run]
  --config-id is required (issue #009): the coarse A/B bundle label stamped on every harvested row.
  Valid values: claw-rig, opencode-a, opencode-a+git, opencode-a+prompt
EXIT=2
```

With `--config-id opencode-a+prompt` the emitted row carries
`"config_id":"opencode-a+prompt"` (subprocess test
`__tests__/scripts/harvest-config-id.test.js` + real harvest below).

### AC3 — real runDir harvest passes the pairing gate, zero claw-rig

Harvested 4 REAL opencode sidecars from
`client/opencode/.opencode-runtime/` (read-only mount at `/ocruns`) into
`/workspace/.claw-runtime/issue009-harvest-demo/registry.jsonl` — 2 per arm
(`adversarial-input`, `state-machine` in both arms; tier-16 opencode
model_config_ids per arm):

```
node scripts/config-ab-pairing-check.mjs .../issue009-harvest-demo/registry.jsonl \
    --tier 16 --treatment opencode-a+prompt --baseline opencode-a+git

config_id histogram (all rows):
  claw-rig     0
  opencode-a   0
  opencode-a+git 2
  opencode-a+prompt 2
paired tasks: 2   unpaired: 0
PASS — every row config_id-stamped; both sides bucketed (opencode-a+git=2,
opencode-a+prompt=2 eligible paired runs). Baseline NOT dropped.   EXIT=0
```

### AC4 — suite green, canonical registries untouched

```
node --test --test-concurrency=1 __tests__/lib/*.test.js __tests__/scripts/*.test.js
ℹ tests 179  ℹ pass 178  ℹ skipped 1  ℹ fail 0
```

(count includes parallel agents' in-flight test additions; zero failures).
`git status --porcelain host/test/docs/data/` → empty (no canonical registry
rewritten; demo output lives under gitignored `host/test/.claw-runtime/`).

### Note for #010 (telemetry fields on assembleRow)

`assembleRow` now throws `RunRowAssemblyError` BEFORE any sidecar I/O when
`ctx.config_id` is missing/null/empty — any new telemetry-field test fixture
must pass `config_id` in ctx (there is no default to lean on). The live path
(`registry_emit.js` → `resolveConfigId()`) is unchanged.
