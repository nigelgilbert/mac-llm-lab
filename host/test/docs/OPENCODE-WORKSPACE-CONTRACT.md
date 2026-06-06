# Cross-container `/workspace` sharing contract (issue #011)

**Status:** defined + proven by a live cross-container round-trip
([scripts/opencode-workspace-roundtrip.mjs](../scripts/opencode-workspace-roundtrip.mjs)).
This is the mount contract the phase-swap driver (#013) MUST satisfy when it runs
the suite under `CONFIG=opencode-a`.

## The problem

Under claw (Config A) the agent runs **in-process** inside the test container, so
it writes directly to that container's `/workspace` — the same path the harness
seeds and the post-script oracle reads. There is one filesystem; nothing to share.

Under OpenCode (Config B) the agent runs in a **sibling container**
(`docker compose run --rm … opencode opencode run …`, see
[lib/opencode.js](../lib/opencode.js)). That sibling bind-mounts a **host** directory
at its `/workspace` (the compose's `${WORKSPACE}:/workspace`). Meanwhile the harness
still does `workspace.reset()` / seed / post-script against the **container path**
`workspace.WORKSPACE = '/workspace'` *inside the test container*
([lib/workspace.js](../lib/workspace.js) — the constant is hard-coded).

So there are now **two** `/workspace` paths — one inside the test container, one
inside the sibling — and unless they are backed by the **same host directory** the
oracle and the agent are looking at different filesystems: the post-script would
never see what the agent wrote, and every opencode cell would false-fail.

## The contract

Let **H** be a single host directory (the per-phase shared workspace).

1. **Test container's `/workspace` is H.** The driver launches the test container
   with `-v H:/workspace`. The harness's reset/seed/post-script keep using the
   container path `/workspace` unchanged — they are now operating on H.

2. **The selector hands H to the sibling.** With `CONFIG=opencode-a`,
   `runAgent`'s `defaultRunner` (via `selectRunner`, [lib/runAgent.js](../lib/runAgent.js))
   reads **`HOST_WORKSPACE`** and passes it as `runOpenCode({ workspaceDir })`.
   `runOpenCode` spawns the sibling with `WORKSPACE=H`, so the sibling bind-mounts
   **the same host dir H** at its `/workspace`. `HOST_WORKSPACE` must therefore be
   the **host** path of H (the path the host docker daemon understands), **not** the
   in-container `/workspace`.

3. **The test container can reach the host docker daemon, path-matched.** The
   sibling's bind mounts (`${WORKSPACE}`, `./opencode.json`, the compose file) are
   resolved by the **host** daemon, which only knows host paths. So the test
   container must:
   - mount the host docker socket (`-v /var/run/docker.sock:/var/run/docker.sock`), and
   - have the repo **path-matched** (`-v "$REPO:$REPO" -w "$REPO/host/test"`) so
     `lib/opencode.js`'s `REPO_ROOT` (and thus the compose-file path + the
     `./opencode.json` relative mount) are valid host paths. This is the OrbStack
     `-v "$PWD:$PWD"` trick from [scripts/opencode-smoke.mjs](../scripts/opencode-smoke.mjs).

If `CONFIG=opencode-a` but `HOST_WORKSPACE` is unset, `selectRunner` **throws**
rather than silently mounting the sibling's default workspace (a different dir) and
false-failing every cell.

### What #013 must do (per phase, opencode-a)

```sh
REPO="$(pwd)"                                  # repo root, path-matched
H="$REPO/client/opencode/.opencode-runtime/phase-ws"   # gitignored, host-shareable
rm -rf "$H" && mkdir -p "$H"

docker run --rm \
  -v "$REPO:$REPO" -w "$REPO/host/test" \     # path-matched repo (host paths valid)
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$H:/workspace" \                         # test container's /workspace == H
  -e CONFIG=opencode-a \
  -e HOST_WORKSPACE="$H" \                     # host path of H → sibling mounts it
  -e TIER=64 \                                 # picks the opencode-a model_config_id
  <node+docker-cli image> \
  npm test                                     # tests stay byte-identical
```

Notes / invariants:
- **H lives under a gitignored, host-shareable path** (here under
  `client/opencode/.opencode-runtime/`, sibling to the per-run sidecar root). A
  repo-relative dir is guaranteed visible to the host daemon when the repo is
  path-matched; an arbitrary `mktemp -d` may not be, depending on OrbStack's
  shared-folder config.
- **Serial execution only.** `workspace.reset()` wipes H between cells; the suite
  already pins `--test-concurrency=1` + per-file process isolation (see
  [lib/runAgent.js](../lib/runAgent.js) concurrency note). Two overlapping cells
  would clobber the shared H.
- **The sibling's sidecar root is separate from H.** `runOpenCode` writes its
  run sidecar under `OPENCODE_RUNTIME_ROOT` (default
  `client/opencode/.opencode-runtime/`), a **sibling of** H — never under it — so
  `workspace.reset()` and the post-script never touch it.
- **Claw side is unchanged.** `CONFIG` unset → `claw-rig`; no `HOST_WORKSPACE`,
  no socket, no path-matching needed (the agent is in-process).

## Proof

[scripts/opencode-workspace-roundtrip.mjs](../scripts/opencode-workspace-roundtrip.mjs)
runs *inside* a path-matched test container with `/workspace` backed by host H and
`CONFIG=opencode-a`. It (1) seeds a uniquely-tokened `seed.txt` via the harness's
own `workspace` module, (2) drives the agent through the **real #011 selector**
(`selectRunner()` → `runOpenCode`) with a prompt to read `seed.txt` and write
`result.txt` echoing the token, then (3) reads `result.txt` back through the
`workspace` oracle. A pass proves **both** directions across the container boundary:
the seed crossed into the sibling (the agent could read it) and the agent's write
crossed back to the oracle — not asserted by inspection, but by a real round-trip.
