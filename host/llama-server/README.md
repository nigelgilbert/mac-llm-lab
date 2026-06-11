# llama-server (OpenCode serving layer)

Native `llama.cpp` HTTP servers on the lab host, serving the coding-harness
models with `--jinja` native tool-call parsing — no grammar, no bridge.
Installed and managed by `wizard install` (step 51); consumed by the `oc`
wrapper ([`client/opencode/bin/oc`](../../client/opencode/bin/oc)) and the
eval harness ([`host/test/`](../test/)).

> **History.** This directory previously hosted the grammar-constrained
> "claw" server (`:11435`, `claw.gbnf`, LiteLLM bridge), retired 2026-06-10
> per [`OPENCODE-MIGRATION-DECISION.md`](../test/docs/OPENCODE-MIGRATION-DECISION.md)
> — the A/B showed the grammar redundant under llama.cpp's native
> tools-grammar and the discipline prompt portable. Full old stack:
> git tag `claw-stack-final`.

```
Apple Silicon Mac (lab host)
├── Ollama         :11434  native  →  OWUI chat profiles (general, fast, …)
├── llama-server   :11436  native  →  tier-64 daily driver (launchd-resident)
│                  :11437  native  →  tier-16 (on-demand)
│                  :11438  native  →  tier-32 (on-demand)
└── Docker         opencode client containers (talk to host.docker.internal:1143x)
```

## Layout

| Path | What |
|---|---|
| [`scripts/opencode-server`](scripts/opencode-server) | Tier-parameterized lifecycle: `{start\|stop\|restart\|status\|health\|probe\|install\|uninstall}`; `OPENCODE_TIER=64\|16\|32` → `:11436/:11437/:11438`. `install` sets up the launchd-resident tier-64 daemon (`com.mac-llm-lab.opencode-server`, RunAtLoad+KeepAlive). |
| [`models.conf`](models.conf) | Tier → GGUF/sampler/ctx mapping (single source of truth for serving params). |
| [`templates/`](templates/) | Vendored corrected Jinja chat templates (system-not-first fix; see [`templates/README.md`](templates/README.md)). |
| [`launchd/`](launchd/) | Plist templates rendered by `install`. |
| [`docs/system-prompt.md`](docs/system-prompt.md) | The discipline prompt — installed globally at `~/.config/opencode/AGENTS.md` by wizard step 53. |
| [`scripts/*-probe.py`](scripts/) | Serving-correctness probes (`probe` subcommand: system-not-first + closed-think-block checks). |
| `docs/` (rest) | Validation records ([TOOL-CALL-VALIDATION](docs/TOOL-CALL-VALIDATION.md), [tier-16](docs/TOOL-CALL-VALIDATION-TIER16.md)) and parked research (W2–W4, iteration-distribution). |

## Build llama.cpp (prerequisite)

Build `llama-server` from upstream into a user-scope directory — no
Homebrew, no system writes. Needs Xcode CLT (`xcode-select -p`) and CMake.
(`wizard install` automates this via steps 40–42; the manual path below is
the same thing.)

```sh
mkdir -p ~/src
git clone --depth=1 https://github.com/ggml-org/llama.cpp ~/src/llama.cpp
cd ~/src/llama.cpp
cmake -B build -DGGML_METAL=ON -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build build --config Release -j --target llama-server
```

~2–5 min on M5 Max. Then symlink into a user-scope `PATH` slot:

```sh
mkdir -p ~/.local/bin
ln -sf ~/src/llama.cpp/build/bin/llama-server ~/.local/bin/llama-server
~/.local/bin/llama-server --version   # expected: "version: <hash> (<date>)"
```

If `~/.local/bin` isn't on `PATH` (zsh):
`echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`

> **No CMake on the rig?** Download a release tarball from
> [cmake.org/download](https://cmake.org/download/), extract under
> `~/.local/`, symlink the `cmake` binary into `~/.local/bin/`.

> **llama.cpp bumps:** re-run
> [`templates/verify-template.sh`](templates/) and `opencode-server probe`
> after rebuilding — the corrected-template and thinking-off behaviors are
> build-sensitive (validated on `b1-5594d13`).

## Operate

```sh
host/llama-server/scripts/opencode-server status        # resident tier-64
host/llama-server/scripts/opencode-server probe         # serving-correctness checks
OPENCODE_TIER=16 host/llama-server/scripts/opencode-server start   # on-demand tier
OPENCODE_TIER=16 host/llama-server/scripts/opencode-server stop
```

Rule of engagement: never boot out the green resident tier-64 daemon —
`install` hands over without downtime; tiers 16/32 are start-on-demand,
stop-after. The `oc` wrapper and the A/B driver both follow this contract.

GGUF downloads per tier are listed in [`models.conf`](models.conf); the
wizard fetches them (step 46). Pairs with [`../ollama/`](../ollama/) (OWUI
chat profiles — separate stack, separate port).
