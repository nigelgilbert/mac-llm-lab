# mac-llm-lab

Truly useful local AI on Apple Silicon. A worked reference rig across **16 GB, 32 GB, and 64 GB** — one architecture, three SoC budgets, so anyone with the Mac they already own can run real models locally.

The wager: a single LLM call is brain-like and primitive — what feels useful (ChatGPT, Claude Code) is a *system* of models, retrieval, tools, and routing. This project builds that system locally with small open models and proves they can be insanely useful. Read [`MANIFESTO.md`](MANIFESTO.md) for the why.

**Stack.** Ollama on the host (native Apple Silicon, unified memory) + Open WebUI in Docker (LAN browser UI) + [OpenCode](https://github.com/sst/opencode) in Docker (agentic coding against a launchd-resident llama-server, driven by the `oc` wrapper CLI), wired to a five-profile OWUI lineup. Branded `mac-llm-lab` here; one rename away from any other handle (see [Fork checklist](#fork-checklist)).

Architecture: [`spec.md`](spec.md). Model selection: [`profiles.md`](profiles.md).

> **Migration note.** The coding stack was rebuilt on OpenCode on 2026-06-10,
> replacing the previous claw-code + LiteLLM-bridge + grammar stack at every
> memory tier. Rationale and evidence:
> [`host/test/docs/OPENCODE-MIGRATION-DECISION.md`](host/test/docs/OPENCODE-MIGRATION-DECISION.md).
> The last commit with the old stack intact is tagged **`claw-stack-final`** —
> check out that tag to reproduce the claw baseline.

## Quickstart — install with the wizard

The fastest path to a working code stack (OpenCode + llama-server + the `oc` wrapper) is the bundled installer. It's pure Bash, curl-only, no Homebrew required, and **strictly idempotent** — re-runs are safe on a live system.

```sh
git clone https://github.com/<you>/mac-llm-lab.git
cd mac-llm-lab
./wizard/wizard install
```

The wizard will:

- detect your Mac's RAM and pick a **memory tier** (16 / 32 / 64 GB) — override with ←/→ arrow keys on the slider
- ask for a **topology** — `full-local` (host + client both on this Mac) or `client-only` (this Mac talks to a host elsewhere on the LAN)
- install Xcode CLT, cmake, llama.cpp, OrbStack, Ollama, fetch the tier GGUF, install the launchd-resident OpenCode llama-server, build the `opencode:local` client image, install the global agent prompt (`~/.config/opencode/AGENTS.md`) and the `oc` wrapper (`~/.local/bin/oc`)
- finish with an end-to-end smoke: the prompt-injection wire-capture probe plus a real `oc run` artifact

After install:

```sh
oc                         # OpenCode TUI on the current directory
oc run "fix the tests"     # headless one-shot
oc probe                   # assert the global prompt reaches the agent
./wizard/wizard doctor     # read-only state inspection
./wizard/wizard --help
```

See [`wizard/README.md`](wizard/README.md) for tier model choices, idempotency guarantees, and trust boundaries (one upstream `curl | sh` for OrbStack, opt-out instructions included).

## Profiles (Open WebUI lineup)

The wizard installs the **code stack** only. The five-profile OWUI chat lineup is the broader `host/` setup — see [Manual / OWUI setup](#manual--owui-setup) below.

| Profile | Use it for | Backing model |
|---|---|---|
| `general` | daily driver — chat, code, vision | Qwen3.6-27B Q8_0 |
| `fast` | snappy triage, no `<think>` | Qwen3.6-35B-A3B MoE Q4 |
| `reasoning` | hard thinking, planning | Nemotron Super 49B v1.5 Q6 |
| `digest` | long-context extract | Qwen3-30B-A3B-Instruct-2507 Q4 |
| `analyze` | long-context reasoning | Qwen3-30B-A3B-Thinking-2507 Q6 |

One profile resident at a time, swapped on demand. Full rationale in [`profiles.md`](profiles.md). Agentic coding runs on a separate, dedicated llama-server (`host/llama-server/`) driven by OpenCode — that's what the wizard wires up.

## Manual / OWUI setup

If you want the full chat lineup (Open WebUI, the five profiles, the host orchestration CLI) or prefer to install piece-by-piece, each directory has its own README:

1. [`host/ollama/`](host/ollama/) — install Ollama, stage GGUFs
2. [`host/ollama/Modelfiles/`](host/ollama/Modelfiles/) — `ollama create` the aliases
3. [`host/`](host/) — Open WebUI Docker stack, groups, per-model config
4. [`host/llama-server/`](host/llama-server/) — the dedicated coding llama-server (launchd-resident, tier-parameterized)
5. [`host/scripts/`](host/scripts/) — install `mac-llm-lab-hostctl` for orchestration
6. [`client/`](client/) — install the `mac-llm-lab` CLI on your laptop
7. [`client/opencode/`](client/opencode/) — containerised OpenCode + the `oc` wrapper

The wizard automates 4 and 7 (serving, client image, global prompt, `oc`). The OWUI chat profiles in 1–3 remain manual today.

## Fork checklist

```sh
# 1. Brand: replace `mac-llm-lab` everywhere (LAN hostname, script names, plist Label)
grep -rl 'mac-llm-lab\|LLM Lab' . | xargs sed -i '' 's/mac-llm-lab/your-brand/g; s/LLM Lab/Your-Brand/g'

# 2. Rig username: Modelfile FROM paths point to /Users/nigel/.ollama/gguf/
sed -i '' "s|/Users/nigel/|/Users/$USER/|g" host/ollama/Modelfiles/*.Modelfile

# 3. Repo path: mac-llm-lab-hostctl defaults to ~/Desktop/bench/mac-llm-lab.
#    Either clone there, or set `HOST_REPO=/your/path` in your shell profile.
```

After step 1, also rename `host/ollama/launchd/com.mac-llm-lab.ollama-env.plist` to match.

## Browser

Use Chrome or Firefox for long Open WebUI sessions. Safari WebContent retains 10+ GB after closing thinking-mode chats.

## License

MIT — see [`LICENSE`](LICENSE).
