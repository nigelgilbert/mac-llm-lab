# OpenCode session-log inspection + format doc

**Type**: HITL

**Status:** 🟢 Ready — blocker #009 met

## Parent

[OPENCODE-HARNESS-AB-PLAN.md](../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md) §4.4, §5

## What to build

Inspect and document where OpenCode writes its session log and what JSON shape it
uses, from real runs (#009). This is the prerequisite that unblocks the transcript
adapter (#021): we need the on-disk location, per-iteration structure, token-usage
fields, and tool-call records before normalizing into the existing iteration schema.

HITL because it's an empirical investigation of an undocumented (to us) format.

## Acceptance criteria

- [ ] Session-log location (dir + file naming) documented
- [ ] Per-iteration JSON shape documented: message/turn boundaries, token usage, tool-call records
- [ ] Mapping notes from OpenCode fields → existing iteration schema fields (gaps called out)
- [ ] OpenCode's tool set enumerated for the tool→workspace-mutation map (#021)

## Blocked by

- #009
