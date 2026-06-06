# `runOpenCode` runner (outcome-only)

**Type**: AFK

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

- [ ] `runOpenCode` invokes the OpenCode container one-shot and returns a `RunnerResult` matching the `Runner` typedef
- [ ] Returns a real, populated `runDir`; on timeout it **resolves** with `terminal_status: 'timeout'` (never rejects)
- [ ] Combined-signal honors both caller `signal` and internal timeout
- [ ] Agent exit code captured (telemetry), not used as a pass gate
- [ ] Invoking it directly on a sample prompt yields a row-writable `runDir` with workspace mutation

## Blocked by

- #009
