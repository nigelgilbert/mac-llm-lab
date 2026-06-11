# Host scripts

Two scripts live here:
- [`mac-llm-lab-hostctl`](mac-llm-lab-hostctl) — daily orchestration (up / down / status / warm / openui-url). Symlinked into `$PATH`.
- [`set-local-hostname`](set-local-hostname) — one-shot helper to claim `<name>.local` via mDNS. Run from the repo path; not symlinked.

## Install `mac-llm-lab-hostctl` on the target host

```sh
sudo ln -s ~/Desktop/bench/mac-llm-lab/host/scripts/mac-llm-lab-hostctl /usr/local/bin/mac-llm-lab-hostctl
```

(Adjust the path if you cloned the repo elsewhere. The script already has the executable bit set in the repo.)

Test:
```sh
mac-llm-lab-hostctl --help
mac-llm-lab-hostctl status
```

---

## `mac-llm-lab-hostctl` — subcommands

| | |
|---|---|
| `up` | `docker compose up -d`, then verify OWUI + Ollama healthy. Exits non-zero if OWUI doesn't come healthy within 30s. |
| `down` | `docker compose down` (volume preserved). |
| `status` | Container state + OWUI health + Ollama API + `ollama ps`. |
| `warm <profile>` | Preload a profile: POST `/api/generate` to Ollama with `keep_alive=30m`. |
| `openui-url [-p P] [-q "..."]` | Print the canonical browser URL. URL-encodes `-q`. |

Profiles: `general`, `fast`, `reasoning`, `digest`, `analyze`. (The coding stack is separate — `oc status` covers its resident llama-server.)

## Env overrides

```
HOST_REPO          repo root (default: ~/Desktop/bench/mac-llm-lab)
COMPOSE_DIR        compose dir (default: $HOST_REPO/host)
OPENUI_BASE        external OWUI URL (default: http://mac-llm-lab.local)
OLLAMA_API         local Ollama API (default: http://127.0.0.1:11434)
KEEP_ALIVE         Ollama warm duration (default: 30m)
```

Useful when running from a non-default repo path, or if you change any port.

---

## `set-local-hostname` — claim `<name>.local`

Sets `LocalHostName` via `scutil`. Default `mac-llm-lab`. On LAN conflict, macOS auto-bumps to `<name>-2` and the script exits non-zero.

```sh
sudo ./host/scripts/set-local-hostname          # claim 'mac-llm-lab'
sudo ./host/scripts/set-local-hostname my-rig   # claim a different name
```
