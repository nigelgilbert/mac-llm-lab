# oc client hardening: workspace-root guard, remote-config pairing check, probe poll, Node pin

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), serving/client findings 10–13. All in
`client/opencode/`; the first is the one real hole in the workspace
contract (memory: container-first is architectural — the sandbox is only
as strong as the mount).

## What to build

1. **Workspace-root guard (the important one).** `oc` mounts `$PWD` rw
   into the agent container with no guard: a habitual `oc` typed in
   `$HOME` hands a weak-tier model rw access to SSH keys, wizard state,
   everything. Refuse to start when the resolved workspace is `$HOME`,
   `/`, or a filesystem root, with a message naming the path and an
   explicit override env knob (`OC_ALLOW_BROAD_WORKSPACE=1` or similar)
   for the rare deliberate case. `note_workspace`'s non-git warning
   stays as-is for everything else.

2. **Remote-server config pairing.** With `OC_SERVER_HOST=<lan-ip>` but
   the config still pointing at `host.docker.internal`, the health check
   greens against the remote while the container dials the local Mac.
   When `SERVER_HOST` is not local, check the resolved config for
   `host.docker.internal` and fail loudly (the pairing requirement
   currently lives only in the header comment).

3. **Probe mock race.** The injection probe backgrounds the mock server
   and `sleep 1`s before driving OpenCode; a slow node startup yields a
   false FAIL. Poll the mock's port with a bounded curl loop instead.

4. **Node pin in the image.** The Dockerfile runs Nodesource's
   `setup_lts.x` unpinned at build time — a moving target that undercuts
   the `OPENCODE_VERSION` reproducibility rationale stated in the same
   file. Pin the Node major (or derive from a pinned `node:*-slim` base
   as `host/test/Dockerfile` does).

## Acceptance criteria

- [x] `oc` invoked from `$HOME` and from `/` refuses with the guard message; with the override knob set it proceeds
- [x] `oc` from a normal project dir is behaviorally unchanged (including the existing non-git warning)
- [x] `OC_SERVER_HOST=<non-local>` with the stock config fails fast naming the host.docker.internal mismatch
- [x] Probe passes under an artificial mock-startup delay (e.g. 3s) that fails on the old fixed sleep
- [x] Rebuilt image reports the pinned Node major; `oc probe` and a one-shot `oc run` green against the resident tier
- [x] wizard step 61 smoke still green

## Blocked by

None - can start immediately
