# Install OpenCode from its prebuilt npm distribution, ship a slim runtime image.
# Upstream: https://github.com/anomalyco/opencode  (npm package: opencode-ai)
#
# Unlike client/claw-code/Dockerfile there is NO build stage: OpenCode ships
# prebuilt, platform-specific binaries (pulled in as optionalDependencies of the
# `opencode-ai` npm package — e.g. opencode-linux-arm64), so a single slim
# runtime stage is enough. claw is built from Rust source; opencode is not.

FROM debian:bookworm-slim

# Pinned OpenCode release. claw-code pins a git ref via CLAW_REF; here we pin the
# published npm version. Default to a concrete version (not a moving tag) so the
# image is reproducible and `opencode --version` reports exactly this. Override:
#   docker build --build-arg OPENCODE_VERSION=1.16.2 -t opencode:local .
ARG OPENCODE_VERSION=1.16.2

# Runtime deps mirror claw-code's slim stage, minus the claw-specific bits:
#   ca-certificates, curl, git, nodejs  -> kept (same conventions as claw-code)
#   libssl3  -> dropped from the explicit list: claw installs it for its
#               Rust/OpenSSL binary; OpenCode's self-contained prebuilt binary
#               doesn't need it (nodejs still pulls it in transitively, so it's
#               present in the image — just not a dep we declare here)
#   rlwrap   -> dropped: claw-code wraps a line-oriented REPL; OpenCode ships its
#               own full-screen TUI, which rlwrap would interfere with
# nodejs/npm is required both to install opencode-ai and at runtime (OpenCode
# fetches provider packages such as @ai-sdk/openai-compatible on demand).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
    && curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* \
    # Fail the build early if the pinned binary isn't actually on PATH / runnable.
    && opencode --version

WORKDIR /workspace
