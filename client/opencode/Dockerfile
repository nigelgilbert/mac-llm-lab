# Install OpenCode from its prebuilt npm distribution, ship a slim runtime image.
# Upstream: https://github.com/anomalyco/opencode  (npm package: opencode-ai)
#
# Unlike client/claw-code/Dockerfile there is NO build stage: OpenCode ships
# prebuilt, platform-specific binaries (pulled in as optionalDependencies of the
# `opencode-ai` npm package — e.g. opencode-linux-arm64), so a single slim
# runtime stage is enough. claw is built from Rust source; opencode is not.

# Pinned Node MAJOR (#027). This image used to bolt Nodesource's setup script
# onto debian:bookworm-slim — a `curl | bash -` of a moving target, which both
# executed a fetched script at build time (supply-chain surface) and let the
# LTS line silently advance under the same Dockerfile, undercutting the
# OPENCODE_VERSION reproducibility rationale below. Now the pin IS the base
# image: Docker's official node:<major>-bookworm-slim (same convention as
# host/test/Dockerfile), no fetched-script execution at all. The post-install
# `node --version` assertion is kept: it now guards that the tag Docker
# resolved actually agrees with the ARG (e.g. a stale/mistagged local image).
ARG NODE_MAJOR=24

FROM node:${NODE_MAJOR}-bookworm-slim

# Pinned OpenCode release. claw-code pins a git ref via CLAW_REF; here we pin the
# published npm version. Default to a concrete version (not a moving tag) so the
# image is reproducible and `opencode --version` reports exactly this. Override:
#   docker build --build-arg OPENCODE_VERSION=1.16.2 -t opencode:local .
ARG OPENCODE_VERSION=1.16.2

# Pre-FROM ARGs go out of scope at FROM; re-declare NODE_MAJOR (no default —
# inherits the value used for the base tag) so the assertion below can see it.
ARG NODE_MAJOR

# Runtime deps mirror claw-code's slim stage, minus the claw-specific bits:
#   ca-certificates, curl, git  -> kept (same conventions as claw-code).
#               Checked: node:24-bookworm-slim ships NONE of these as packages
#               (node carries its own compiled-in CA bundle, and the slim image
#               purges its build-time fetch tools), so none are redundant here.
#               curl is also a runtime dep: oc's probe readiness loop runs
#               curl inside this container.
#   libssl3  -> dropped from the explicit list: claw installs it for its
#               Rust/OpenSSL binary; OpenCode's self-contained prebuilt binary
#               doesn't need it (nodejs still pulls it in transitively, so it's
#               present in the image — just not a dep we declare here)
#   rlwrap   -> dropped: claw-code wraps a line-oriented REPL; OpenCode ships its
#               own full-screen TUI, which rlwrap would interfere with
# node/npm come from the base image and are required both to install
# opencode-ai and at runtime (OpenCode fetches provider packages such as
# @ai-sdk/openai-compatible on demand).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/* \
    # Assert the pinned major actually landed (base-tag/ARG agreement guard).
    && node --version | grep -q "^v${NODE_MAJOR}\." \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    # Fail the build early if the pinned binary isn't actually on PATH / runnable.
    && opencode --version

WORKDIR /workspace
