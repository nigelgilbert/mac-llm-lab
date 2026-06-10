# opencode (containerised) — Config B

Self-hosted [OpenCode](https://github.com/anomalyco/opencode) in Docker, the
challenger harness in the claw-rig vs OpenCode A/B (see
[OPENCODE-HARNESS-AB-PLAN.md](../../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md)).
The sibling [`../claw-code`](../claw-code) container is Config A.

**Scope of this image (#007):** a buildable image with a working `opencode`
binary on PATH, version pinned via build arg.

**Wiring (#008):** [`docker-compose.yml`](docker-compose.yml) mounts
`${WORKSPACE}:/workspace` and points OpenCode at the **second `llama-server`**
(the #005 OpenCode-dedicated, tier-64 instance on `:11436`) via the
`@ai-sdk/openai-compatible` provider in [`opencode.json`](opencode.json). No
`ANTHROPIC_BASE_URL` and no LiteLLM on this side — OpenCode talks straight to the
llama-server's openai-compatible endpoint (which needs no auth). See
[Run / wiring](#run--wiring) below.

## `oc` — the daily-driver wrapper (migration #003)

[`bin/oc`](bin/oc) is the one-command front door (migration decision §2.10):
from any directory, `oc` opens the OpenCode TUI on `$PWD` and `oc run "<prompt>"`
does a headless one-shot — asserting the tier server is green (booting it if
not), mounting `$PWD` at `/workspace` plus the tier-matched `opencode.json`
**and the global prompt** (`AGENTS.md`, the #001 winner) into the container.
Prompt-injection preconditions are asserted **fail-loud** (exit 2) because
injection failure is silent in OpenCode; `oc probe` is the deterministic
wire-capture injection oracle. Tier select: `oc -t 16|32|64` (non-64 boots the
on-demand server and stops it on exit). Run `oc help` for the full contract.
The wizard (#007) installs `bin/oc` onto PATH; until then, symlink it or call
it by path. Note `autoupdate: false` in the mounted configs: the TUI would
otherwise self-update past the image's pinned `OPENCODE_VERSION` mid-session.

## Why no build stage

claw-code compiles `claw` from Rust source in a `rust:bookworm` builder stage.
OpenCode ships prebuilt, platform-specific binaries via the `opencode-ai` npm
package (the right one — e.g. `opencode-linux-arm64` — is pulled in as an
optionalDependency), so this is a single `debian:bookworm-slim` stage that just
`npm install -g opencode-ai@<version>`. Same base + Node-via-nodesource
convention as claw-code. `rlwrap` is dropped (claw wraps a line REPL; OpenCode
has its own TUI), and `libssl3` is no longer installed explicitly (claw needs it
for its Rust binary) — though nodejs still pulls it in transitively.

## Build

```sh
cd client/opencode
docker build -t opencode:local .                          # uses the pinned default
docker build --build-arg OPENCODE_VERSION=1.16.2 -t opencode:local .   # override the pin
```

`OPENCODE_VERSION` defaults to a concrete published npm version (not a moving
tag) so the image is reproducible — unlike claw-code's `CLAW_REF=main` default.

## Verify

```sh
docker run --rm opencode:local opencode --version   # prints the pinned version
```

The build also runs `opencode --version` as a final layer, so a bad pin or a
missing-on-PATH binary fails the build rather than shipping a broken image.

## Run / wiring

```sh
cd client/opencode
cp .env.example .env        # set WORKSPACE (defaults to ./workspace)
docker compose up -d        # builds opencode:local if needed, then idles
```

- **`docker-compose.yml`** bind-mounts `${WORKSPACE}:/workspace` and mounts
  [`opencode.json`](opencode.json) read-only at
  `/root/.config/opencode/opencode.json` (OpenCode's global config path for the
  root user). The config is **mounted, not baked**, so it stays repo-visible and
  editable without rebuilding the image.
- **`opencode.json`** declares one provider, `llama-local`
  (`@ai-sdk/openai-compatible`), with
  `baseURL = http://host.docker.internal:11436/v1` and model id `opencode` — the
  `--alias` the #005 server serves under. `host.docker.internal` resolves to the
  host via the `extra_hosts: host-gateway` entry (OrbStack), so this works even
  when OpenCode runs on the lab box itself. `apiKey` is a throwaway: the
  llama-server does not check it.
- **No `ANTHROPIC_BASE_URL`, no LiteLLM** on this side. That bridge plumbing is
  the claw-code (Config A) mechanism only; Config B is a direct
  container → host llama-server hop.

### Verify connectivity (the #008 acceptance check)

With the #005 server up on `:11436`, from inside the container:

```sh
docker compose run --rm opencode curl -s -o /dev/null -w '%{http_code}\n' \
  host.docker.internal:11436/health      # -> 200
```

A full headless one-shot agent run (`opencode run "<prompt>"`) is proven end-to-end
in #009 — exit/cleanup semantics and the **models.dev bootstrap-hang fix** (now baked
into [`docker-compose.yml`](docker-compose.yml) as `extra_hosts: models.dev:127.0.0.1`)
are recorded in [`docs/HEADLESS-ONESHOT.md`](docs/HEADLESS-ONESHOT.md).
