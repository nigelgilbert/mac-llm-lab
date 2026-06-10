# wizard

A pure-Bash, curl-only install wizard for the `mac-llm-lab` **code stack**
(claw-code + LiteLLM bridge + llama-server). The wizard itself never invokes
Homebrew. Strictly idempotent.

## Quickstart

```sh
./wizard/wizard install     # interactive multi-step install
./wizard/wizard test        # ephemeral CLI tester orb pings the live bridge
./wizard/wizard doctor      # read-only state inspection
./wizard/wizard --help
```

## Topologies

- **full-local** — host + client both on this Mac. Installs Xcode CLT, cmake,
  llama.cpp, OrbStack, Ollama, the tier GGUF, builds LiteLLM and claw-code.
- **client-only** — this Mac is a client; host runs elsewhere on LAN
  (default `mac-llm-lab.local`). Installs OrbStack and claw-code only.

## Memory tiers

| Tier | Model                              | GGUF size |
|------|-------------------------------------|-----------|
| 16   | Qwen3.5-9B IQ4_XS                   | ~5.0  GB  |
| 32   | Qwen3.5-9B UD-Q5_K_XL               | ~6.5  GB  |
| 64   | Qwen3.6-35B-A3B UD-Q4_K_XL          | ~21   GB  |

Tier auto-detects from `sysctl hw.memsize`; the slider lets you override
with ←/→ arrow keys.

## Idempotency

Every step is check-then-act. If the desired end state is already true,
the step prints `✓ already done` and returns. The wizard never bootouts a
running launchd service, never restarts a running container, never
overwrites an existing `.env`. This makes it safe to re-run on a live
system — including the M5 host while evals are running.

## Files written

The wizard owns `wizard/` and writes generated env files into:

- `client/claw-code/.env` (full-local + client-only)
- `host/litellm/.env`     (full-local only)
- `client/opencode/opencode.remote{,.16,.32}.json` (client-only; tier configs
  pointed at the LAN serving host — derived, gitignored)

OpenCode client install surface (#007, both topologies):

- `~/.config/opencode/AGENTS.md` — the global agent prompt (copy of
  `host/llama-server/docs/system-prompt.md`; an existing customized file is
  never overwritten)
- `~/.local/bin/oc` — symlink to `client/opencode/bin/oc`

Plus runtime state in `wizard/.state` (chmod 600; stores the LiteLLM master
key) and logs in `wizard/.logs/`. Both gitignored.

## Trust boundaries

The wizard is curl-only and pure Bash, but the install path executes one
remote script: OrbStack's `curl -fsSL https://orbstack.dev/install.sh | sh`
(see `steps/43-dep-orbstack.sh`). This is the upstream-recommended install
method. If you'd rather not pipe-to-shell, install OrbStack manually from
<https://orbstack.dev> first; the wizard will detect it and skip the step.

OrbStack's own install script may use Homebrew if it is already present on
the system — that's an upstream behavior, not the wizard's.
