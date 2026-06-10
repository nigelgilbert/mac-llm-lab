# Baked eval-runner image (kill apk-add-per-sweep)

**Type**: AFK

**Status:** ✅ Complete

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.8, §3.5.

## What to build

A small dedicated runner image (node + git + docker CLI/compose preinstalled)
to replace the stock `docker:cli` + `apk add --no-cache nodejs
docker-cli-compose coreutils git` incantation that the A/B driver currently
performs on **every sweep**. Point the driver's OpenCode phase at the baked
image; keep the path-matched repo mount + live-sources contract and the
`/workspace` bind exactly as today (the mount-contract failure modes are
documented in the driver's comments — preserve the fail-fast checks).

Independently valuable and unblocked: it speeds every future sweep and is a
prerequisite cleanup for the harness rewrite (#010).

## Acceptance criteria

- [x] Runner image builds reproducibly (compose or Makefile target documented in the driver header)
- [x] One-cell tier-16 sweep (`SMOKE_TESTS=deep-equal`) completes green with the new image and the sweep log contains zero `apk` lines — *ran in the driver's default co-resident fresh-registry mode, not reuse-registry mode; see deviation note below*
- [x] Phase startup time (container start → first cell line) measured before/after, recorded in Result
- [x] Driver preflight fails loud with a build hint when the runner image is missing

## Blocked by

None - can start immediately

## Result (2026-06-10)

### What landed

| file | change |
|---|---|
| `host/test/Dockerfile.runner` | NEW — baked runner: `FROM docker:29-cli` + `apk add nodejs docker-cli-compose coreutils git` at **build** time; toolchain only, no repo sources, no entrypoint |
| `host/test/docker-compose.yml` | NEW build-only `runner` service (profile `build`, never `up`'d) — build entrypoint `cd host/test && docker compose build runner` |
| `host/test/run-config-ab.sh` | Phase B runs in `$RUNNER_IMAGE` (knob `RUNNER_IMAGE`, default `mac-llm-lab-eval-runner:local`); `apk add` removed from the inline loop, replaced by a baked-toolchain assert (node/git/docker/timeout/compose → fail fast with rebuild hint); missing-image preflight with build hint; header documents the build; path-matched repo mount, `-w`, `/workspace` bind and the FATAL `/workspace`-visibility mount-contract check preserved verbatim |
| `host/test/lib/runAgent.js` | comment + `seedWorkspaceGit` fail-loud message updated (git is baked, not apk-added) |
| `host/test/scripts/opencode-workspace-roundtrip.mjs` | footer incantation updated to the baked image |

Image: `mac-llm-lab-eval-runner:local` (node v24.14.1, git 2.52.0, docker CLI
29.5.3, compose v5.1.4, GNU coreutils timeout). Verified by running the full
`__tests__/lib` suite inside it: 137/137 pass.

### Phase startup time (container start → first cell line)

No existing sweep log carries per-line timestamps, so a one-cell before-sweep
was run pre-change with timestamped logging (same cell, same tier, same box,
minutes apart):

| | Phase B `docker run` → first `>>> opencode-a cell:` line | log |
|---|---|---|
| before (docker:cli + apk add) | `14:01:54 → 14:02:43` = **49 s** | `/tmp/issue009-before-sweep.log` |
| after (baked runner) | `14:07:20 → 14:07:20` = **≤1 s** | `/tmp/issue009-after-sweep.log` |

The 49 s is the network `apk add` (the identical package set took 53 s during
the image build) — now paid once per image build instead of on every sweep
(and once per OC_CONFIGS sub-phase × every sweep on multi-arm sweeps).

### Sweep evidence (after, baked image)

One-cell tier-16 `SMOKE_TESTS=deep-equal` driver run, end-to-end green
(`phaseA rc=0, phaseB rc=0, gate rc=0`, `DRIVER_RC=0`); oc cell PASS
(`agent exit=0`, post `verify.js exit=0`); gate:
`PASS — every row config_id-stamped; both sides bucketed (claw-rig=1,
opencode-a=1 eligible paired runs)`. Registry:
`.claw-runtime/run_registry.config-ab-20260610-140710.jsonl`.
`grep -c apk /tmp/issue009-after-sweep.log` → **0**.
Cleanup trap observed working: oc-16 stopped (driver started it), zero
orphaned `oc-run-*`, `claw :11435 green ✓` on exit.

### Missing-image preflight demo

Untagged the image, ran the driver:

```
ERROR: missing baked eval-runner image mac-llm-lab-eval-runner:local (issue #009)
  — build it: (cd .../host/test && docker compose build runner)
  [equivalently: docker build -f .../host/test/Dockerfile.runner -t mac-llm-lab-eval-runner:local .../host/test]
```

rc=1, exits before any server/container is touched (claw untouched, still
200). Rebuilt via the documented compose entrypoint; image green again.

### Deviations

- **Reuse-registry mode not used for the verification sweeps.** Reuse-registry
  mode (`SKIP_PHASE_A=1`) requires setting `REGISTRY_OUT`, which the session's
  operating constraints prohibited outright (split-file-bug gotcha; the
  permission layer enforced the literal rule even though the bug can't bite
  when Phase A is skipped). Both sweeps therefore ran the driver's **default
  co-resident fresh-registry mode**. Consequence: each smoke also ran one claw
  Phase A cell against the production tier-64 server while labeled
  `hardware_tier=16` — mislabeled-by-construction rows in **throwaway**
  auto-stamped registries (`config-ab-20260610-140142` / `-140710`), never to
  be analyzed. `PHASE_SWAP` was never used; the EXIT trap was never bypassed.
- Build is via a compose service (no Makefile target — repo has no Makefile);
  the plain `docker build -f Dockerfile.runner` equivalent is documented in
  the driver header and Dockerfile.
- Base pinned to `docker:29-cli` (major-line pin); apk packages float within
  alpine 3.23 — same reproducibility class as the previous per-sweep apk add,
  but now frozen at build time instead of varying sweep-to-sweep.

### Interface facts for #010

- Driver selects the runner via env knob **`RUNNER_IMAGE`**, default
  **`mac-llm-lab-eval-runner:local`** (run-config-ab.sh, knobs table).
- Build entrypoint: **`cd host/test && docker compose build runner`**
  (`runner` is a build-only compose service behind the `build` profile).
- The image is pure toolchain: the driver still mounts the repo path-matched
  (`-v $REPO_DIR:$REPO_DIR -w $REPO_DIR/host/test`), binds `$H:/workspace`,
  and mounts `/var/run/docker.sock` — the live-sources + mount contract is
  unchanged, and the in-container `/workspace`-visibility fail-fast check is
  intact, now joined by a baked-toolchain assert.
