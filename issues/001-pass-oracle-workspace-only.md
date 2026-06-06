# Config-agnostic pass oracle (workspace-only)

**Type**: AFK

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §0b

## What to build

Redefine "pass" for tier-eval Family A/B tests to be **`/workspace` post-script
verification only** (`post.status === 0`), so the oracle means the same thing under
any harness. Today the pass also requires `agent.code === 0` ("agent must exit
cleanly") — a claw-ism that would false-fail an OpenCode run which correctly fixed
the workspace but returned a noisy exit code.

Demote the agent exit code from a pass gate to **recorded telemetry** plus a
"crashed before finishing" diagnostic. Centralize the pass decision so it isn't
re-asserted per test body. Because this redefines pass, the claw baseline must be
re-measured fresh under the new oracle — never compared against historical rows that
used the old `agent.code===0 && post.status===0` definition. Verify the claw suite is
still green afterward (the flip should be a practical no-op for claw, which exits 0
on success).

## Acceptance criteria

- [ ] Pass is decided solely by the `/workspace` post-script (`post.status === 0`); `agent.code` no longer gates pass on either config
- [ ] Agent exit code is captured as telemetry and surfaces a "crashed before finishing" diagnostic when non-zero
- [ ] Pass decision is centralized (not re-asserted in each of the 35 test bodies)
- [ ] Any pure-`agent.code` test (no post-script) is identified and either given a workspace oracle or explicitly marked not-yet-A/B-eligible
- [ ] Full claw tier-eval suite runs green under the new oracle; any baseline change is explained

## Blocked by

None - can start immediately
