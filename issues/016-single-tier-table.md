# Single tier table: consolidate the seven copies of tier→port/config/label

**Type**: AFK

**Status:** 🔲 Not started

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

- [ ] One file defines tier→{port, config json, launchd label, log tag}; `grep -rn 11437 --include='*.sh' --include=oc --include=wizard` (and friends) shows no per-script case tables outside that file and rendered artifacts (plists/configs)
- [ ] `oc`, `run-config-ab.sh`, `opencode-server`, and wizard steps 51/52 all resolve a given tier to identical values — verify with a small assertion script or wizard-tester case that cross-checks all consumers for tiers 16/32/64
- [ ] `defaultServerLogPath` (or its env-passthrough replacement from #007) derives from the same source — no JS-side tier literals
- [ ] Wizard smoke + a 2-task smoke sweep still green at the current tier

## Blocked by

- #005
- #007
- #011
- #014

(soft ordering — same call sites; nothing semantic blocks earlier work)
