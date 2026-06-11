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

---

## Addendum 2026-06-11 — post-migration audit of OpenCode's search tools (T10/R2)

claw is retired (2026-06-10, tag `claw-stack-final`); the production stack is
OpenCode 1.16.2 + the resident llama-server. This addendum re-answers the two
§"Why usability" questions against that stack, with wire/artifact evidence.

### Exposure verdict: **structurally dead under the current driver path; tool-layer scoping gap is REAL and latent (changed-shape, dormant)**

**The accumulation channel is gone.** Post-migration, nothing writes harness
telemetry under the mounted `/workspace`:

- Registry rows → `host/test/.claw-runtime/` via `RUN_REGISTRY_PATH`, which
  `run-config-ab.sh` always sets (repo path through the path-matched mount,
  never under H).
- Per-run sidecars + raw OpenCode session DB →
  `client/opencode/.opencode-runtime/<runId>/` — a **sibling of** the shared
  workspace H (`phase-ws`), never inside it (mount contract,
  [OPENCODE-WORKSPACE-CONTRACT.md](../../OPENCODE-WORKSPACE-CONTRACT.md)).
- OpenCode's own state → `/root/.local/share/opencode` in the sibling
  container, bind-mounted to `<runDir>/opencode-data` — outside `/workspace`.
- The driver wipes H at sweep start (`find "$H" -mindepth 1 -exec rm -rf`).
- Verified live (2026-06-11 re-base sweeps): post-sweep H contained only the
  fixtures + `verify.js` + the agent's `solve.js`; OpenCode created **no**
  dot-dirs in the workspace. What the agent sees in `/workspace`: seeded
  fixtures (+ `.git/` and `AGENTS.md` on the `+git`/`+prompt` arms).

**Two dormant claw-era residues could re-create visibility** (neither fires
under the driver, both are live code):

1. `lib/registry.js` `DEFAULT_REGISTRY_DIR = '/workspace/.claw-runtime'` —
   the fallback when `RUN_REGISTRY_EMIT=1` with `RUN_REGISTRY_PATH` unset
   (e.g. a hand-rolled run) writes the registry INTO the workspace again.
2. `lib/workspace.js` `PRESERVE_BETWEEN_RUNS = {'.claw-runtime'}` —
   `workspace.reset()` still exempts that name, so anything by that name
   accumulates across cells within a sweep. (The probe below exploited
   exactly this to plant its decoys.)

### Tool audit (i): do OpenCode 1.16.2's search tools walk unscoped?

**Source-cited** (`sst/opencode` tag `v1.16.2`,
`packages/core/src/filesystem/ripgrep.ts` — the module
`packages/opencode/src/tool/{grep,glob}.ts` actually import; pinned ripgrep
15.1.0):

- `searchArgs` (grep tool): `--no-config --json --hidden --glob=!.git/*
  --no-messages [--glob=<include>] -- <pattern> .`
- `filesArgs` (glob tool): `--no-config --files --glob=!.git/* --hidden
  --glob=<pattern> .` (the tool never sets `hidden:false`, so `--hidden` is
  always added)

So: **hidden (dot-prefixed) files/dirs ARE walked** — only `.git/` is
excluded; there is no other deny-list. `--no-ignore` is NOT passed, so
ripgrep's ignore-file handling applies: `.ignore`/`.rgignore` are honored
**always**; `.gitignore` is honored **only inside a git repo** (rg default).
Deterministic replay with rg 15.1.0 and the literal tool argv against a
planted workspace (fixture file + `.claw-runtime/…/session-1.jsonl` decoys
carrying the fixture literal):

| case | workspace shape | decoy matched? |
|---|---|---|
| bare dir (`opencode-a` arm shape) | no `.git`, no ignore files | **YES — 300/300 decoy lines, 158 KB rg payload** |
| `.gitignore` plant, **no** git repo | `opencode-a` | **YES — gitignore ignored without git** |
| `.gitignore` + `git init` (`+git`/`+prompt` arm shape) | | no (0 decoy) |
| `.rgignore` plant, no git | any arm | no (0 decoy) |
| `.ignore` plant, no git | any arm | no (0 decoy) |
| glob tool `**/*.jsonl`, no ignore files | | **YES — lists the hidden decoy file** |

Replay artifacts: `client/opencode/.opencode-runtime/grep-probe-20260611/rg-replay-case1.json`.

### Tool audit (ii): can a fixture-literal query return harness-internal payloads? — wire-captured YES

One controlled cell (tier-64, resident :11436 under the lock, direct
containerized invocation — NOT the driver, which would have wiped the plant;
row in the separate probe registry
`host/test/.claw-runtime/run_registry.needle-grep-probe-20260611.jsonl`, run
`909a23b3-96a8-41a9-84a2-d65681b757ef`, `OPENCODE_KEEP_DATA=1`) with 300
decoy JSONL lines planted under `/workspace/.claw-runtime/`:

- The needle cell itself passed in 38.6 s. The model's `read /workspace`
  directory listing **exposed `.claw-runtime/` to the model** (tool-result
  part in the session DB: `<entries>\n.claw-runtime/\n…`). Its greps happened
  to be subdir-scoped (`path: /workspace/lib|data|config`) and its globs
  extension-scoped (`**/*.js`), so the decoy payload did not reach the model
  in that run — **tool-selection-conditioned, exactly as the claw-era memo
  observed**. (In the 5-run t64 re-base sweep, every run used the `grep`
  tool 3–6×.)
- A follow-up wire capture drove the real grep tool at the workspace root
  (`{pattern: REGION_LOOKUP_TABLE, path: /workspace}`). Captured tool-result
  part (session DB, preserved at
  `client/opencode/.opencode-runtime/grep-probe-20260611/{opencode.db,grep-tool-part.json}`):
  `"Found 305 matches (showing first 100)"`, `truncated: true`, output
  **46 080 chars, of which 95 of the 100 delivered match lines were decoy
  telemetry** (`DECOY_CANARY_R2_T10` ×95). The 5 real fixture hits survived
  only because rg happened to order those files first.

**Net failure-mode shape vs claw:** OpenCode's tool-layer truncation (100
matches, 2 000 chars/line — `packages/opencode/src/tool/grep.ts`) converts
the claw-era *fatal* one-shot 108 KB ctx-overflow into a *bounded* ~46 KB
(~11k tok) payload — context poisoning/dilution (95 % log-noise) rather than
guaranteed overflow. Harmful, not fatal; and only reachable if a harness dir
is visible under `/workspace`, which the current driver path prevents.

### Adapted mitigation ranking (oc stack)

1. **Keep telemetry out of `/workspace` (already the architecture — protect
   it).** Retire the two dormant residues: drop `'.claw-runtime'` from
   `PRESERVE_BETWEEN_RUNS` (nothing legitimately writes it anymore) and make
   `lib/registry.js` fail loud instead of defaulting to
   `/workspace/.claw-runtime` when `RUN_REGISTRY_PATH` is unset. Cleanest;
   closes the only re-entry path. *(Follow-up issue, not actioned here —
   suggested filename: `issues/041-retire-workspace-claw-runtime-residue.md`,
   title: "Retire dormant /workspace/.claw-runtime residue: PRESERVE list +
   registry default fallback".)*
2. **Seed-time `.rgignore` plant** (harness patterns, e.g. `.claw-runtime/`)
   — honored by OpenCode's grep AND glob in **all** arms (replay cases 4/5),
   including the git-less `opencode-a`. Cheap defense-in-depth at
   `runAgent` seed time.
3. **`.gitignore` plant** — works only on git-rooted arms (`+git`/`+prompt`);
   **does nothing under `opencode-a`** (replay case 2). The claw-memo's
   mitigation #3 is therefore NOT viable as a general fix on this stack.
4. **Per-test sanitizer** — still not recommended (racy, brittle), unchanged.

No live leak exists today, so no fix is filed as urgent; ranking is recorded
for when #021-class workspace changes or manual runs re-open the surface.
