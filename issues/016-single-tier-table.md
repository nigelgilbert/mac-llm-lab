# Single tier table: consolidate the seven copies of tier→port/config/label

**Type**: AFK

**Status:** ✅ Complete (2026-06-11)

## Parent

PR #6 xhigh review (2026-06-10), cut finding CL1 (plus the altitude angle's
plist/config-template notes) — verified during the review of
<https://github.com/nigelgilbert/mac-llm-lab/pull/6> (not posted; details
below are the canonical statement).

## What to build

The tier identity map (64→11436/opencode.json/`com.mac-llm-lab.opencode-server`,
16→11437/opencode.16.json/`...-16`, 32→11438/opencode.32.json) is
independently hardcoded in **seven** verified locations: `bin/oc`,
`run-config-ab.sh`, `opencode-server`, wizard steps 51 and 52, the wizard
status loop (whose comment admits it "mirrors steps/51 / scripts/opencode-server"),
and `opencode_server_timings.js`'s `defaultServerLogPath`. The copies have
already drifted once — the tier-32 log-path bug posted as finding 8/15 on the
PR. `models.conf` is sourced by opencode-server as the declared per-tier
"single source of truth" but carries only GGUF/CTX/sampler values, not
port/config/label/log.

Extend the tier table in `models.conf` (or a sibling `tiers.conf` it sources)
with the identity fields — port, opencode config filename, launchd label (or
"-" for none), log tag — and make every bash consumer read it instead of a
private `case` block. For the JS side, either have the driver pass the
resolved values through env (it already exports OC_PORT etc.) or parse the
conf once in `lib/config.js`. The end state: adding a tier or moving a port
is a one-file edit, and the wizard/oc/driver/launcher cannot disagree.

Do this **after** the in-flight lifecycle/plumbing issues land (#005, #007,
#011, #014 touch the same call sites) to avoid merge churn.

## Acceptance criteria

- [x] One file defines tier→{port, config json, launchd label, log tag}; `grep -rn 11437 --include='*.sh' --include=oc --include=wizard` (and friends) shows no per-script case tables outside that file and rendered artifacts (plists/configs)
- [x] `oc`, `run-config-ab.sh`, `opencode-server`, and wizard steps 51/52 all resolve a given tier to identical values — verify with a small assertion script or wizard-tester case that cross-checks all consumers for tiers 16/32/64
- [x] `defaultServerLogPath` (or its env-passthrough replacement from #007) derives from the same source — no JS-side tier literals
- [x] Wizard smoke + a 2-task smoke sweep still green at the current tier

## Blocked by

- #005
- #007
- #011
- #014

(soft ordering — same call sites; nothing semantic blocks earlier work)

## Result (2026-06-11)

### Design: sibling `tiers.conf`, not an extended `models.conf` — why

`host/llama-server/tiers.conf` is THE tier table: `TIERS_ALL` / `TIER_DEFAULT`
/ `OPENCODE_LOG_BASE` + per-tier `TIER_<N>_{PORT, OPENCODE_CONFIG,
LAUNCHD_LABEL, LOG_TAG, ALIAS, TEMPLATE}` (label `"-"` = no launchd path by
design), plus a `tier_resolve()` helper (bash-3.2 eval indirection, membership-
gated) that flattens a row into `TIER_PORT/...` and composes
`TIER_LOG_PATH = ${OPENCODE_LOG_BASE}${LOG_TAG}.log`. A **sibling** rather
than extending models.conf because the JS side line-parses the same file:
models.conf carries `$HOME` expansions and history prose, while tiers.conf has
a documented strict literal KEY=VALUE format contract (column-1 assignments
only, no expansions, fn body indented so the parser skips it). models.conf
stays the MODEL table (GGUF/CTX/sampler); models.conf does NOT source
tiers.conf — consumers source exactly what they need, and opencode-server
sources both. ALIAS/TEMPLATE were pulled into the table too: they were
duplicated tier identity (opencode-server's case block AND wizard step 51's).

### Consumer-by-consumer resolution mechanism

| Consumer | Mechanism |
|---|---|
| `scripts/opencode-server` | sources tiers.conf + `tier_resolve`; case block deleted; LOG/PIDFILE from `OPENCODE_LOG_BASE`+TAG; label `"-"`→ no-launchd guards in `launchd_state`/`install`/`uninstall`/`status` |
| `client/opencode/bin/oc` | sources tiers.conf; case block deleted; `PORT`/`TIER_CONFIG` from table; `launchd_loaded_64` uses the table label; default tier = `TIER_DEFAULT` |
| `host/test/run-config-ab.sh` | sources tiers.conf; case block deleted; `OC_PORT`/`OC_CONFIG_JSON`/`OC_LOG_TAG` + the #007 host-log path from the table; new `PRINT_TIER_RESOLUTION=1` early-exit dump for the assertion script |
| wizard step 51 | `step_51_resolve` sources tiers.conf + `tier_resolve` (label `"-"`→`""`); private map deleted |
| wizard step 52 | tier-config check AND remote render iterate `TIERS_ALL` rows; default `OPENCODE_PORT` state = default-tier port; this check doubles as the rendered-artifact contract (each committed opencode*.json must dial its table port) |
| wizard step 61 | fallback port = default-tier row (subshell helper) |
| wizard doctor (status loop) | iterates `TIERS_ALL` via `tier_resolve`; mirrored entry list deleted |
| `scripts/validate-tool-calls.sh` | default `BASE` = default-tier port from the table (explicit BASE wins) |
| `scripts/rotate-opencode-server-log.sh` | default log = default-tier `TIER_LOG_PATH` |
| JS (`lib/config.js`) | `parseTiersConf(text)` + `loadTierTable({path,text,env})` (injectable; `OPENCODE_TIERS_CONF` env override; null when unreadable) + `tierTable()` = parsed-conf-else-`FALLBACK_TIER_TABLE` (embedded snapshot) |
| JS (`lib/opencode_server_timings.js`) | `defaultServerLogPath` = env override verbatim (#007 unchanged), else `tierTable()` row `log_path`; per-tier literals deleted |

JS hermeticity choice (justification): the pinned suite container mounts only
`host/test/{lib,scripts,__tests__}`, so the conf is invisible there. Chosen
design = **parse-when-readable + contract-tested embedded fallback**:
every LIVE seat (host node, path-matched runner mounts) parses the real conf —
and the flag-on sweep path doesn't even reach the fallback because the driver
passes `OPENCODE_LLAMA_LOG`. The fallback cannot silently drift: the
tier-table contract test asserts parsed-conf `deepEqual` FALLBACK wherever the
conf is readable, and `check-tier-table.sh` enforces it on the host (AC3
mechanism, demonstrated below). Rendered artifacts (opencode*.json, launchd
plists) keep their literals per the issue; step 52 + check-tier-table assert
they agree with the table. Wizard-tester literals at
`wizard/tester/run-tests.sh:330ff/435ff` are annotated INTENTIONAL PINS
(test expectations that catch an accidental tiers.conf edit — not resolution
maps).

### AC evidence

**AC1 (one file, no private case tables).** `grep -rn
'11436|11437|11438|com.mac-llm-lab.opencode-server|opencode.16.json|opencode.32.json'`
across `*.sh`, `oc`, `wizard`, `opencode-server` in client/, host/llama-server/,
host/test/run-config-ab.sh, wizard/: remaining hits are (a) tiers.conf,
(b) rendered artifacts (opencode*.json, launchd/*.plist), (c) prose comments
(driver/rotate/validate headers + usage examples), (d) the annotated
wizard-tester pins. Zero resolution `case` tables outside tiers.conf. JS:
the only literals live inside `FALLBACK_TIER_TABLE` (the contract-tested
snapshot); `opencode_server_timings.js` has none.

**AC2 (identical resolution, assertion script).** New
`host/llama-server/scripts/check-tier-table.sh` (read-only) cross-checks, for
tiers 64/16/32: tiers.conf reference, `opencode-server status` (parsed),
`oc -t N status` (parsed), `run-config-ab.sh` (`PRINT_TIER_RESOLUTION=1`),
wizard `step_51_resolve` (sourced), `step_52_config_ok` (rendered configs vs
table ports), and the JS side (runner image: parsed conf == FALLBACK +
`defaultServerLogPath` derivation + row-by-row match against the bash
reference). Run 2026-06-11: **TIER-TABLE CHECK: PASS** — 29 ok / 0 FAIL
(incl. `w51 rejects unknown tier 99`).

**AC3 (JS derives from the same source; drift demo).** Contract test
`__tests__/lib/tier-table.contract.test.js` (9 tests): parser format-contract
fixture, FALLBACK shape invariants, `defaultServerLogPath` table derivation +
verbatim `OPENCODE_LLAMA_LOG` override, and the drift gate. Demonstrated on a
conf-visible seat (eval-runner image + repo mount): as-is → 9/9 pass;
doctored conf (`TIER_32_PORT=11438→11439` via `OPENCODE_TIERS_CONF`) → 1 fail:
`AssertionError ... FALLBACK_TIER_TABLE have drifted — update them together (#016)`.

**AC4 (wizard smoke + sweeps green at tier 64).**
- Lightest wizard paths (no install, resident untouched): `wizard doctor`
  (refactored status loop resolves all three tiers from the table; tier-64
  green :11436) and `wizard selftest` (harness orb): **75/75 pass** — includes
  the step_51_resolve/step_52 tester pins against the refactored steps.
- 2-task smoke sweep under the resident lock
  (`SMOKE_TESTS="deep-equal wordy" CONFIG_AB_REPEATS=1`): first attempt died
  to the known ENOENT `/workspace` flake (both cells, signature
  `/workspace/verify.js`); retry **rc=0** — both cells PASS, row audit clean,
  gate `PASS — every row config_id-stamped; both sides bucketed (2/2)`.
- `OPENCODE_SERVER_TIMINGS=1` single-cell sweep (lock held,
  `OC_ROTATE_HOLDING_LOCK=1`): first attempt same flake; retry **rc=0** —
  cell PASS, table-derived log mounted, freeze fired and the repair pass
  survived the refactor: `1 runDir(s) sliced, 1 frozen, 1 repaired,
  0 overflow-typed`, sidecar re-joined `join_status: ok, join_keying: token,
  5/5 matched`, gate PASS.

**AC5 (suite).** Pinned container invocation: **299 tests / 298 pass /
1 skip / 0 fail** (floor was 290/289/1/0; +9 = the tier-table contract test).

### Carry-forwards closed

1. **(#015) driver-preflight rotation**: `run-config-ab.sh` now invokes
   `rotate-opencode-server-log.sh --log <tier log>` at sweep start — strictly
   before any sweep container (G1), ticker index (G2) or cursor exists. Exit 2
   (guard refusal) tolerated as skip; other nonzero fatal; below-cap = no-op.
   `OC_ROTATE_HOLDING_LOCK=1` documented in the driver knobs for operators
   holding the resident lock. Live-exercised both ways: G3 refusal → driver
   logged `REFUSED by rotate guards (rc=2) — skipping` and proceeded; normal
   path → `below cap ... nothing to do`.
2. **(#010) double battery dedupe**: wizard install path runs exactly ONE
   battery-verified probe — the seat inside `opencode-server install`
   (cmd_probe is its final act; failure fails the install). Step 51's
   post-install probe call removed; its already-loaded-and-healthy branch
   keeps its own probe (no install ran there). Gate guarantee intact on every
   path; comments updated on both sides.
3. **(#010) stale step-51 comment**: "no tokens are generated" fixed — the
   probe's check 4 is the LIVE tool-call battery (N=6 generations, ~4-5 s);
   step messages updated ("template invariants + #010 tool-call battery").

### Files changed

`host/llama-server/tiers.conf` (new), `scripts/check-tier-table.sh` (new),
`__tests__/lib/tier-table.contract.test.js` (new);
`scripts/opencode-server`, `scripts/validate-tool-calls.sh`,
`scripts/rotate-opencode-server-log.sh`, `client/opencode/bin/oc`,
`host/test/run-config-ab.sh`, `host/test/lib/config.js`,
`host/test/lib/opencode_server_timings.js`, `wizard/wizard`,
`wizard/steps/{51,52,61}-*.sh`, `wizard/tester/run-tests.sh` (pin note),
`host/llama-server/README.md`, `host/test/docs/OPENCODE-SERVER-TIMINGS.md`.

### Residual risks

- `FALLBACK_TIER_TABLE` must be edited together with tiers.conf; enforced by
  the contract test on every conf-visible seat + check-tier-table.sh, but the
  hermetic suite container alone cannot see a drift (documented in the test).
- The driver's rotation preflight under an operator-held lock only rotates
  when `OC_ROTATE_HOLDING_LOCK=1` is exported (otherwise guard-skip); rotation
  remains otherwise manual between sweeps — unchanged #015 posture.
- `cmd_uninstall` for a label-"-" tier now dies loudly (was a silent
  bootout-of-nothing); `cmd_status` wording for tier-32 launchd changed to
  "none (on-demand only by design)" — check-tier-table.sh parses the new
  wording.

### Lab end-state

Resident :11436 green, launchd pid 31147 (unchanged before/after); :11437 and
:11438 quiet; no sweep-labeled containers; `/tmp/oc-resident.lock.d` released;
doctored-conf temp file removed. Sweep registries left under
`host/test/.claw-runtime/run_registry.config-ab-20260611-{004028,004147,004231}.jsonl`
(gitignored runtime artifacts, plus the red flake registries from the two
retried attempts).
