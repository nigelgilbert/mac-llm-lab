# mac-llm-lab client CLI

Thin POSIX-shell wrapper for the LLM Lab LAN AI lab. Runs on power-user laptops; opens the browser to the right Open WebUI deep-link and SSHes the host for control actions.

> **Scope — this is the chat client, not the coding path.** `mac-llm-lab` orchestrates
> the **Open WebUI** LAN chat lineup (the five OWUI profiles). Agentic **coding** does
> *not* run through here — it runs on OpenCode via the `oc` wrapper (see
> [`opencode/README.md`](opencode/README.md), installed by the wizard).

Spec ref: [`spec.md` §13](../spec.md), step 6.

## Install

```sh
# 1. Drop the script anywhere in $PATH
cp client/mac-llm-lab ~/.local/bin/mac-llm-lab
chmod +x ~/.local/bin/mac-llm-lab

# 2. Set up config
mkdir -p ~/.config/mac-llm-lab
cp client/config.env.example ~/.config/mac-llm-lab/config.env
$EDITOR ~/.config/mac-llm-lab/config.env
```

## Prerequisites

- SSH access to `mac-llm-lab.local` (host has Remote Login enabled, your key in `~/.ssh/authorized_keys` on the host)
- Host-side `mac-llm-lab-hostctl` symlinked into `$PATH` — see [`../host/scripts/README.md`](../host/scripts/README.md)
- `python3` (used for URL-encoding queries; macOS ships it)

Verify SSH:
```sh
ssh ngilbert@mac-llm-lab.local "mac-llm-lab-hostctl --help"
```

## Usage

```sh
mac-llm-lab chat                            # open Open WebUI bare
mac-llm-lab chat -p general                 # daily driver
mac-llm-lab chat -p fast                    # snappy triage (MoE, no <think>)
mac-llm-lab chat -p reasoning               # math / planning
mac-llm-lab chat -p digest                  # long-context extract
mac-llm-lab chat -p analyze                 # long-context reasoning (with <think>)
mac-llm-lab chat -p digest -q "Why..."      # preselect + prefill query
mac-llm-lab status                          # host health summary
mac-llm-lab warm -p reasoning               # preload model on host
```

When you call `chat -p <profile>`, the client also fires a fire-and-forget warm against the host so the model is hot by the time the browser finishes loading. Best-effort — if SSH fails, you still get a working browser open (just a slower first response).

## Config schema

`~/.config/mac-llm-lab/config.env` (also see `config.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `MAC_LLM_LAB_HOST` | `mac-llm-lab.local` | mDNS hostname or LAN IP of host |
| `MAC_LLM_LAB_USER` | `$USER` | SSH user on host |
| `MAC_LLM_LAB_OPENUI_BASE` | `http://mac-llm-lab.local` | Browser deep-link base |
| `MAC_LLM_LAB_HOSTCTL` | `mac-llm-lab-hostctl` | Host-side script (resolved via host's `$PATH`) |

## Phase 2 ideas (not implemented)

- `mac-llm-lab wake` — Wake-on-LAN packet to host MAC
- `mac-llm-lab cli` — TTY chat tunnel (`ssh host ollama run`)
- Tailscale-hosted variant: just point `MAC_LLM_LAB_OPENUI_BASE` at the `*.ts.net` URL

See [`../spec.md`](../spec.md) §11.
