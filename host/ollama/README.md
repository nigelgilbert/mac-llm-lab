# Ollama Setup — LLM Lab Host

Installs Ollama on the **target host** (the 64 GB M5 Max Pro MBP, hostname `mac-llm-lab`), pulls or imports the three profile models, and verifies a CLI chat. Spec ref: [`spec.md` §13](../../spec.md), step 2.

> **Run this on the 64 GB target rig, not your 32 GB dev machine.** The largest profile model is ~41 GB resident.

End state:
- Ollama installed, serving on the LAN (`0.0.0.0:11434`)
- All five profile models in place — `general` from the Ollama library; `fast`, `reasoning`, `digest`, `analyze` as local GGUFs in `~/.ollama/gguf/`
- Hello-world chat verified

Profile selection (models, quants, sizes, `num_ctx`) lives in [`../../profiles.md`](../../profiles.md).

---

## Prerequisites

| | |
|---|---|
| Hostname `mac-llm-lab` set | `scutil --get LocalHostName` should print `mac-llm-lab` |
| macOS | 14 Sonoma or later (Ollama requirement) |
| Free disk | ~150 GB (model blobs + Ollama re-import + headroom) |
| Power | On AC for the initial pulls |

---

## 1. Install Ollama

Download **Ollama.app** from [ollama.com/download](https://ollama.com/download) and drag it to `/Applications`. Launch it once — a menubar icon appears, and the daemon auto-starts on this and every subsequent login.

Verify:
```sh
ollama --version
# expected: "ollama version is 0.21.x" or newer
```

The CLI shim lands on `PATH` after first launch. If `ollama` isn't found, the binary is at `/Applications/Ollama.app/Contents/Resources/ollama` — symlink it into `/usr/local/bin/` if you'd rather not depend on the shim.

---

## 2. Verify the daemon is up

The .app starts `ollama serve` for you. Confirm:

```sh
lsof -nP -iTCP:11434 | grep LISTEN
# expected: ollama  ...  TCP 127.0.0.1:11434 (LISTEN)
# (we'll switch this to *:11434 in §5)
```

Server logs (if anything misbehaves):
```sh
tail -f ~/.ollama/logs/server.log
```

If port 11434 isn't listening, quit Ollama from the menubar and reopen the .app.

---

## 3. Get the three profile models in place

Open a **second terminal** (leave `ollama serve` running in the first).

### 3a. `general` — Qwen3.6-27B Q8_0 (Ollama library)

```sh
ollama pull qwen3.6:27b-q8_0
```

~30 GB download. Pull is resumable — re-run if it stalls. Verify:

```sh
ollama list
# qwen3.6:27b-q8_0   abc123def...   30 GB   30 seconds ago
```

### 3b. `reasoning` — Nemotron Super 49B v1.5 Q6_K (HuggingFace GGUF)

The Q6_K quant for v1.5 isn't published in the Ollama library, so we download bartowski's GGUF and let `ollama create` import it via Modelfile (next step). GGUFs cache at `~/.ollama/gguf/` — adjacent to Ollama's own `~/.ollama/models/` blob store.

```sh
mkdir -p ~/.ollama/gguf
cd ~/.ollama/gguf

curl -L -C - -O \
  https://huggingface.co/bartowski/nvidia_Llama-3_3-Nemotron-Super-49B-v1_5-GGUF/resolve/main/nvidia_Llama-3_3-Nemotron-Super-49B-v1_5-Q6_K.gguf
```

~41 GB. `-C -` resumes if the connection drops.

### 3c. `digest` — Qwen3-30B-A3B-Instruct-2507 UD-Q4_K_XL (HuggingFace GGUF)

Same pattern — we use unsloth's Dynamic 2.0 quant rather than the stock library version (measurably better quality at this quant level; rationale in [`../../profiles.md`](../../profiles.md)). GGUF goes in `~/.ollama/gguf/`.

```sh
cd ~/.ollama/gguf

curl -L -C - -O \
  https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/main/Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf
```

~17.7 GB.

### 3d. `analyze` — Qwen3-30B-A3B-Thinking-2507 UD-Q6_K_XL (HuggingFace GGUF)

Sibling of `digest` on the Thinking-2507 post-train. Q6_K_XL (heavier than `digest`'s Q4_K_XL) for interpretive quality — rationale in [`../../profiles.md`](../../profiles.md).

```sh
cd ~/.ollama/gguf

curl -L -C - -O \
  https://huggingface.co/unsloth/Qwen3-30B-A3B-Thinking-2507-GGUF/resolve/main/Qwen3-30B-A3B-Thinking-2507-UD-Q6_K_XL.gguf
```

~25 GB.

### 3e. `fast` — Qwen3.6-35B-A3B UD-Q4_K_XL (HuggingFace GGUF)

MoE 35B/3B for snappy triage. Different family/generation from `digest`/`analyze`; rationale in [`../../profiles.md`](../../profiles.md).

```sh
cd ~/.ollama/gguf

curl -L -C - -O \
  https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf
```

~22.4 GB.

### What you should have

```sh
ollama list
# qwen3.6:27b-q8_0   ...   30 GB

ls -lh ~/.ollama/gguf
# nvidia_Llama-3_3-Nemotron-Super-49B-v1_5-Q6_K.gguf       41G
# Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf              18G
# Qwen3-30B-A3B-Thinking-2507-UD-Q6_K_XL.gguf              25G
# Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf                          22G
```

The four GGUFs become full Ollama models in the next step (`Modelfiles/README.md`), where `ollama create` imports them under the `reasoning`, `digest`, `analyze`, and `fast` aliases.

> **Storage notes:** Ollama-pulled blobs live in `~/.ollama/models/`. Local HF GGUFs live in `~/.ollama/gguf/`. After `ollama create` runs against a GGUF, Ollama re-copies it into `~/.ollama/models/blobs/` — yes, ~76 GB of double-storage across both dirs. You can delete the originals from `~/.ollama/gguf/` after `ollama create` if disk is tight, but keeping them around makes alias rebuilds easier.

---

## 4. Hello-world chat

Sanity check that Ollama loads the simplest model on Apple Silicon Metal. Per-profile acceptance tests come once the Modelfile aliases are in place.

```sh
ollama run qwen3.6:27b-q8_0
```

You'll get a `>>>` prompt.

### 4a. Reasoning + thinking blocks
```
A farmer has 17 sheep and all but 9 die. How many are left?
```

**Expected:** answer is **9**. More importantly, you should see a `<think>...</think>` block in the output before the final answer — that's Qwen3.6's thinking mode, on by default. The thinking block confirms the chat template is wired correctly.

### 4b. Code generation
```
Write a TypeScript function `chunk<T>(arr: T[], size: number): T[][]` that splits an array into chunks of the given size. Include one usage example.
```

**Expected:** a generic function with reasonable types and a usage example.

Type `/bye` (or Ctrl+D) to exit.

This confirms Ollama is installed, Qwen3.6 27B Q8_0 loads on Apple Silicon Metal, inference runs at usable speeds (rough target: 15–30 tok/s on M5 Max for Q8_0; lower with thinking on), and the thinking-mode template is wired.

The `reasoning`, `digest`, `analyze`, and `fast` GGUFs aren't testable from `ollama run` until the Modelfile aliases bind them. See [Troubleshooting](#troubleshooting) if anything above fails.

---

## 5. Network exposure for Open WebUI

For Phase 1, Open WebUI in Docker reaches Ollama at `host.docker.internal:11434`. That requires Ollama bound to `0.0.0.0:11434`, not just `127.0.0.1`.

### 5a. Toggle network exposure in Ollama.app

Click the **Ollama menubar icon → Settings**. Toggle on **"Expose Ollama to the network"** (or equivalent — exact label varies by version). This sets `OLLAMA_HOST=0.0.0.0:11434` and persists across reboots.

Quit and reopen Ollama.app (menubar → Quit, then relaunch from `/Applications`) so the daemon picks up the new binding.

### 5b. Other env vars (not in the GUI)

The env vars the Settings UI doesn't expose live in a LaunchAgent that's tracked in this repo at [`launchd/com.mac-llm-lab.ollama-env.plist`](launchd/com.mac-llm-lab.ollama-env.plist). The repo file is the source of truth; install it by copying into `~/Library/LaunchAgents/`:

```sh
cp host/ollama/launchd/com.mac-llm-lab.ollama-env.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.mac-llm-lab.ollama-env.plist
```

This sets, at every login:

| Var | Value | Why |
|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | `1` | ~10–30% faster prefill, lower memory at long context. Bit-identical math. |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Halves KV cache RAM at near-zero quality cost. Requires FA on. |
| `OLLAMA_KEEP_ALIVE` | `30s` | Aggressive eviction so model swaps don't hold memory. Trade: pauses >30s eat a fresh load. |

Then quit and reopen Ollama.app — the daemon reads env vars only on launch.

Verify after relaunch:

```sh
ps -E $(pgrep -f "ollama runner") | tr ' ' '\n' | grep -E "OLLAMA_(FLASH|KV|KEEP)"
# OLLAMA_FLASH_ATTENTION=1
# OLLAMA_KV_CACHE_TYPE=q8_0
# OLLAMA_KEEP_ALIVE=30s
```

> **Editing the values:** edit the repo plist, then re-run `cp` + `launchctl unload` + `launchctl load -w` to swap in the new version, and quit/reopen Ollama.app for the daemon to pick it up.

### 5c. Verify the binding

```sh
lsof -nP -iTCP:11434 | grep LISTEN
# expected: ollama  ...  TCP *:11434 (LISTEN)   ← * = all interfaces
```

If it still shows `127.0.0.1:11434`, the GUI toggle didn't take or the daemon wasn't restarted. Quit + reopen Ollama.app.

### 5d. Verify from the LAN

From another machine on the same network:
```sh
curl http://mac-llm-lab.local:11434/api/tags
```

Returns JSON listing your models. This is the surface the Docker container will use.

### 5e. Stop / restart

- **Stop:** menubar → Ollama → Quit
- **Start:** open Ollama.app from `/Applications` (auto-starts on login otherwise)
- **Logs:** `tail -f ~/.ollama/logs/server.log`

> **Env var summary:**
> - `OLLAMA_HOST=0.0.0.0:11434` — bind to all interfaces (LAN reachable). Set via Settings UI.
> - `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_KEEP_ALIVE=30s` — set via the LaunchAgent at [`launchd/com.mac-llm-lab.ollama-env.plist`](launchd/com.mac-llm-lab.ollama-env.plist) (see §5b for rationale and install).

---

## Troubleshooting

**`ollama serve` says "address already in use"**
Another `ollama` process is already on :11434 (often the Cask `.app`). Close it, or `pkill -f ollama`, then retry.

**Pull or curl download stalls**
Re-run the same command — both `ollama pull` and `curl -C -` resume from where they stopped.

**First chat takes a long time to respond**
First load swaps weights from disk into unified memory. After that it stays resident for `OLLAMA_KEEP_ALIVE`. Check what's hot:
```sh
ollama ps
```

**`<think>` blocks are noisy in CLI**
Expected for now — Qwen3.6's default. Per-profile control belongs in OWUI's per-model config, not this README.

**LAN test (`curl http://mac-llm-lab.local:11434/api/tags`) hangs**
- Confirm `lsof -nP -iTCP:11434` shows `*:11434`, not `127.0.0.1:11434`
- macOS Application Firewall: allow inbound on :11434, or temporarily disable for the test
- mDNS sanity: `ping mac-llm-lab.local` from the LAN client first

**`ollama create` fails with "no such file"**
- Confirm the GGUF is actually there: `ls -lh ~/.ollama/gguf/`
- Confirm the Modelfile `FROM` path matches. Modelfile `FROM` does NOT expand `~` or `$HOME` — it must be an absolute path like `/Users/<you>/.ollama/gguf/<file>.gguf`.

**Want to remove a model**
```sh
ollama rm qwen3.6:27b-q8_0       # remove a pulled model
ollama rm reasoning              # remove an alias (does NOT delete the imported blob)
rm ~/.ollama/gguf/<file>.gguf    # remove the cached HF download
du -sh ~/.ollama                  # confirm freed
```

**Tokens-per-second feels low**
- Confirm `OLLAMA_FLASH_ATTENTION=1` is set (env in plist)
- Check Activity Monitor: GPU should be pegged during inference
- Q8_0 is heavier than Q4 — if you want to A/B `general`, try `qwen3.6:27b` (Q4) for comparison

---

## Next

1. Modelfile aliases — `host/ollama/Modelfiles/{general,fast,reasoning,digest,analyze}.Modelfile` to bind each upstream model under a stable `<profile>` name.
2. Open WebUI Docker stack — `host/docker-compose.yml` reaching Ollama via `host.docker.internal:11434`.
3. Host control script — `host/scripts/mac-llm-lab-hostctl` (up / down / status / warm / openui-url).
4. **Agentic coding (optional, separate stack):** OpenCode + llama-server, installed by `wizard install` — see [`../llama-server/`](../llama-server/) and [`../../wizard/`](../../wizard/). Not required for OWUI.

See [`spec.md` §13](../../spec.md) for the full Phase 1 sequence.
