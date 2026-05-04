# Usability case U1 — `grep_search` walks `.claw-runtime/` and self-poisons context

**Filed:** 2026-05-03 (sprint 1.21, difficulty-pack work)
**Status:** open — early-arriving finding, awaiting Sprint 3+ usability-pack opening
**Origin:** `feature/harder-test-suite-1`, needle-haystack v4 cycle 12 (t64 N=1 dispatch)

## Symptom

A single agent tool call to `grep_search { pattern: "export const REGION_LOOKUP_TABLE\\s*=", output_mode: "content" }` returned a **108,732-byte content payload** on the very first reasoning step of a needle-haystack v4 run at tier-64. The next round-trip to the model carried a 76,250-token request against a 65,536-token context window and the inference server returned `400 Bad Request: request exceeds available context size`. claw exited with status 1 after ~7 seconds; `solve.js` was never written.

This is **not** a difficulty signal. The same v4 spec at tier-16 (cycle 11) used a different tool (`bash grep -r ... /workspace/lib /workspace/data /workspace/config`) — explicitly scoped to the three workspace subdirs — and produced a legitimate ctx-overflow only after 14 iterations of real reasoning + multiple file reads.

## Root cause

The test workspace is mounted at `/workspace`. Inside that mount, the host-side test framework writes per-run telemetry to `/workspace/.claw-runtime/<run_id>/` — which on the host resolves to `host/test/.claw-runtime/`. That directory accumulates **session JSONL transcripts** across every sweep cycle ever run (c1 through c12 at the time of this incident, 30+ run dirs).

Each session JSONL contains:
- The full test prompt for that run (which mentions `REGION_LOOKUP_TABLE` repeatedly by design)
- Every tool call argument and result for that run
- Cumulative assistant messages

`grep_search` (as exposed to claw at tier-64) recursively walks the workspace root with no default ignore list. It therefore matches **inside the accumulated session logs** as well as inside the test fixture files. With v4 having 4 needle-class files × 30+ historical run dirs × hundreds of `REGION_LOOKUP_TABLE` mentions per session log, a single grep call returned ~108 KB of content — most of which was log-of-log noise, not workspace state.

Tier-16's smaller model (qwen35-9b-iq4xs) happened to choose `bash grep -r ... <explicit subdirs>` instead, which sidestepped the leak. So the symptom is **tool-selection-conditioned** and surfaces only when the model picks the unscoped retrieval tool.

## Why this lands in the usability bucket

This is not a model-capability question. It's an **agent-ergonomics** question: does the model's tooling default to safe scopes, and does the test environment present a clean workspace to those tools?

A productivity-aware suite should probe at least:
- **Tool-default scoping:** does `grep_search` honor `.gitignore` / `.rgignore` / a built-in deny-list, or does it walk every directory?
- **Workspace hygiene:** does the test scaffold present *only* the test fixtures to the agent, or does it leak harness-internal directories?
- **Model tool selection:** when both scoped (`bash grep`) and unscoped (`grep_search`) options are available, which does the model reach for, and does that choice correlate with success?

These are exactly the questions a usability pack is meant to discriminate on, and they're orthogonal to the difficulty axes (multi_file_context, tool_discipline, etc.) that the difficulty pack measures.

## Mitigations (proposed, not actioned)

In rough order of preference:

1. **Hide `.claw-runtime/` from the workspace mount.** The test scaffold could write telemetry to a sibling path that isn't visible inside the container, or bind-mount it read-only at a path outside `/workspace`. This is the cleanest fix and removes the leak globally for all current and future tests. **Touches `lib/*` or `scripts/*` — out of scope for sprint 1.21 difficulty-pack work.**

2. **Scope claw's `grep_search` defaults.** Configure the tool (or its server-side wrapper) to honor a project-level `.rgignore` / `.gitignore` and add `.claw-runtime/` to that file at workspace setup time. This is a tooling-config change, not a per-test change.

3. **Per-test workspace `.gitignore` write.** Inside `beforeEach`, write a `.gitignore` (or `.rgignore`) at workspace root containing `.claw-runtime/`. Stays within difficulty-pack's allowed-edits scope (`__tests__/tier-eval/`), but only works if the agent's grep tool actually honors gitignore — uncertain without testing.

4. **Per-test sanitizer:** at workspace setup, recursively wipe `.claw-runtime/` of all but the current run's directory. Aggressive, brittle, and can race with the writer process. Not recommended.

## Cross-pack implications

- **Difficulty pack:** any test that places literal-string identifiers in fixture content and expects the agent to grep for them is at risk of the same leak — every prior run's session JSONL contains the prompt verbatim. needle-haystack is the most exposed (the chain identifiers appear in every session), but in principle book-store, two-bucket, and others could also be affected if the agent invokes `grep_search` for fixture-internal terms. So far we have evidence only for needle-haystack v4 at t64.
- **Calibration protocol:** R1–R9 cell flags should arguably gain an **R10 ("workspace-leak")** classifier so that a ctx-overflow caused by grep-into-runtime-logs is distinguishable from a ctx-overflow caused by genuine retrieval pressure. Without R10, the c12 t64 row in the registry currently looks like a legitimate ctx_discriminator hit, which it is not.

## Reproducer

```bash
# From the repo root, on feature/harder-test-suite-1 at the v4 needle-haystack state:
TIER_EVAL_FILTER="needle-haystack" EVAL_REPS=1 \
  host/test/scripts/explore-cycle.sh <cycle> 64
```

Then inspect the most recent run dir:

```bash
RUN=$(ls -t host/test/.claw-runtime/ | grep -E '^[a-f0-9]{8}-' | head -1)
sed -n '10p' host/test/.claw-runtime/$RUN/sessions/*/session-*.jsonl \
  | jq -r '.message.blocks[0].output' \
  | jq -r 'keys, .numFiles, (.content | length)'
```

`(.content | length)` will report > 100,000 bytes if the leak is present.

## Pointers

- Run that surfaced it: `c12-20260503-1722` — `host/test/.claw-runtime/702434a3-d576-4429-99d2-7fa68ec8b1d6/`
- Companion legitimate ctx-overflow (different tool path, same v4 spec): `c11-20260503-1712` — `host/test/.claw-runtime/e30a2323-e865-414d-b8e5-5be63b39bcd7/`
- Difficulty-pack v4 needle-haystack spec: `host/test/__tests__/tier-eval/needle-haystack.test.js`
- Bridge-diagnostics sibling stream (filed for ini-parser t32 sampler pathology, similar "looks-like-difficulty-but-isn't" pattern): see [`../../../../litellm/docs/TODO-1.21-bridge-error-diagnostics.md`](../../../../litellm/docs/TODO-1.21-bridge-error-diagnostics.md)
