# wizard

A pure-Bash, curl-only install wizard for the `mac-llm-lab` **code stack**
(OpenCode client container + a dedicated, launchd-resident llama-server +
the `oc` wrapper CLI). The wizard itself never invokes Homebrew. Strictly
idempotent.

> The wizard previously installed the claw-code + LiteLLM-bridge stack;
> that stack was retired on 2026-06-10 — see
> [`OPENCODE-MIGRATION-DECISION.md`](../host/test/docs/OPENCODE-MIGRATION-DECISION.md).
> The last claw-capable wizard is archived at the git tag `claw-stack-final`.

## Quickstart

```sh
./wizard/wizard install     # interactive multi-step install
./wizard/wizard test        # ephemeral CLI tester orb (docker | ollama probes)
./wizard/wizard doctor      # read-only state inspection
./wizard/wizard --help
```

## Topologies

- **full-local** — host + client both on this Mac. Installs Xcode CLT, cmake,
  llama.cpp, OrbStack, Ollama, the tier GGUF, the launchd-resident OpenCode
  llama-server, the `opencode:local` image, the global prompt, and `oc`.
- **client-only** — this Mac is a client; the serving llama-server runs
  elsewhere on the LAN. Installs OrbStack, the `opencode:local` image,
  remote tier configs pointed at the serving host, the global prompt,
  and `oc`.

## Memory tiers

| Tier | Model                              | GGUF size | Port  |
|------|-------------------------------------|-----------|-------|
| 16   | Qwen3.5-9B IQ4_XS                   | ~5.0  GB  | 11437 |
| 32   | Qwen3.5-9B UD-Q5_K_XL               | ~6.5  GB  | 11438 |
| 64   | Qwen3.6-35B-A3B UD-Q4_K_XL          | ~21   GB  | 11436 |

Tier auto-detects from `sysctl hw.memsize`; the slider lets you override
with ←/→ arrow keys. The chosen tier's server is installed launchd-resident
(`com.mac-llm-lab.opencode-server*`); the other tiers boot on demand via
`oc -t 16|32|64`.

## Idempotency

Every step is check-then-act. If the desired end state is already true,
the step prints `✓ already done` and returns. The wizard never bootouts a
running launchd service, never restarts a running container, never
overwrites a customized prompt or a foreign `oc` on PATH. This makes it
safe to re-run on a live system — including the M5 host while evals are
running.

## Files written

The wizard owns `wizard/` and writes:

- `client/opencode/opencode.remote{,.16,.32}.json` (client-only; tier configs
  pointed at the LAN serving host — derived, gitignored)
- `~/Library/LaunchAgents/com.mac-llm-lab.opencode-server*.plist` (full-local;
  rendered by `host/llama-server/scripts/opencode-server install`)
- `~/.config/opencode/AGENTS.md` — the global agent prompt (copy of
  `host/llama-server/docs/system-prompt.md`; an existing customized file is
  never overwritten)
- `~/.local/bin/oc` — symlink to `client/opencode/bin/oc`

Plus runtime state in `wizard/.state` (chmod 600) and logs in
`wizard/.logs/`. Both gitignored.

## Smoke (step 61)

Every install ends with two assertions through the installed `oc`:

1. `oc probe` — the deterministic prompt-injection wire-capture oracle
   (no model needed; a fresh install must not ship a null prompt).
2. `oc run` in a scratch git workspace — a real artifact through the tier
   server (client-only: explicit SKIP if the LAN host isn't reachable).

## Trust boundaries

The wizard is curl-only and pure Bash, but the install path executes one
remote script: OrbStack's `curl -fsSL https://orbstack.dev/install.sh | sh`
(see `steps/43-dep-orbstack.sh`). This is the upstream-recommended install
method. If you'd rather not pipe-to-shell, install OrbStack manually from
<https://orbstack.dev> first; the wizard will detect it and skip the step.

OrbStack's own install script may use Homebrew if it is already present on
the system — that's an upstream behavior, not the wizard's.
