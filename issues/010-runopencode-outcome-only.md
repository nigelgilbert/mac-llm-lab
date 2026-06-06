# `runOpenCode` runner (outcome-only)

**Type**: AFK

**Status:** ✅ Done — 7a39257

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.3

## What to build

A `runOpenCode({ prompt, signal, timeoutMs }) → RunnerResult` runner that matches the
existing `Runner` typedef and the `{ code, stdout, stderr, elapsedMs, runDir,
terminal_status }` shape, so it slots into `runAgent` as a drop-in `runner`. Reuse
the combined-signal + **timeout-resolves-not-rejects** pattern so the registry
reporter still flushes on timeout.

Critically, it must produce a real `runDir` — `runAgent` emits the `runDir`
diagnostic the reporter needs to write a row. Outcome-only: no transcript adapter
yet; pass/fail comes from the workspace post-script (#001). Capture the OpenCode exit
code per the semantics documented in #009.

## Acceptance criteria

- [x] `runOpenCode` invokes the OpenCode container one-shot and returns a `RunnerResult` matching the `Runner` typedef
- [x] Returns a real, populated `runDir`; on timeout it **resolves** with `terminal_status: 'timeout'` (never rejects)
- [x] Combined-signal honors both caller `signal` and internal timeout
- [x] Agent exit code captured (telemetry), not used as a pass gate
- [x] Invoking it directly on a sample prompt yields a row-writable `runDir` with workspace mutation

## Blocked by

- #009

## Delivered

- **Runner:** [`host/test/lib/opencode.js`](../host/test/lib/opencode.js) — `runOpenCode({ prompt, signal, timeoutMs }) → RunnerResult`,
  a drop-in `runner` for `runAgent`. Drives the #009-proven one-shot
  (`docker compose -f client/opencode/docker-compose.yml run --rm -T --name oc-run-<id> opencode opencode run "<prompt>"`,
  `WORKSPACE` = per-run dir). Mirrors `runClaw`'s combined-signal + timeout-resolves
  pattern. The timeout hard-kill **force-removes the run container** (`docker rm -f`),
  not just the attached CLI — the only thing that terminates the two #009 silent
  hangs (which emit no exit code). Writes a per-run sidecar
  (`run_summary.json` + empty `iterations.jsonl`) so the registry reporter / `run_row.js`
  can write a row; the OpenCode exit code is telemetry only. No transcript adapter (#021).
- **Unit tests (docker-free):** [`host/test/__tests__/lib/opencode.contract.test.js`](../host/test/__tests__/lib/opencode.contract.test.js)
  — RunnerResult shape, populated runDir, timeout RESOLVES (not rejects), combined-signal
  (caller signal + internal timer, either-first), argv construction. Driven by an `exec`
  test seam (fake `sleep` / `sh -c 'exit N'`); no daemon needed.
  Run: `docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" node:22-bookworm-slim sh -c 'node --test "__tests__/lib/"*.test.js'`
- **Integration smoke:** [`host/test/scripts/opencode-smoke.mjs`](../host/test/scripts/opencode-smoke.mjs)
  — LIVE one-shot against :11436 (real `/workspace` mutation + row-writable runDir, proven
  by the reporter's own `writeAssertionResult`) AND a DEAD-port run (#009 Finding 2) proving
  the timeout path RESOLVES `'timeout'` rather than hanging/rejecting. Needs a daemon +
  opencode:local + :11436; run Docker-out-of-Docker with the repo path-matched:
  `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:$PWD" -w "$PWD/host/test" docker:cli sh -c 'apk add --no-cache nodejs >/dev/null && node scripts/opencode-smoke.mjs'`

Wiring `runOpenCode` as the default runner via a `CONFIG` selector — and resolving how the
harness shares its `/workspace` with the OpenCode sibling container — is **#011**.
