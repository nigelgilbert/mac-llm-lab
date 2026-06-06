# opencode (containerised) — Config B

Self-hosted [OpenCode](https://github.com/anomalyco/opencode) in Docker, the
challenger harness in the claw-rig vs OpenCode A/B (see
[OPENCODE-HARNESS-AB-PLAN.md](../../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md)).
The sibling [`../claw-code`](../claw-code) container is Config A.

**Scope of this image (#007):** a buildable image with a working `opencode`
binary on PATH, version pinned via build arg. Wiring OpenCode to the second
`llama-server` and a `/workspace` mount (compose, `opencode.json`, provider
config) lands in #008.

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
