# llama-server

> **RETIRED STACK NOTICE (2026-06-10, issue #008).** The claw production
> server this README describes (grammar-constrained `:11435`, LiteLLM
> bridge, `grammars/claw.gbnf`, `scripts/install|start|stop|status|logs`,
> `launchd/com.mac-llm-lab.llama-server*.plist`) has been **deleted** per
> [`OPENCODE-MIGRATION-DECISION.md`](../test/docs/OPENCODE-MIGRATION-DECISION.md);
> the full old stack is archived at the git tag `claw-stack-final`.
> The live serving layer in this directory is now
> [`scripts/opencode-server`](scripts/opencode-server) (tier-parameterized,
> launchd-resident on `:11436`, native `--jinja` tool parsing — no grammar),
> installed by `wizard install` (step 51). `models.conf`, `templates/`, and
> the opencode plists remain current. The body below is kept as historical
> reference (the llama.cpp build steps in §1 are still accurate).

## HISTORICAL: llama-server (claw, grammar-constrained)

A native `llama.cpp` HTTP server on the lab host, dedicated to the `claw` profile, with grammar-constrained tool-call decoding. Sibling to Ollama — same Apple Silicon, same Metal backend, same GGUF on disk, just a different binary serving the one model that benefits from grammar constraints.

```
Apple Silicon Mac (lab host)
├── Ollama         :11434  native  →  general, fast, reasoning, digest, analyze
├── llama-server   :11435  native  →  claw  (this README)
│
└── Docker (thin layer, no models)
    ├── mac-llm-lab-litellm   bridge — routes anthropic/claw → :11435
    ├── mac-llm-lab-openwebui talks to Ollama only
    └── claw-code         talks to bridge
```

## Why this exists

qwen3-coder occasionally emits tool calls as raw JSON instead of the `<tool_call>...</tool_call>` wrapping its template requires (~1-in-3 turns on minimal-system-prompt requests; less in claw's full agent loop where retries hide it). The wrapping format is a property the sampler can be forced to emit — `llama.cpp` exposes a `--grammar-file` flag that masks the token vocabulary at each step so only legal continuations are sampleable. Ollama's API doesn't surface that flag yet (open issue, not shipped). This directory stands up a parallel `llama.cpp` server that does.

End state:
- `llama-server` running on `:11435`, native, launchd-managed, Metal-accelerated
- Loaded with the same `Qwen3-Coder-30B-A3B-Instruct UD-Q6_K_XL` GGUF Ollama was using
- Grammar at [`grammars/claw.gbnf`](grammars/claw.gbnf) enforced at every request — tool-call wrapping cannot fail
- Bridge's `anthropic/claw` route flipped from Ollama (`:11434`) to here (`:11435`)
- `claw` removed from Ollama (`ollama rm claw`) — single source of truth, no double-load

The other five OWUI profiles (`general`, `fast`, `reasoning`, `digest`, `analyze`) keep running on Ollama unchanged.

## Prerequisites

| | |
|---|---|
| GGUF for your tier | Download per §2 — see [`models.conf`](models.conf) for tier → model mapping |
| `host/litellm/` running | the bridge container is what we'll repoint |
| Xcode CLT installed | `xcode-select -p` returns a path; needed to build llama.cpp |
| CMake | a recent CMake. If missing, see §1 for the no-Homebrew install |
| Free disk | ~2 GB for the llama.cpp source + build (the GGUF is reused, no extra weight cost) |

This rig doesn't use Homebrew. All commands below build from source or use `curl`/`pip --user` to install at user scope.

---

## 1. Install llama.cpp

Build `llama-server` from upstream into a user-scope directory. No system writes.

```sh
mkdir -p ~/src
git clone --depth=1 https://github.com/ggml-org/llama.cpp ~/src/llama.cpp
cd ~/src/llama.cpp
cmake -B build -DGGML_METAL=ON -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build build --config Release -j --target llama-server
```

~2–5 min on M5 Max. Output binary: `~/src/llama.cpp/build/bin/llama-server`.

Symlink into a user-scope `PATH` slot (no sudo) so the launchd plist and shell can both find it:

```sh
mkdir -p ~/.local/bin
ln -sf ~/src/llama.cpp/build/bin/llama-server ~/.local/bin/llama-server
~/.local/bin/llama-server --version
# expected: "version: <hash> (<date>)"
```

If `~/.local/bin` isn't on your shell `PATH`, add it (zsh):
```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

> **No CMake on the rig?** Download a release tarball from [cmake.org/download](https://cmake.org/download/), extract under `~/.local/`, symlink the `cmake` binary into `~/.local/bin/`. Avoids both Homebrew and the macOS App Store.

---

## 2. Download the GGUF for your tier

Model is selected by memory tier. See [`models.conf`](models.conf) for the full mapping.

| Tier | Model | Size | Source |
|------|-------|------|--------|
| 16 GB | Qwen2.5-7B-Instruct Q5_K_M | ~5.07 GB | bartowski/Qwen2.5-7B-Instruct-GGUF |
| 32 GB | Qwen3-14B Q4_K_M | ~8.4 GB | unsloth/Qwen3-14B-GGUF |
| 64 GB | Qwen3-Coder-30B Q6_K_XL | ~24 GB | (already on disk from host/ollama/) |

**16 GB** — Qwen2.5-7B-Instruct (dense, non-thinking). Qwen3-8B was tried first but its hybrid-thinking template burns the 256-token wrap-test budget on `<think>` blocks before `<tool_call>` opens — see [`host/test/docs/TIER-EVAL-MEMO-20260427-evening.md`](../test/docs/TIER-EVAL-MEMO-20260427-evening.md). The Coder-7B variant is *not* a drop-in (community-documented `<function_call>` wrapper hallucination — see [HF discussion #22](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/discussions/22)). Use the non-coder Instruct:
```sh
curl -L -C - \
    -o ~/.ollama/gguf/Qwen2.5-7B-Instruct-Q5_K_M.gguf \
    "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q5_K_M.gguf"
```
`-C -` resumes an interrupted download.

**32 GB** — Qwen3-14B dense instruct (~8.4 GB):
```sh
curl -L -C - \
    -o ~/.ollama/gguf/Qwen3-14B-Q4_K_M.gguf \
    "https://huggingface.co/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf"
```

**64 GB** — reuse the file already in `~/.ollama/gguf/` from `host/ollama/` setup:
```sh
ls -lh ~/.ollama/gguf/Qwen3-Coder-30B-A3B-Instruct-UD-Q6_K_XL.gguf
# expected: ~24 GB
```

---

## 3. Drop the grammar in

The grammar file at [`grammars/claw.gbnf`](grammars/claw.gbnf) constrains output to either pure preamble text *or* preamble text followed by a `<tool_call>...</tool_call>` block containing valid JSON. The model still chooses *whether* to call a tool (that's a model-discipline matter, not a grammar matter); the grammar guarantees that *if* it calls one, the format is correct.

The grammar is intentionally permissive on tool *names* and *argument shapes* — it accepts any well-formed JSON inside the wrapping. Reasons:
- claw advertises 50+ tools per request and the set drifts with claw versions; baking the schema into the grammar would couple us to the client.
- The model is already reliable on tool-name and arg-shape correctness; the bug is the wrapping. Solve only what's broken.
- claw rejects unknown tool names downstream anyway, with a clear error.

Validate the grammar parses:
```sh
~/.local/bin/llama-server --grammar-file host/llama-server/grammars/claw.gbnf --help >/dev/null
# expected: no error. A bad grammar errors out at startup.
```

---

## 4. Install the LaunchAgent

The [`scripts/install`](scripts/install) script renders the plist template for your memory tier, copies it to `~/Library/LaunchAgents/`, and bootstraps the LaunchAgent.

```sh
./host/llama-server/scripts/install            # auto-detects from RAM
./host/llama-server/scripts/install --size 16  # explicit override
```

Size auto-detection: `< 24 GB` → 16, `24–48 GB` → 32, `≥ 48 GB` → 64. Override anytime with `--size` or `LLAMA_TIER=16 ./scripts/install`.

Verify it's listening:
```sh
sleep 15  # model load takes ~10–20s
curl -fsS http://localhost:11435/health
# expected: {"status":"ok"}

curl -fsS http://localhost:11435/v1/models | python3 -m json.tool
# expected: a single model with id "claw"
```

`tail -f /tmp/llama-server.log` shows model load + per-request logs.

---

## 5. Remove `claw` from Ollama

Single source of truth — `claw` lives in `llama-server` from now on. Removing the Ollama alias prevents accidental double-loads of the same 24 GB into unified memory:

```sh
ollama rm claw
ollama list  # claw should be absent; the GGUF on disk is unaffected
```

The Modelfile at [`../ollama/Modelfiles/claw.Modelfile`](../ollama/Modelfiles/claw.Modelfile) stays in the repo for reference and rollback (§8). The unused-Modelfile note belongs in [`../ollama/Modelfiles/README.md`](../ollama/Modelfiles/README.md) — see §6.

---

## 6. Repoint the bridge

The bridge config at [`../litellm/litellm-config.yaml`](../litellm/litellm-config.yaml) needs the `claw` and `anthropic/claw` routes flipped to llama-server's port. The change is small and reversible.

Edit `host/litellm/.env` to add:
```
LLAMA_SERVER_HOST=host.docker.internal
LLAMA_SERVER_PORT=11435
```

Edit `host/litellm/docker-compose.yml` to forward the new env into the container:
```yaml
    environment:
      ...existing...
      - LLAMA_SERVER_BASE=http://${LLAMA_SERVER_HOST}:${LLAMA_SERVER_PORT}/v1
```

Edit `host/litellm/litellm-config.yaml` — both claw routes:
```yaml
  - model_name: claw
    litellm_params:
      model: openai/claw
      api_base: os.environ/LLAMA_SERVER_BASE   # was OLLAMA_OPENAI_BASE
      api_key: llama-server-no-auth

  - model_name: anthropic/claw
    litellm_params:
      model: openai/claw
      api_base: os.environ/LLAMA_SERVER_BASE   # was OLLAMA_OPENAI_BASE
      api_key: llama-server-no-auth
```

Restart the bridge:
```sh
cd host/litellm
docker compose up -d --force-recreate
```

The `use_chat_completions_url_for_anthropic_messages: true` flag and the [`patches/streaming_iterator.py`](../litellm/patches/streaming_iterator.py) volume mount continue to apply unchanged — both fixes are upstream-of-Ollama bugs at the LiteLLM layer, equally relevant against llama-server.

---

## 7. Verify

The patch test (raw bridge SSE) — same script we use for the Ollama path. After the flip, target rate goes from ~3-in-5 wraps to 5-in-5:

```sh
KEY=$(grep ^LITELLM_MASTER_KEY= host/litellm/.env | cut -d= -f2)
PASS=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sN http://localhost:4000/v1/messages \
    -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"anthropic/claw","max_tokens":256,"stream":true,
         "tools":[{"name":"write_file","description":"Write a file",
           "input_schema":{"type":"object",
             "properties":{"path":{"type":"string"},"content":{"type":"string"}},
             "required":["path","content"]}}],
         "messages":[{"role":"user","content":"Use write_file to create x.py with content print(1)"}]}' \
    | grep -q '"stop_reason": "tool_use"'; then
    PASS=$((PASS+1))
  fi
done
echo "$PASS/10 wraps succeeded"
# Pre-llama-server target: 6-7/10. With grammar: 10/10 expected.
```

End-to-end via claw — the eval suite from earlier sessions still applies, no changes needed:
```sh
rm -rf $WORKSPACE/* $WORKSPACE/.claw 2>/dev/null
docker compose -f client/claw-code/docker-compose.yml exec -T claw \
  claw --model anthropic/claw --output-format text --dangerously-skip-permissions \
  prompt "create hello.py with one line: print('hello')"
test "$(cat $WORKSPACE/hello.py)" = "print('hello')" && echo PASS || echo FAIL
```

---

## Operations

| | |
|---|---|
| Status | `launchctl list \| grep mac-llm-lab.llama-server` |
| Restart | `launchctl kickstart -k gui/$(id -u)/com.mac-llm-lab.llama-server` |
| Stop | `launchctl unload ~/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist` |
| Start (after stop) | `launchctl load -w ~/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist` |
| Logs | `tail -f /tmp/llama-server.log` |
| Live process check | `lsof -nP -iTCP:11435 \| grep LISTEN` |
| Manual run (debugging) | unload the plist first, then run the binary by hand with the same args |

`launchctl kickstart -k` is the Mac equivalent of `systemctl restart` — it sends SIGTERM and the agent's `KeepAlive=true` brings it back. Use after editing the plist values; a re-load (`unload && load -w`) is needed only if you've changed the plist file itself.

---

## Configuration

The plist embeds all tunables. Edit and re-load to change. Most defaults mirror `host/ollama/Modelfiles/claw.Modelfile` (kept in lockstep so the backend-A/B harness measures backend differences, not config differences) — exception: `repeat-penalty` here is `1.05`, vs `1.2` in the Modelfile, since the grammar enforces single-tool emission and the higher penalty was suppressing `\n`. See [docs/TODO-PROSE-SMUSH.md](docs/TODO-PROSE-SMUSH.md) for the sampler history.

| Flag | Value | Notes |
|---|---|---|
| `--port` | `11435` | One slot above Ollama's `11434` |
| `--host` | `0.0.0.0` | LAN-reachable; bridge needs it via `host.docker.internal` |
| `--model` | tier-dependent (see [`models.conf`](models.conf)) | 16GB: Qwen2.5-7B-Instruct Q5_K_M; 32GB: Qwen3-14B Q4_K_M; 64GB: Qwen3-Coder-30B Q6_K_XL |
| `--alias` | `claw` | What `/v1/models` advertises and what the bridge sends as `model` |
| `--ctx-size` | tier-dependent (default 32768) | Set per tier in [`models.conf`](models.conf) |
| `-ngl` | `999` | All layers on Metal (Apple Silicon — unified memory makes this free) |
| `-fa` | on | Flash attention; matches `OLLAMA_FLASH_ATTENTION=1` |
| `--cache-type-k` / `--cache-type-v` | `q8_0` | Halves KV cache; matches `OLLAMA_KV_CACHE_TYPE=q8_0` |
| `--temp` | `0.4` | Matches Modelfile |
| `--top-p` | `0.8` | " |
| `--top-k` | `20` | " |
| `--repeat-penalty` | `1.05` | Lowered from 1.2 (2026-04-27) — see docs/TODO-PROSE-SMUSH.md sampler-history section |
| `--repeat-last-n` | `256` | " |
| `--grammar-file` | `host/llama-server/grammars/claw.gbnf` | The point of all this |

The Modelfile's `SYSTEM` and `TEMPLATE` directives don't apply here — those are Ollama's wrapper. llama-server reads the chat template embedded in the GGUF itself, which for Qwen3-Coder is the right tool-use format already. The discipline rules that the Modelfile injected via TEMPLATE need a different home — see §9.

---

## 8. Rollback

If grammar-constrained decoding doesn't pull its weight on the eval suite, or you just want to revert:

```sh
# 1. Stop llama-server
launchctl unload ~/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist
rm ~/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist

# 2. Recreate the Ollama claw alias
ollama create claw -f host/ollama/Modelfiles/claw.Modelfile

# 3. Revert the bridge config — flip the two claw routes' api_base back to OLLAMA_OPENAI_BASE
$EDITOR host/litellm/litellm-config.yaml
cd host/litellm && docker compose up -d --force-recreate
```

The `host/llama-server/` directory and the built `llama-server` binary can stay on disk — small footprint, useful for re-trying later.

---

## 9. Where the Modelfile discipline rules go

The TEMPLATE-baked discipline rules from [`../ollama/Modelfiles/claw.Modelfile`](../ollama/Modelfiles/claw.Modelfile) (the "ONE tool call per response", "Trust tool results", etc.) don't apply automatically against llama-server, because llama-server reads the chat template from GGUF metadata directly and ignores Ollama's Modelfile.

The original spec called for `--system-prompt-file` to inject the rules at server level. That flag has been removed from upstream llama.cpp — the smoke test on this commit (`5594d13`) errors out on it. The remaining hook is **workspace `CLAUDE.md`**: claw-code already discovers `CLAUDE.md` in the workspace root and concatenates it to the system prompt it sends. Drop the rules there and they apply per workspace.

The canonical text of the rules lives at [`docs/system-prompt.md`](docs/system-prompt.md) — it's the same six lines that used to live in the Modelfile TEMPLATE. To use them in a workspace:
```sh
cp host/llama-server/docs/system-prompt.md path/to/workspace/CLAUDE.md
```

(If a future llama.cpp restores a `--system-prompt-file`-equivalent flag, fold the rules back into the plist and remove this step.)

---

## 10. CLI integration

Two existing CLIs route around the host stack:

- [`../scripts/mac-llm-lab-hostctl`](../scripts/mac-llm-lab-hostctl) — runs on the lab host. Manages the docker stack and warms Ollama profiles.
- [`../../client/mac-llm-lab`](../../client/mac-llm-lab) — runs on client laptops. SSHes the host to call hostctl.

Today both whitelist five profiles (`general fast reasoning digest analyze`). `claw` is intentionally absent because it's only consumed via the bridge by `claw-code`, never via OWUI's chat URL. After llama-server is in place, `claw` joins the whitelist and the `warm` command becomes profile-aware about which daemon it reaches.

Concrete edit list (deferred to the implementation pass):

| Script | Change |
|---|---|
| `mac-llm-lab-hostctl` | Add `claw` to `PROFILES` |
| `mac-llm-lab-hostctl` | Add `LLAMA_SERVER_API="${LLAMA_SERVER_API:-http://127.0.0.1:11435}"` next to `OLLAMA_API` |
| `mac-llm-lab-hostctl` | Make `cmd_warm` route by profile: `claw` → llama-server `/v1/chat/completions`, others → Ollama `/api/generate` |
| `mac-llm-lab-hostctl` | Extend `cmd_status` with a `== llama-server ==` block: `curl :11435/health`, show advertised model |
| `client/mac-llm-lab` | Add `claw` to `profile_to_model` validator |
| `client/mac-llm-lab` | Update `usage()` profile list |

Behavioral note for `warm claw`: llama-server runs with `KeepAlive=true` in the launchd plist, so the model is always resident. Warming is a reachability + first-token-latency probe rather than an actual load, but the user-visible UX stays identical (`mac-llm-lab warm -p claw` returns when the model is responsive — typically <100 ms vs. ~5 s for an Ollama cold load).

Reference shape for the modified `cmd_warm`:

```sh
cmd_warm() {
  [ "${1:-}" ] || err "usage: mac-llm-lab-hostctl warm <profile>"
  profile=$(profile_to_model "$1")
  case "$profile" in
    claw)
      log "warming claw on llama-server..."
      curl -fsS -X POST "$LLAMA_SERVER_API/v1/chat/completions" \
        -H 'Content-Type: application/json' \
        -d '{"model":"claw","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' \
        >/dev/null || err "warm failed for claw"
      ;;
    *)
      log "warming $profile on Ollama (keep_alive=$KEEP_ALIVE)..."
      curl -fsS -X POST "$OLLAMA_API/api/generate" \
        -H 'Content-Type: application/json' \
        -d "{\"model\":\"$profile\",\"prompt\":\"\",\"keep_alive\":\"$KEEP_ALIVE\"}" \
        >/dev/null || err "warm failed for $profile"
      ;;
  esac
  log "$profile warmed"
}
```

Net surface: same verbs (`warm`, `status`), one new profile in the whitelist, smarter routing under the hood. No new commands. The `chat` command is unaffected — `claw` still doesn't make sense as an OWUI deep-link target.

---

## Phase acceptance gates

1. `curl http://localhost:11435/health` returns 200 within 5s of agent load.
2. `curl http://localhost:11435/v1/models` lists exactly one model, id `claw`.
3. The 10x SSE wrap test from §7 hits 10/10 (vs ~6-7/10 against Ollama on the same prompt).
4. Eval A (the one-shot `hello.py` test) passes in ≤2 turns.
5. Eval B (3 parallel files) passes in ≤2 turns.
6. Claw `doctor` from inside `client/claw-code/` reports green.
7. `mac-llm-lab-hostctl warm claw` returns success in <500ms (warm is a probe, not a load).
8. `mac-llm-lab-hostctl status` includes a `== llama-server ==` block showing healthy + model `claw`.
9. `mac-llm-lab warm -p claw` from a client laptop returns success (proves SSH path + hostctl edits land together).

---

## Troubleshooting

**`llama-server: command not found`**
The symlink at `~/.local/bin/llama-server` isn't on `PATH`, or the build didn't produce the binary. Run `ls -l ~/src/llama.cpp/build/bin/llama-server` to confirm.

**LaunchAgent loads but `:11435` isn't listening**
Tail `/tmp/llama-server.log` — model-load failures (missing GGUF, bad grammar, malformed args) print there.

**Grammar errors at startup**
`llama-server` exits with the offending line. Confirm `host/llama-server/grammars/claw.gbnf` is valid: `llama-gbnf-validator < grammars/claw.gbnf` if you built that target, or paste into [grammar.intrinsiclabs.ai](https://grammar.intrinsiclabs.ai/).

**Bridge times out hitting `:11435`**
- LaunchAgent is loaded but model is still loading — first request after install can take 10–20s.
- `--host 0.0.0.0` is required for `host.docker.internal` to resolve from inside the LiteLLM container.

**Two daemons fighting for the GGUF**
Shouldn't happen if §5 was done — Ollama's `claw` alias is gone, so Ollama won't load it. If somehow both are loaded, `ollama ps` and the llama-server log will both show the file resident; pick one and stop the other.

**Wrap rate didn't improve much**
Run `tail /tmp/llama-server.log | grep grammar` — if grammar isn't engaging, the `--grammar-file` flag in the plist isn't pointing at a valid path, or the grammar itself is too permissive. Sanity-check by removing the grammar flag and confirming the rate gets *worse* (it should, by ~30 percentage points).

---

## Pairs with

- [`../ollama/`](../ollama/) — sibling native daemon, serves the OWUI 5 profiles. Same install pattern (native, launchd-managed), different scope.
- [`../litellm/`](../litellm/) — bridge that gets one route flipped to point here. Patch and config flag from prior work both stay relevant.
- [`../../client/claw-code/`](../../client/claw-code/) — the only client that consumes this server (via the bridge).
