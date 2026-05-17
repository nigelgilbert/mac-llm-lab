#!/usr/bin/env bash
# Utility: run a specific test file (or pattern) inside the test container.
# Resolves __tests__/**/<pattern>.test.js on the host, then hands the matches
# to `node --test` in the docker compose `test` service.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pattern> [extra node args...]" >&2
  echo "  matches __tests__/**/<pattern>.test.js" >&2
  exit 1
fi

pattern="$1"
shift

cd "$(dirname "$0")"

matches=()
# read loop instead of `mapfile` — macOS ships bash 3.2, which lacks mapfile
while IFS= read -r line; do
  matches+=("$line")
done < <(find __tests__ -type f -name "${pattern}.test.js")

if [[ ${#matches[@]} -eq 0 ]]; then
  echo "no tests matched: ${pattern}.test.js" >&2
  exit 1
fi

echo "running ${#matches[@]} test file(s):" >&2
printf '  %s\n' "${matches[@]}" >&2

# Mount the whole __tests__ tree (not just __tests__/lib) so the matched
# files we found on the host are the ones executed in the container —
# otherwise a newly-added or edited test on the host would either silently
# run a stale copy from the image or fail to resolve.
#
# Pass `node ...` as the service command (rather than --entrypoint node) so
# entrypoint.sh's /root/.claw/settings.json alias-table setup still runs
# before our node invocation — without it, this helper would exercise a
# different claw configuration than `npm test`/the sweep runners.
docker compose run --rm \
  -v "$PWD/__tests__:/test/__tests__" \
  -v "$PWD/lib:/test/lib" \
  -v "$PWD/scripts:/test/scripts" \
  test node --test \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout \
    "$@" "${matches[@]}"
