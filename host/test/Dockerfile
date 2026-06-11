# Plain Node toolchain image (`mac-llm-lab-test:local`) for the eval harness:
#   - unit tests:    docker compose run --rm test            (CMD below)
#   - one-off node:  docker run --rm -v $PWD:$PWD -w $PWD/host/test \
#                      --entrypoint node mac-llm-lab-test:local scripts/<x>.mjs ...
#     (this is the docs/data/README.md re-derivation incantation — keep it working)
#
# The claw binary this image used to COPY from claw-code:local is gone with the
# claw stack (#008/#010; archived at tag `claw-stack-final`) — nothing here
# depends on that image anymore. Agent cells run in the SIBLING opencode
# container via the baked eval-runner image (Dockerfile.runner), never here:
# this image has no docker CLI by design.
#
# Zero npm dependencies — tests run on Node's built-in test runner (`node --test`)
# against ESM sources, so there's no `npm install` layer to bust. lib/ and
# __tests__/ are baked for standalone use, but the canonical sweep path
# (run-config-ab.sh) always path-matches the live working tree instead.

FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /test

COPY package.json  ./
COPY lib           ./lib
COPY scripts       ./scripts
COPY __tests__     ./__tests__
# Committed canonical evidence registries (docs/data/README.md): baked so the
# published-number golden tests (issue #025,
# __tests__/scripts/config-ab-renderer-goldens.test.js) can re-derive the
# published CIs inside the compose `test` service. Read-only evidence — no
# test may write here.
COPY docs/data     ./docs/data

RUN mkdir -p /workspace

# Default: the unit-test suite only (__tests__/lib + __tests__/scripts).
# tier-eval cells need a live OpenCode server + docker sibling and are driven
# by run-config-ab.sh, not by this image's CMD. (sh -c for the globs — node 24
# does not expand directory/glob positional args itself.)
CMD ["sh", "-c", "node --test --test-concurrency=1 --test-reporter=spec __tests__/lib/*.test.js __tests__/scripts/*.test.js"]
