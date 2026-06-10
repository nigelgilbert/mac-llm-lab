# Eval harness — OpenCode tier-eval panel + config-vs-config A/B driver

Runs the 32-task tier-eval panel against one or more **OpenCode config arms**
and lands one schema-validated registry row per cell, so arms can be compared
with the paired-bootstrap statistic. Tests are ESM on Node's built-in test
runner (`node --test`) — no Jest, no `npm install`.

The predecessor claw stack (claw-code bridge + LiteLLM + grammar + claw
llama-server) was retired in 2026-06 (decision:
[docs/OPENCODE-MIGRATION-DECISION.md](docs/OPENCODE-MIGRATION-DECISION.md);
archive: git tag `claw-stack-final`). Its registry rows remain first-class
*historical* data — `config_id: claw-rig` still validates and pairs — but
there is no claw runner anymore.

```
┌──────────────────────────┐   docker run    ┌──────────────────────────┐
│ run-config-ab.sh (host)  │ ──────────────► │ eval-runner sibling       │
│  per arm: CONFIG=<arm>   │                 │ (node --test, live repo   │
│  start/stop oc server    │                 │  mount, per-cell timeout) │
└──────────────────────────┘                 └────────────┬─────────────┘
                                              runAgent → runOpenCode
                                                          │ docker compose run
                                             ┌────────────▼─────────────┐
                                             │ opencode sibling          │
                                             │ /workspace = shared H     │──► llama-server
                                             └──────────────────────────┘    :11436/:11437/:11438
```

## Layout

| path | what |
|---|---|
| `__tests__/tier-eval/` | the 32-task A/B panel (runAgent + `/workspace` post-script oracle) |
| `__tests__/lib/`, `__tests__/scripts/` | unit tests (docker-free; the suite CI runs) |
| `lib/` | runAgent, runOpenCode, registry emit/validate, paired bootstrap, reporter |
| `scripts/` | gate + verdict + analysis CLIs |
| `run-config-ab.sh` | the sweep driver (see its header for the full interface) |
| `Dockerfile` → `mac-llm-lab-test:local` | plain node toolchain (unit tests, analysis scripts) |
| `Dockerfile.runner` → `mac-llm-lab-eval-runner:local` | baked arm runner: node + git + docker CLI + compose (#009) |
| `docs/data/` | committed canonical registries (read-only evidence) + re-derivation README |
| `.claw-runtime/` | gitignored runtime root: per-run sidecars + sweep registries (name is historical) |

## Prerequisites

- Images built: `cd host/test && docker compose build && docker compose build runner`
- OpenCode client image + configs: `client/opencode/` (`opencode:local`)
- Serving: tier-64 resident daemon on `:11436` (launchd
  `com.mac-llm-lab.opencode-server`); tiers 16/32 on demand via
  `OPENCODE_TIER=16|32 host/llama-server/scripts/opencode-server start|stop`
  (`:11437`/`:11438`). The driver starts an absent server itself and stops it
  on exit iff it started it — the resident daemon is never touched.

## Run a sweep

```sh
# one-cell smoke of the default arm on the resident tier-64 daemon:
host/test/run-config-ab.sh

# two arms at tier 16, gated explicitly against the +git control:
TIER=16 ARMS="opencode-a+git opencode-a+prompt" BASELINE=opencode-a+git \
  SMOKE_TESTS="deep-equal" host/test/run-config-ab.sh

# full-panel precision sweep shape (N=8 per cell per arm):
TIER=16 ARMS="opencode-a opencode-a+prompt" BASELINE=opencode-a \
  SMOKE_TESTS="$(ls host/test/__tests__/tier-eval/*.test.js | xargs -n1 basename | sed 's/\.test\.js//' | tr '\n' ' ')" \
  CONFIG_AB_REPEATS=8 host/test/run-config-ab.sh
```

Knobs (`ARMS`, `BASELINE`, `REUSE_ROWS`, `REGISTRY_OUT`, `RUNNER_IMAGE`, …) are
documented in the driver header. Every arm appends config_id-stamped rows to
one shared registry; the driver then gates each `(arm, BASELINE)` pair with
`scripts/config-ab-pairing-check.mjs --treatment <arm> --baseline <BASELINE>`
(rows mislabeled or a side bucketing zero turn the sweep red).

## Analysis

```sh
DR="docker run --rm -v $PWD:$PWD -w $PWD/host/test --entrypoint node mac-llm-lab-test:local"
$DR scripts/config-ab-verdict.mjs <registry.jsonl> --tier 16 \
    --treatment opencode-a+prompt --baseline opencode-a+git
$DR scripts/config-ab-normalized-ci.mjs <registry.jsonl> --tier 16 --treatment opencode-a+prompt
```

The committed canonical registries and the exact commands that reproduce every
published number live in [docs/data/README.md](docs/data/README.md).

## Unit tests

```sh
cd host/test && docker compose run --rm test          # __tests__/lib + __tests__/scripts
./run-pattern.sh config-selector                       # one file, live sources
```

## Adding a new arm

1. Add the config id to `OPENCODE_CONFIGS`/`VALID_CONFIGS` in `lib/config.js`
   (+ the registry schema enum in `lib/schemas/run_registry.schema.json`) and a
   serving fingerprint mapping in `modelConfigIdFor` + `lib/model_configs.json`.
2. Wire any arm-specific workspace seeding in `lib/runAgent.js` (see the
   sidecar-port arms for the pattern).
3. Sweep it: `ARMS="opencode-a <new-arm>" BASELINE=opencode-a …`.
