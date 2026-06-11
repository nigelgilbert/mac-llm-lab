#!/usr/bin/env bash
# ============================================================================
# run-config-ab.sh — generic config-vs-config sweep driver for the tier-eval
# panel (issue #010; successor to the #013 claw-vs-opencode phase-swap driver).
#
# Runs the SAME test cells under N config arms and appends every arm's run-
# registry rows to ONE shared registry file, so lib/paired_bootstrap.js can
# pair them by task. Arms are OpenCode `CONFIG` ids (lib/config.js
# OPENCODE_CONFIGS — e.g. opencode-a, opencode-a+git, opencode-a+prompt;
# future arms: prompt variants, samplers, models, thinking on/off). The
# historical `claw-rig` config_id is readable in preserved registries but NOT
# runnable (claw stack retired in #008/#010; archived at tag claw-stack-final).
#
# ── Interface ───────────────────────────────────────────────────────────────
#   ARMS       space-separated runnable CONFIG ids to execute, in order
#              (default: "opencode-a"). Each arm runs every cell in
#              SMOKE_TESTS × CONFIG_AB_REPEATS and appends rows to the shared
#              registry.
#   BASELINE   the config_id the gate pairs each other arm against
#              (default: first word of ARMS). May be a config that is NOT in
#              ARMS — e.g. a historical claw-rig or a previously-swept arm —
#              when REUSE_ROWS=1 supplies its rows from an existing registry.
#
# After the sweep, the gate (scripts/config-ab-pairing-check.mjs) runs once
# per non-baseline arm with explicit `--treatment <arm> --baseline $BASELINE`,
# asserting every row is config_id-stamped and both sides bucketed. Verdicts
# are NOT rendered here — run scripts/config-ab-verdict.mjs with the same
# --treatment/--baseline flags against the registry afterwards.
#
# config_id is NOT set per-arm by hand. The single CONFIG env swapped between
# sub-phases drives BOTH the runner selection (lib/runAgent.js selectRunner)
# AND the row's config_id (lib/registry_emit.js → resolveConfigId), so a row's
# bundle label can never disagree with the runner that produced it. Rows are
# emitted INLINE (RUN_REGISTRY_EMIT=1) — never via the offline harvester.
#
# ── Server topology ─────────────────────────────────────────────────────────
# One OpenCode-dedicated llama-server per TIER (host/llama-server/scripts/
# opencode-server): tier 64 → :11436 (the RESIDENT launchd daemon — normally
# already green; this driver uses it as found and NEVER stops it), tier 16 →
# :11437 and tier 32 → :11438 (on-demand: started here iff not already green,
# and stopped on exit ONLY if THIS script started it — leave the lab as found).
#
# ── Runner image (issue #009) ───────────────────────────────────────────────
# Every arm runs in the BAKED eval-runner image (node + git + docker CLI +
# compose preinstalled). Build it once (rebuild only when Dockerfile.runner
# changes):
#
#   cd host/test && docker compose build runner
#   # equivalently: docker build -f host/test/Dockerfile.runner \
#   #                 -t mac-llm-lab-eval-runner:local host/test
#
# Preflight fails loud with that hint if the image is missing. The image bakes
# TOOLCHAIN ONLY — no repo sources: the live-sources contract (path-matched
# repo mount, -w into host/test) and the /workspace bind are unchanged
# (mount contract: host/test/docs/OPENCODE-WORKSPACE-CONTRACT.md).
#
# ── Reuse-existing-rows mode (REUSE_ROWS=1) ─────────────────────────────────
# Append THIS sweep's arms to an EXISTING registry (REGISTRY_OUT required,
# non-empty, under host/test/.claw-runtime/) instead of starting a fresh one —
# e.g. add a new arm against an already-swept baseline without re-burning it.
# In fresh mode (default) REGISTRY_OUT must not already exist, so rows from
# different sweeps can't mix silently. (The historical "REGISTRY_OUT split-file
# bug" died with the claw phase: every arm AND the gate now address the same
# absolute host path through the path-matched repo mount.)
#
# ── Row accountability (#003) ───────────────────────────────────────────────
# Before the arms phase the driver writes an expected-attempts plan
# (TASKS × REPEATS × ARMS via scripts/expected-attempts.mjs plan) and snapshots
# the registry's line count as a watermark. After the gate it diffs the rows
# appended past the watermark against the plan: any planned (task, config, rep)
# cell with no row — reporter SIGTERM window, missing runDir, sidecar hiccup,
# per-cell timeout kill — is named and turns the sweep red. Under REUSE_ROWS=1
# the watermark confines the audit to THIS sweep's fresh rows.
#
# Exit code (#003): nonzero if ANY phase failed; precedence when several did:
#   1 = arm sub-phase failure (a cell rc'd nonzero or a sub-phase wedged)
#   2 = registry accountability failure: row shortfall (expected-attempts diff
#       found missing/over-emitted cells) OR a #002 overflow relabel that
#       could not be applied (the gate would read a mis-typed eligible row)
#   3 = pairing-gate failure
# (Preflight/setup errors exit 1 via err() before any phase runs.)
#
# ── Per-cell timeout reap (#004) ────────────────────────────────────────────
# Every oc-run-* sibling this sweep spawns carries the docker label
# `mac-llm-lab.sweep=$OC_SWEEP_ID` (compose service label interpolated from the
# env the driver forwards into the eval-runner). When the per-cell `timeout`
# cap kills a cell, the killed node chain never reaps its sibling — the driver
# loop reaps every container with THIS sweep's label immediately, and the
# end-of-sweep trap uses the same filter, so containers from other sweeps or
# manual runs (no/other label) are never touched.
#
# ── Workspace mount flake mitigation (#019) ─────────────────────────────────
# Under co-resident load OrbStack's file-share can serve a STALE handle for
# the /workspace bind: `[ -d /workspace ]` passes, but the first real write
# dies with an instant `ENOENT ... '/workspace/<seed-file>'` inside runAgent's
# workspace reset/seed (observed on ~30-50% of sweeps during the PR #6
# campaign; same share-degradation family as the virtiofs log freeze — the
# log side is mitigated by the #007 capture ladder, this is the remaining
# manifestation). Two layers, both inside the eval-runner's `sh -c`:
#   1. Write-probe canary (runner preflight): touch + read-back + rm of a
#      sentinel THROUGH the mount, 3 tries with a 2s settle between them. A
#      dead mount fails the ARM fast with the canary's message — never deep
#      inside a cell.
#   2. Signature-gated cell retry (cell loop): a cell that dies with the
#      flake signature — nonzero rc that is NOT the per-cell cap (124/137),
#      within 20s of cell start (seed ENOENT is instant; the slimmest real
#      cell runs an agent loop for minutes), node output carrying an
#      `ENOENT ... /workspace` line, AND no fresh registry row — is re-run
#      ONCE behind a loud `>>> cell <stem> RETRY (workspace mount flake)`
#      marker. Genuine failures (assertions, timeouts, anything without the
#      FULL signature) are NEVER retried; a flake-shaped failure that DID
#      emit a row is not retried either (a second attempt would over-emit
#      the cell and fail the #003 audit — the row-count gate closes the
#      duplicate-emission window, so a successful retry yields exactly one
#      row and the expected-attempts audit stays exact). The retried-cell
#      count is surfaced on the arm summary line (`retried_cells=N`).
# TEST-ONLY fault injection (deterministic exercise of both branches):
#   OC_WS_FAULT_RO=1            bind /workspace read-only → the canary must
#                               fail the arm in preflight (no cell starts)
#   OC_FLAKE_INJECT=<stem>      replace the FIRST attempt of <stem> (once per
#                               arm) with a flake-shaped failure (instant
#                               real node ENOENT under /workspace) → the
#                               retry must fire and the retry must succeed
#   OC_FLAKE_INJECT_GENUINE=<stem>  replace every attempt of <stem> with a
#                               fast NON-signature failure → must NOT retry
#
# ── Knobs (env) ─────────────────────────────────────────────────────────────
#   SMOKE_TESTS        space-separated tier-eval test_id stems   (default: deep-equal)
#   CONFIG_AB_REPEATS  runs per cell per arm (→ N per bucket)    (default: 1)
#   TIER               hardware tier: 64 | 16 | 32               (default: 64)
#   ARMS               runnable CONFIG ids to sweep              (default: opencode-a)
#   BASELINE           gate baseline config_id                   (default: first ARMS entry)
#   PER_TEST_TIMEOUT   per-cell wallclock ceiling, seconds       (default: 600)
#   REUSE_ROWS         1 = append to existing REGISTRY_OUT       (default: 0)
#   REGISTRY_OUT       explicit shared-registry path             (default: auto-timestamped)
#   RUNNER_IMAGE       baked eval-runner image (#009)            (default: mac-llm-lab-eval-runner:local)
#   OC_WS_FAULT_RO / OC_FLAKE_INJECT / OC_FLAKE_INJECT_GENUINE
#              #019 TEST-ONLY fault injection — see the workspace-mount-flake
#              section above; never set on a real sweep
#   OC_ROTATE_HOLDING_LOCK  1 = the invoker already holds /tmp/oc-resident.lock.d
#              (canonical sweep protocol) — lets the #015 rotation preflight's
#              G3 lock guard pass; without it a held lock makes the preflight
#              refuse (rc=2), which the driver tolerates as a skip. Other
#              OC_ROTATE_* knobs (cap/tail/index window) pass through too.
#   PRINT_TIER_RESOLUTION  1 = print the resolved tier identity (port/config/
#              log tag from host/llama-server/tiers.conf, #016) and exit 0
#              before any preflight — used by scripts/check-tier-table.sh.
#   OPENCODE_SERVER_TIMINGS  1 = #007 server-timings plumbing: forward the flag
#              into the eval-runner, bind-mount the tier's llama-server log
#              READ-ONLY at /var/log/opencode-llama-server.log and point
#              OPENCODE_LLAMA_LOG at it. ALSO arms the host-slice repair pass:
#              a host-side ticker indexes the log's size every ~3s during each
#              arm; post-arm EVERY fresh runDir gets its run window sliced
#              FROM THE HOST log (host processes always see truth) into
#              <runDir>/server-log.slice (#002 carry-forward: unconditional,
#              so the overflow scan has an artifact for every run). RunDirs
#              that closed with the virtiofs-freeze signature
#              (server_timings_join_status 'no_server_timings') are re-joined
#              via scripts/repair-server-timings.mjs. ALSO arms the #002
#              context-overflow pass: every slice is scanned for the pinned
#              llama-server n_ctx-exceeded line and a hit re-types the run
#              harness_error/passed=null in BOTH run_summary AND the
#              already-emitted registry row (scripts/
#              patch-context-overflow.mjs; idempotent; runs strictly BEFORE
#              the row audit + pairing gate read the registry). Unset/0
#              (default): no mount, no env, no ticker, no slice files, no
#              overflow typing — exactly the flag-off behavior. NOTE
#              (protocol): #002 overflow re-typing therefore only applies on
#              flag-on sweeps — flag-off sweeps count a mid-run overflow as
#              an eligible model failure (docs/OPENCODE-SERVER-TIMINGS.md).
#
# Examples:
#   # one-cell smoke of the default arm on the resident tier-64 daemon:
#   host/test/run-config-ab.sh
#
#   # sidecar-port pair at tier 16 (driver starts :11437, stops it after):
#   TIER=16 ARMS="opencode-a+git opencode-a+prompt" BASELINE=opencode-a+git \
#     SMOKE_TESTS="deep-equal" host/test/run-config-ab.sh
#
#   # tier-32 cells (#011): on-demand :11438, arm vs itself = row-discipline smoke
#   TIER=32 ARMS="opencode-a" SMOKE_TESTS="deep-equal wordy" \
#     host/test/run-config-ab.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---- #016 single tier table -------------------------------------------------
# Tier identity (port / opencode config json / log tag) is resolved from THE
# tier table host/llama-server/tiers.conf — the same file opencode-server, oc
# and the wizard resolve, so the driver can never disagree with the launcher
# it health-checks or the config it mounts. No private case map here.
TIERS_CONF="$REPO_DIR/host/llama-server/tiers.conf"
[ -f "$TIERS_CONF" ] || { printf 'ERROR: tier table missing: %s\n' "$TIERS_CONF" >&2; exit 1; }
# shellcheck source=../llama-server/tiers.conf
. "$TIERS_CONF"

# ---- config / knobs --------------------------------------------------------
SMOKE_TESTS="${SMOKE_TESTS:-deep-equal}"
REPEATS="${CONFIG_AB_REPEATS:-1}"
TIER="${TIER:-$TIER_DEFAULT}"
PER_TEST_TIMEOUT="${PER_TEST_TIMEOUT:-600}"
ARMS="${ARMS:-opencode-a}"
BASELINE="${BASELINE:-${ARMS%% *}}"
REUSE_ROWS="${REUSE_ROWS:-0}"

# Baked arm runner (#009): node + git + docker CLI + compose preinstalled
# (Dockerfile.runner). Also hosts the gate (it just needs node + the repo mount).
RUNNER_IMAGE="${RUNNER_IMAGE:-mac-llm-lab-eval-runner:local}"
OC_COMPOSE="$REPO_DIR/client/opencode/docker-compose.yml"
OC_SERVER="$REPO_DIR/host/llama-server/scripts/opencode-server"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

# Tier → OpenCode server port + client config (#019 wiring, #002 tier-32 port;
# #016: resolved from tiers.conf via tier_resolve — never a private map). The
# OpenCode container's serving endpoint lives in its mounted opencode(.NN).json,
# NOT in OC_PORT — OC_PORT only health-checks the server. Each arm MUST get the
# matching config or OpenCode dials the wrong port and every cell
# ConnectionRefused-loops to timeout (iters=1, 0 tokens). Consumed by
# client/opencode/docker-compose.yml's ${OPENCODE_CONFIG_JSON} mount.
# OC_LOG_TAG is opencode-server's per-tier TAG ("" | -16 | -32) FROM THE SAME
# TABLE: it names the host llama-server log ${OPENCODE_LOG_BASE}${TAG}.log for
# the #007 server-timings mount below — same source, never guessed.
tier_resolve "$TIER" || err "TIER=$TIER is not a known tier (known: $TIERS_ALL — see $TIERS_CONF)"
OC_PORT="$TIER_PORT"
OC_CONFIG_JSON="./$TIER_OPENCODE_CONFIG"
OC_LOG_TAG="$TIER_LOG_TAG"
OC_HEALTH="http://127.0.0.1:$OC_PORT/health"

# #016 check-tier-table.sh hook: print this driver's resolved tier identity
# and exit BEFORE any preflight / docker / server / registry interaction, so
# the cross-consumer assertion script can compare the driver's live resolution
# without running a sweep.
if [ "${PRINT_TIER_RESOLUTION:-0}" = 1 ]; then
  printf 'TIER=%s OC_PORT=%s OC_CONFIG_JSON=%s OC_LOG_TAG=%s\n' \
    "$TIER" "$OC_PORT" "$OC_CONFIG_JSON" "$OC_LOG_TAG"
  exit 0
fi

# Shared registry every arm appends to (path-matched → same host file in every
# sibling). Lives under the gitignored runtime root by convention.
STAMP="$(date +%Y%m%d-%H%M%S)"
# Sweep identity (#004): forwarded into the eval-runner env; runOpenCode's
# `docker compose run` inherits it and the compose service's
# `mac-llm-lab.sweep=${OC_SWEEP_ID:-}` label stamps it onto every oc-run-*
# sibling THIS sweep spawns. The per-cell timeout reap and the cleanup trap
# filter on this exact label value — never on the bare oc-run- name prefix.
OC_SWEEP_ID="config-ab-${STAMP}-$$"
CLAW_RT_DIR="$REPO_DIR/host/test/.claw-runtime"
HOST_REG="${REGISTRY_OUT:-$CLAW_RT_DIR/run_registry.config-ab-${STAMP}.jsonl}"
# Containment (#020): the prefix match alone accepts "$CLAW_RT_DIR/../escape" —
# reject any '..' path segment FIRST so the must-live-under-the-gitignored-
# runtime-root invariant (which the REUSE_ROWS protections rest on) actually
# holds. ('..' as a full segment only: a literal filename like "run..jsonl"
# stays legal.)
case "/$HOST_REG/" in
  */../*) err "REGISTRY_OUT must not contain '..' path segments (containment under $CLAW_RT_DIR is prefix-checked; '..' would escape it); got: $HOST_REG" ;;
esac
case "$HOST_REG" in
  "$CLAW_RT_DIR"/*) : ;;
  *) err "REGISTRY_OUT must be a path under $CLAW_RT_DIR (gitignored runtime root; visible through the path-matched repo mount); got: $HOST_REG" ;;
esac
# #020 residual: the textual checks above still accept a SYMLINK under the
# runtime root that points OUTSIDE it (e.g. .claw-runtime/escape -> /tmp/x).
# Physically resolve the runtime root and the registry path's PARENT directory
# (the file itself may not exist yet — fresh mode requires exactly that) and
# prefix-check the RESOLVED paths. macOS bash 3.2: no realpath/readlink -f —
# `cd -P ... && pwd -P` in the $() subshell is the portable physical resolve.
# A not-yet-existing parent is mkdir'd first: the emit path (lib/registry.js)
# creates the registry's parent recursively anyway, so creating it here matches
# the driver's existing flow — and the '..' + textual prefix checks above
# already passed, so the mkdir target is textually under the runtime root.
[ ! -L "$HOST_REG" ] || err "REGISTRY_OUT must not be a symlink (a link under $CLAW_RT_DIR could smuggle registry rows outside the gitignored runtime root); got: $HOST_REG"
HOST_REG_PARENT="$(dirname "$HOST_REG")"
mkdir -p "$HOST_REG_PARENT" || err "cannot create REGISTRY_OUT parent directory: $HOST_REG_PARENT"
CLAW_RT_PHYS="$(cd -P "$CLAW_RT_DIR" 2>/dev/null && pwd -P)" \
  || err "cannot physically resolve runtime root $CLAW_RT_DIR (containment check needs it)"
HOST_REG_PARENT_PHYS="$(cd -P "$HOST_REG_PARENT" 2>/dev/null && pwd -P)" \
  || err "cannot physically resolve REGISTRY_OUT parent directory $HOST_REG_PARENT (containment check needs it)"
case "$HOST_REG_PARENT_PHYS" in
  "$CLAW_RT_PHYS" | "$CLAW_RT_PHYS"/*) : ;;
  *) err "REGISTRY_OUT must PHYSICALLY resolve under $CLAW_RT_DIR (a symlink under the runtime root must not escape it; the REUSE_ROWS protections rest on this containment); got: $HOST_REG (parent resolves to $HOST_REG_PARENT_PHYS)" ;;
esac
if [ "$REUSE_ROWS" = 1 ]; then
  # Reuse mode: BASELINE (and pairing) may come from rows already in the file.
  [ -s "$HOST_REG" ] || err "REUSE_ROWS=1 appends to existing rows — set REGISTRY_OUT to an existing non-empty registry under $CLAW_RT_DIR; got empty/missing: $HOST_REG"
else
  [ ! -s "$HOST_REG" ] || err "REGISTRY_OUT already exists ($HOST_REG) — set REUSE_ROWS=1 to append to it, or pick a fresh path (rows from different sweeps must not mix silently)"
fi

# Per-arm shared workspace H for the opencode sibling (mount contract §"What
# the driver must do"). Gitignored, host-shareable, sibling of the oc sidecar root.
H="$REPO_DIR/client/opencode/.opencode-runtime/phase-ws"
GIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Build the per-arm cell filter: each test stem repeated REPEATS times so a
# single sub-phase invocation emits N rows per cell.
build_filter() {
  local out="" stem r
  for stem in $SMOKE_TESTS; do
    for r in $(seq 1 "$REPEATS"); do out="$out $stem"; done
  done
  printf '%s' "${out# }"
}
FILTER="$(build_filter)"

# ---- preflight -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || err "missing: docker"
command -v curl   >/dev/null 2>&1 || err "missing: curl"
[ -f "$OC_COMPOSE" ] || err "missing opencode compose: $OC_COMPOSE"
[ -x "$OC_SERVER" ]  || err "missing/non-exec opencode-server: $OC_SERVER"
# Fail loud BEFORE any server/container is touched if the baked runner image is
# absent (fresh clone, pruned image cache): no arm can run without it.
docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1 \
  || err "missing baked eval-runner image $RUNNER_IMAGE (issue #009) — build it: (cd $SCRIPT_DIR && docker compose build runner)  [equivalently: docker build -f $SCRIPT_DIR/Dockerfile.runner -t $RUNNER_IMAGE $SCRIPT_DIR]"

# Validate ARMS/BASELINE against the SINGLE source of truth (lib/config.js)
# instead of duplicating the enum in bash: every arm must be RUNNABLE
# (OPENCODE_CONFIGS); the baseline must be a VALID config_id (it may be a
# historical, non-runnable one — e.g. claw-rig rows in a reused registry).
#
# Arm×tier coverage (#006): membership alone is NOT enough — the emit path
# auto-picks modelConfigIdFor({configId, tier}) per row (the driver unsets
# RUN_REGISTRY_MODEL_CONFIG_ID by design), and an unmapped (arm, tier) pair
# (e.g. opencode-a+prompt × 64) throws only post-cell inside the swallowed
# emit, so every cell would burn its full agent wall-clock and emit ZERO rows.
# Resolve every (arm, tier) — plus (BASELINE, tier); a non-opencode baseline
# returns undefined without throwing — and die HERE, before any server or arm
# container, naming the exact missing pair(s).
docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -e ARMS="$ARMS" -e BASELINE="$BASELINE" -e TIER="$TIER" \
  -e CONFIG_JS="$REPO_DIR/host/test/lib/config.js" \
  --entrypoint node "$RUNNER_IMAGE" -e '
    import(process.env.CONFIG_JS).then(({ VALID_CONFIGS, OPENCODE_CONFIGS, modelConfigIdFor }) => {
      const arms = process.env.ARMS.trim().split(/\s+/);
      const baseline = process.env.BASELINE;
      const tier = process.env.TIER;
      const bad = arms.filter((a) => !OPENCODE_CONFIGS.includes(a));
      if (bad.length) {
        console.error(`ARMS entries not runnable (must be in OPENCODE_CONFIGS {${OPENCODE_CONFIGS.join(", ")}}): ${bad.join(", ")}`);
        process.exit(1);
      }
      if (!VALID_CONFIGS.includes(baseline)) {
        console.error(`BASELINE "${baseline}" not in VALID_CONFIGS {${VALID_CONFIGS.join(", ")}}`);
        process.exit(1);
      }
      const missing = [];
      for (const id of [...new Set([...arms, baseline])]) {
        try { modelConfigIdFor({ configId: id, tier }); }
        catch (e) { missing.push(`${id} × ${tier}`); }
      }
      if (missing.length) {
        console.error(`arm×tier preflight (#006): no model_config_id mapped for: ${missing.join(", ")} — every cell of such an arm would burn its wall-clock and emit zero rows (the emit-time modelConfigIdFor throw is post-cell). Map the tier in lib/config.js (OPENCODE_*_MODEL_CONFIG_ID_BY_TIER) or drop the arm.`);
        process.exit(1);
      }
    });
  ' || err "ARMS/BASELINE/arm×tier validation failed (see message above)"

# Expected-attempts plan (#003): enumerate every (task, config, rep) cell this
# sweep intends to attempt — written BEFORE the arms phase so the post-gate
# diff audits observed rows against intent, not against whatever survived.
# Also doubles as a stem preflight: an unknown or non-emit-eligible
# SMOKE_TESTS stem (Family C probes emit no row) dies here, pre-server.
PLAN_CSV="$CLAW_RT_DIR/expected_attempts.${OC_SWEEP_ID}.csv"
docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  --entrypoint node "$RUNNER_IMAGE" scripts/expected-attempts.mjs plan \
  --tests-dir "$REPO_DIR/host/test/__tests__/tier-eval" \
  --tiers "$TIER" --configs "$ARMS" --reps "$REPEATS" \
  --filter "$SMOKE_TESTS" --out "$PLAN_CSV" \
  || err "expected-attempts plan failed (see message above)"

# Retried-cell handoff (#019): the cell loop runs inside the eval-runner, so
# its retry counter crosses back to the driver through this per-sweep file on
# the path-matched runtime root (container-written, host-read — the safe
# direction under the OrbStack freeze; host reads are truth). Read + removed
# after each arm for the `retried_cells=N` arm summary field.
RETRY_COUNT_FILE="$CLAW_RT_DIR/.retry-count.${OC_SWEEP_ID}"

# Fresh-row watermark (#003): the registry's line count BEFORE this sweep
# appends anything. The post-gate diff passes it as --since-line so under
# REUSE_ROWS=1 only THIS sweep's rows are audited against the plan (pre-
# existing baseline rows neither satisfy nor inflate it). Rows are appended
# one '\n'-terminated JSON line each (lib/registry.js), so wc -l is exact.
REG_WATERMARK=0
if [ -s "$HOST_REG" ]; then
  REG_WATERMARK="$(wc -l < "$HOST_REG" | tr -d ' ')"
fi

# ---- cleanup-on-exit: leave the lab as found -------------------------------
STARTED_OC=0      # set to 1 iff we start the oc server (→ we stop it)
# #007 host-slice repair state (initialized BEFORE the trap so cleanup can
# reference them unconditionally under set -u; armed only when
# OPENCODE_SERVER_TIMINGS=1 — see the timings block below).
TIMINGS_INDEX=""
TIMINGS_TICKER_PID=""
ARM_STAMP=""
cleanup() {
  local rc=$?
  log ""
  log "[cleanup] restoring lab state (driver rc=$rc)..."

  # #007: no orphan host tickers — the per-arm stop is the normal path; this
  # is the backstop for a sweep dying mid-arm (err/INT/TERM). Inline (not the
  # helper function) so the trap is safe even before the helpers are defined.
  if [ -n "${TIMINGS_TICKER_PID:-}" ]; then
    kill "$TIMINGS_TICKER_PID" 2>/dev/null || true
    wait "$TIMINGS_TICKER_PID" 2>/dev/null || true
    TIMINGS_TICKER_PID=""
  fi
  if [ -n "${ARM_STAMP:-}" ]; then
    rm -f "$ARM_STAMP" 2>/dev/null || true
  fi
  # #019: the per-arm read removes this on the normal path; backstop for a
  # sweep dying mid-arm so no stale handoff file lingers in the runtime root.
  if [ -n "${RETRY_COUNT_FILE:-}" ]; then
    rm -f "$RETRY_COUNT_FILE" 2>/dev/null || true
  fi

  # Reap any sibling run containers THIS sweep may have orphaned (a wedged
  # opencode run reaped by runOpenCode's own timeout normally clears these;
  # the per-cell timeout reap in the arm loop clears the cap-kill case; this
  # is the backstop for one that slipped through). Scoped (#004) to this
  # sweep's label — `mac-llm-lab.sweep=$OC_SWEEP_ID`, stamped by the compose
  # service label — NEVER the bare oc-run- name prefix, so containers from a
  # concurrent sweep or a manual `docker compose run` are left alone.
  # Best-effort; never fatal.
  local orphans
  orphans="$(docker ps -aq --filter "label=mac-llm-lab.sweep=$OC_SWEEP_ID" 2>/dev/null || true)"
  if [ -n "$orphans" ]; then
    log "[cleanup] reaping this sweep's orphaned oc-run-* containers (label mac-llm-lab.sweep=$OC_SWEEP_ID): $(echo "$orphans" | wc -l | tr -d ' ')"
    # shellcheck disable=SC2086
    docker rm -f $orphans >/dev/null 2>&1 || true
  fi

  # Stop the oc server ONLY if we started it (else leave it as we found it —
  # in particular the resident tier-64 daemon on :11436 is never touched).
  if [ "$STARTED_OC" = 1 ]; then
    log "[cleanup] stopping oc-$TIER server (we started it)..."
    OPENCODE_TIER="$TIER" "$OC_SERVER" stop >/dev/null 2>&1 || true
  fi
}
# #020: the signal path MUST NOT share the EXIT trap. A bash trap handler
# returns to the interrupted command, so `trap cleanup EXIT INT TERM` ran
# cleanup on Ctrl-C — killing the ticker, reaping the sweep's containers,
# stopping any driver-started server — and then RESUMED the sweep: capture
# pass, next arm, every cell against a dead server, emitting schema-valid
# error/timeout rows with the overflow scan disarmed. Split paths: signals
# clean up once, disarm the EXIT trap (so cleanup never runs twice), and
# terminate with the conventional 128+SIGINT code.
on_interrupt() {
  log ""
  log "!! ============================================================"
  log "!! SWEEP INTERRUPTED (SIGINT/SIGTERM) — cleaning up and terminating."
  log "!! No further arms, cells, capture passes, audits or gates will run."
  log "!! Registry rows emitted so far remain at: $HOST_REG"
  log "!! ============================================================"
  cleanup
  trap - EXIT
  exit 130
}
trap cleanup EXIT
trap on_interrupt INT TERM

log "==> run-config-ab.sh  tier=$TIER  tests=[$SMOKE_TESTS] repeats=$REPEATS"
log "    arms=[$ARMS]  baseline=$BASELINE  reuse_rows=$REUSE_ROWS"
log "    shared registry → $HOST_REG"
log "    harness_version (GIT_SHA) = $GIT_SHA"

# ---- #015/#016 rotation preflight: BEFORE any cursor, ticker or container ---
# Cap-check (and, if over-cap, copytruncate-rotate) the tier's llama-server log
# via the guarded rotate-opencode-server-log.sh. This is the ONLY safe seat
# (#015 decision: no timer — TOCTOU): it runs before this sweep starts any
# sweep-labeled container (guard G1), creates its ticker index (guard G2), or
# opens any byte cursor, so rotation can never corrupt offsets this sweep
# records. Guard semantics respected:
#   exit 0 — rotated or below cap (no-op): proceed;
#   exit 2 — guard REFUSAL (another sweep's containers, a fresh index from a
#            <30-min-old sweep, or the resident lock held without
#            OC_ROTATE_HOLDING_LOCK=1): tolerated as SKIP — rotation is
#            between-sweeps hygiene, never worth failing a sweep over;
#   else   — real rotation error: FATAL (a half-rotated log would corrupt
#            every offset this sweep is about to record).
# Invokers that already hold /tmp/oc-resident.lock.d (the canonical sweep
# protocol) export OC_ROTATE_HOLDING_LOCK=1 to let G3 pass; it is inherited
# from this environment by the rotate script.
ROTATE_SH="$REPO_DIR/host/llama-server/scripts/rotate-opencode-server-log.sh"
ROTATE_RC=0
"$ROTATE_SH" --log "${OPENCODE_LLAMA_LOG:-${OPENCODE_LOG_BASE}${OC_LOG_TAG}.log}" || ROTATE_RC=$?
case "$ROTATE_RC" in
  0) : ;;
  2) log "    rotation preflight: REFUSED by rotate guards (rc=2) — skipping (hygiene only; sweep proceeds)" ;;
  *) err "rotation preflight failed (rc=$ROTATE_RC) — refusing to sweep over a possibly half-rotated log" ;;
esac

# ---- server: up iff needed (stop iff started — see cleanup) -----------------
if [ "$(http "$OC_HEALTH")" = 200 ]; then
  log "==> oc-$TIER already green on :$OC_PORT — using as found (will not stop it)"
else
  log "==> starting oc-$TIER server on :$OC_PORT..."
  OPENCODE_TIER="$TIER" "$OC_SERVER" start || err "oc-$TIER server failed to reach green /health"
  # Set ONLY after a start THIS driver performed succeeded (#005 defect 2):
  # setting it before start meant a failed start (e.g. against another owner's
  # mid-load server reached via the shared per-tier pidfile) made the cleanup
  # trap stop a server this driver never started — violating stop-iff-I-
  # started-it. On any start failure STARTED_OC stays 0 and cleanup leaves
  # whatever is (or was coming) up on :$OC_PORT untouched.
  STARTED_OC=1
fi
[ "$(http "$OC_HEALTH")" = 200 ] || err "oc-$TIER not green at $OC_HEALTH"

# ---- #007: server-timings plumbing (opt-in; flag off = exactly no-op) -------
# When OPENCODE_SERVER_TIMINGS=1 on the host, the eval-runner needs to read the
# tier's llama-server log (lib/opencode_server_timings.js log-cursor capture).
# Host log path is derived from THE SAME tier table opencode-server reads
# (#016): the OPENCODE_LLAMA_LOG override wins, else ${OPENCODE_LOG_BASE} +
# the tier LOG_TAG ("" | -16 | -32) from tiers.conf. Mounted READ-ONLY at a
# fixed container path and pointed at via OPENCODE_LLAMA_LOG in the runner
# env. Checked after server-up so an on-demand tier's freshly created log is
# visible.
TIMINGS_ARGS=()
if [ "${OPENCODE_SERVER_TIMINGS:-}" = 1 ]; then
  HOST_LLAMA_LOG="${OPENCODE_LLAMA_LOG:-${OPENCODE_LOG_BASE}${OC_LOG_TAG}.log}"
  [ -f "$HOST_LLAMA_LOG" ] || err "OPENCODE_SERVER_TIMINGS=1 but the tier-$TIER llama-server log is missing: $HOST_LLAMA_LOG (derived from tiers.conf as opencode-server does: OPENCODE_LLAMA_LOG override, else ${OPENCODE_LOG_BASE}${OC_LOG_TAG}.log). A bind mount of a missing file would silently become a directory — refusing."
  TIMINGS_ARGS=(
    -e OPENCODE_SERVER_TIMINGS=1
    -v "$HOST_LLAMA_LOG:/var/log/opencode-llama-server.log:ro"
    -e OPENCODE_LLAMA_LOG=/var/log/opencode-llama-server.log
    # Virtiofs-freeze relay (T2 boundary, issues/WORKLOG.md): under sweep load
    # OrbStack can freeze the runner's whole view of the mounted log; the
    # capture then re-reads the slice through a throwaway container with a
    # fresh mount of the HOST path, using this same runner image (present by
    # preflight) over the already-mounted docker.sock.
    -e OPENCODE_LLAMA_LOG_HOST="$HOST_LLAMA_LOG"
    -e OPENCODE_TIMINGS_RELAY_IMAGE="$RUNNER_IMAGE"
  )
  # Host-slice repair plumbing (#007 final AC): under sweep load OrbStack's
  # virtiofs can serve a FROZEN view of the host-appended log to ALL containers
  # (stat AND reads, fresh mounts included — T2 diagnosis, issues/WORKLOG.md),
  # so the in-container cursor AND the relay can both come up empty. Host
  # processes always see truth: a background ticker appends
  # "<epoch_ms> <host_log_size>" every ~3s to this per-sweep index while an
  # arm runs; post-arm, frozen runDirs are re-sliced from the host log via the
  # index (see repair_arm_timings below) into <runDir>/server-log.slice — the
  # RETAINED canonical per-run server-log artifact (#002 greps the same file).
  TIMINGS_INDEX="$CLAW_RT_DIR/server-log-index.${OC_SWEEP_ID}.txt"
  ARM_STAMP="$CLAW_RT_DIR/.arm-start.${OC_SWEEP_ID}"
  mkdir -p "$CLAW_RT_DIR"
  : > "$TIMINGS_INDEX"
  log "    server-timings ON: $HOST_LLAMA_LOG → /var/log/opencode-llama-server.log (ro; freeze-relay via $RUNNER_IMAGE)"
  log "    server-timings host-slice repair armed: index $TIMINGS_INDEX (~3s ticks)"
fi

# ---- #007 host-slice repair helpers (no-ops unless TIMINGS_INDEX is set) ----
OC_RT_ROOT="$REPO_DIR/client/opencode/.opencode-runtime"

# Append "<epoch_ms> <host_log_size>" ticks while an arm runs. Host `date` on
# macOS has no %N: second-granularity ×1000 is plenty for a ~3s cadence that
# the window mapping pads by one tick on each side. Killing the subshell ends
# the loop; an in-flight `sleep 3` orphan exits within 3s (no ticker survives
# the sweep — the cleanup trap is the mid-arm backstop).
start_timings_ticker() {
  (
    while :; do
      sz="$(stat -f %z "$HOST_LLAMA_LOG" 2>/dev/null || echo 0)"
      printf '%s %s\n' "$(( $(date +%s) * 1000 ))" "$sz" >> "$TIMINGS_INDEX"
      sleep 3
    done
  ) &
  TIMINGS_TICKER_PID=$!
}

stop_timings_ticker() {
  if [ -n "${TIMINGS_TICKER_PID:-}" ]; then
    kill "$TIMINGS_TICKER_PID" 2>/dev/null || true
    wait "$TIMINGS_TICKER_PID" 2>/dev/null || true
    TIMINGS_TICKER_PID=""
  fi
}

# Post-arm capture pass: for EACH runDir this arm produced (run_summary.json
# newer than the arm-start stamp):
#   1. SLICE (unconditional, #002): map its wall-clock window to a host-log
#      byte window via the tick index (window rule lives in
#      scripts/repair-server-timings.mjs — floor/ceil to the bracketing ticks,
#      pad one tick each side; the title request fires ~at run start so the
#      leading pad matters) and extract it HOST-SIDE (truth even mid-freeze)
#      into <runDir>/server-log.slice — the retained canonical per-run
#      server-log artifact, so the #002 overflow scan has one for EVERY run,
#      frozen or not, transcript or outcome-only.
#   2. TIMINGS REPAIR (freeze signature only, #007 — unchanged semantics):
#      re-join via scripts/repair-server-timings.mjs. Best-effort per runDir:
#      a failed repair leaves the honest 'no_server_timings' artifacts in
#      place and never reddens the sweep.
#   3. OVERFLOW SCAN (#002, every sliced runDir): scan the slice for the
#      pinned llama-server n_ctx-exceeded line; a hit re-types the run
#      harness_error/passed=null in run_summary AND the already-emitted
#      registry row (scripts/patch-context-overflow.mjs — idempotent, loud,
#      provenance on the sidecar). Runs per-arm, i.e. strictly BEFORE the row
#      audit + pairing gate read the registry. A FAILED patch (not "no
#      overflow") sets OVERFLOW_RC=1 → sweep exits 2: the relabel is promised
#      on flag-on sweeps and must not silently not-happen.
post_arm_capture_pass() {
  local rs rd window sb eb winsz eof_sz n_sliced=0 n_repaired=0 n_frozen=0 n_overflow=0
  local oc_out n_found=0
  # #020: NUL-delimited walk — the old `for rs in $summaries` word-split find's
  # output, so a runDir path containing whitespace fragmented into bogus paths
  # (every slice/repair/overflow scan logged OVERFLOW-SCAN-GAP and the #002
  # relabels were silently skipped). Process substitution (not a pipeline) so
  # the loop body runs in THIS shell and its OVERFLOW_RC mutation survives.
  while IFS= read -r -d '' rs; do
    n_found=$((n_found + 1))
    rd="$(dirname "$rs")"
    # ---- 1. slice (every fresh runDir) ------------------------------------
    eof_sz="$(stat -f %z "$HOST_LLAMA_LOG" 2>/dev/null || echo 0)"
    window="$(docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
      --entrypoint node "$RUNNER_IMAGE" scripts/repair-server-timings.mjs window \
      --run-dir "$rd" --index "$TIMINGS_INDEX" --eof "$eof_sz")" \
      || { log "WARNING: [post-arm] OVERFLOW-SCAN-GAP $rd — window mapping FAILED (see node error above): no slice, no overflow scan; if this run overflowed its row is mis-typed (#002)"; continue; }
    sb="${window%% *}"
    eb="${window##* }"
    case "${sb}${eb}" in
      ''|*[!0-9]*) log "WARNING: [post-arm] OVERFLOW-SCAN-GAP $rd — bad window '$window': no slice, no overflow scan"; continue ;;
    esac
    winsz=$((eb - sb))
    # HOST-side extraction: tail/head on the host log (host view is truth).
    # head closing the pipe early can SIGPIPE tail under pipefail — the guard
    # keeps an empty/short slice from killing the sweep.
    if [ "$winsz" -gt 0 ]; then
      tail -c +"$((sb + 1))" "$HOST_LLAMA_LOG" | head -c "$winsz" > "$rd/server-log.slice" || true
    else
      : > "$rd/server-log.slice"
    fi
    n_sliced=$((n_sliced + 1))
    # ---- 2. timings repair (freeze signature only) -------------------------
    # run_summary.json is JSON.stringify(_, null, 2), so the field sits alone
    # on its line — grep is exact here. Outcome-only sidecars carry no
    # server_timings_join_status and are skipped (nothing to re-join: no
    # transcript, no iterations) — they still got step 1's slice and get
    # step 3's overflow scan.
    if grep -q '"server_timings_join_status": "no_server_timings"' "$rs"; then
      n_frozen=$((n_frozen + 1))
      if docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
          --entrypoint node "$RUNNER_IMAGE" scripts/repair-server-timings.mjs repair \
          --run-dir "$rd"; then
        n_repaired=$((n_repaired + 1))
        log "[timings-repair] repaired $rd via host slice [$sb,$eb) (${winsz} bytes of $HOST_LLAMA_LOG)"
      else
        log "[timings-repair] repair FAILED for $rd — 'no_server_timings' artifacts left as captured"
      fi
    fi
    # ---- 3. #002 overflow scan (every sliced runDir) -----------------------
    if oc_out="$(docker run --rm -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
        --entrypoint node "$RUNNER_IMAGE" scripts/patch-context-overflow.mjs scan-and-patch \
        --run-dir "$rd" --registry "$HOST_REG")"; then
      case "$oc_out" in
        *'"overflow":true'*)
          n_overflow=$((n_overflow + 1))
          log "[overflow-patch] $rd: $oc_out"
          ;;
      esac
    else
      log "ERROR: [overflow-patch] FAILED for $rd ($oc_out) — a context-overflow row may be entering the gate as an eligible failure; sweep will exit 2 (#002)"
      OVERFLOW_RC=1
    fi
  done < <(find "$OC_RT_ROOT" -mindepth 2 -maxdepth 2 -name run_summary.json -newer "$ARM_STAMP" -print0 2>/dev/null)
  if [ "$n_found" -eq 0 ]; then
    log "[post-arm] no fresh runDirs since arm start — nothing to inspect"
    return 0
  fi
  log "[post-arm] arm summary: $n_sliced runDir(s) sliced, $n_frozen frozen, $n_repaired repaired, $n_overflow overflow-typed (OVERFLOW_RC=$OVERFLOW_RC)"
}

# Per-sweep shared workspace H, emptied IN PLACE. We deliberately do NOT
# `rm -rf "$H" && mkdir` it: churning H's inode right before bind-mounting it can
# leave OrbStack's file-share with a stale handle, so /workspace shows up EMPTY
# or ABSENT in the sibling and every cell false-fails at workspace.reset() with a
# cryptic `mkdir '/workspace'` ENOENT (observed repeatedly under co-resident
# load — the #019 flake family). Keep the dir, drop only its contents;
# workspace.reset() clears per-cell anyway. The residual flake (stale handle
# despite the stable inode) is handled by the #019 canary + retry layers in
# the runner sh -c below.
mkdir -p "$H"
find "$H" -mindepth 1 -exec rm -rf {} + 2>/dev/null || true
log "    shared workspace H = $H"

# #019 AC1 injection (TEST-ONLY): bind /workspace read-only so the write-probe
# canary must fail the arm in preflight — the bare [ -d ] check it replaced
# passed on exactly this present-but-unusable mount shape.
WS_RO_SUFFIX=""
if [ "${OC_WS_FAULT_RO:-0}" = 1 ]; then
  WS_RO_SUFFIX=":ro"
  log "    #019 INJECT: /workspace bound READ-ONLY (OC_WS_FAULT_RO=1) — the arm must die in the canary preflight"
fi

# ============================================================================
# Arm sub-phases: one per ARMS entry, all appending to the same registry
# ============================================================================
# Each arm runs in the path-matched BAKED runner image $RUNNER_IMAGE: node +
# git + docker CLI + compose are preinstalled at build time (Dockerfile.runner,
# #009) — no per-sweep apk add, no network dependency at phase start. It mounts
# the host socket + the repo at its own path + H at /workspace and runs the
# LIVE test sources (so lib/* is the working tree, not a baked copy — the
# runner image bakes toolchain only, never repo sources). The per-cell loop
# runs inline below. The sidecar-port arms (opencode-a+git / opencode-a+prompt)
# git-init the workspace per-cell inside runAgent.js, which is why `git` is
# baked into the runner image.
#
# RUN_REGISTRY_TESTS_DIR is the path-matched tests dir (the emit default
# /test/... only exists in the baked test image). RUN_REGISTRY_MODEL_CONFIG_ID
# is deliberately UNSET so the emit path auto-picks the (arm, tier) serving
# fingerprint via modelConfigIdFor(); an explicit value would defeat that.
ARMS_RC=0
# #002: set by post_arm_capture_pass when an overflow relabel could not be
# applied to the registry (NOT by "no overflow found"). Folded into exit 2.
OVERFLOW_RC=0
for ARM in $ARMS; do
log ""
log "==> arm $ARM (oc llama-server :$OC_PORT; filter: $FILTER)"
# #007 host-slice repair: stamp the arm start (runDir discovery is
# "run_summary.json newer than this") and tick the host log size while the
# arm runs. Flag off → TIMINGS_INDEX is empty and nothing here fires.
if [ -n "$TIMINGS_INDEX" ]; then
  touch "$ARM_STAMP"
  start_timings_ticker
fi
# #019: no stale handoff — the arm writes this file at cell-loop end; a
# leftover from a previous arm (or a wedged run) must not be read as this
# arm's count.
rm -f "$RETRY_COUNT_FILE"
set +e
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$H:/workspace$WS_RO_SUFFIX" \
  -e CONFIG="$ARM" \
  -e HOST_WORKSPACE="$H" \
  -e OC_RETRY_COUNT_FILE="$RETRY_COUNT_FILE" \
  -e OC_FLAKE_INJECT="${OC_FLAKE_INJECT:-}" \
  -e OC_FLAKE_INJECT_GENUINE="${OC_FLAKE_INJECT_GENUINE:-}" \
  -e TIER="$TIER" \
  -e OPENCODE_CONFIG_JSON="$OC_CONFIG_JSON" \
  -e OC_SWEEP_ID="$OC_SWEEP_ID" \
  -e TIER_EVAL_FILTER="$FILTER" \
  -e PER_TEST_TIMEOUT="$PER_TEST_TIMEOUT" \
  -e RUN_REGISTRY_EMIT=1 \
  -e RUN_REGISTRY_KIND=smoke \
  -e RUN_REGISTRY_HARDWARE_TIER="$TIER" \
  -e RUN_REGISTRY_TESTS_DIR="$REPO_DIR/host/test/__tests__/tier-eval" \
  -e RUN_REGISTRY_PATH="$HOST_REG" \
  -e GIT_SHA="$GIT_SHA" \
  ${TIMINGS_ARGS[@]+"${TIMINGS_ARGS[@]}"} \
  --entrypoint sh "$RUNNER_IMAGE" -c '
    set -u
    # Toolchain assert (#009): everything below is BAKED into the runner image
    # (Dockerfile.runner) — if any tool is missing, someone pointed RUNNER_IMAGE
    # at a bare image; fail fast with the rebuild hint instead of mid-cell.
    for tool in node git docker timeout; do
      command -v "$tool" >/dev/null 2>&1 \
        || { echo "FATAL: $tool missing from runner image — rebuild it: (cd host/test && docker compose build runner)" >&2; exit 3; }
    done
    docker compose version >/dev/null 2>&1 \
      || { echo "FATAL: docker compose plugin missing from runner image — rebuild it: (cd host/test && docker compose build runner)" >&2; exit 3; }
    # Write-probe canary (#019, replacing the bare [ -d /workspace ] check): a
    # stale OrbStack share can serve /workspace as present-but-dead — the -d
    # test passes, then the first real write inside a cell dies with an
    # instant seed-phase ENOENT. Probe the mount for REAL (touch + read-back
    # + rm of a sentinel) with a short bounded settle (3 tries, 2s apart) and
    # fail the ARM here, pre-cell, when the mount is dead. A green canary
    # means HOST_WORKSPACE crossed the container boundary AND the share
    # round-trips bytes (mount contract).
    ws_try=1
    ws_ok=0
    while [ "$ws_try" -le 3 ]; do
      if [ -d /workspace ] \
         && printf canary > /workspace/.oc-ws-canary 2>/dev/null \
         && [ "$(cat /workspace/.oc-ws-canary 2>/dev/null)" = "canary" ] \
         && rm /workspace/.oc-ws-canary 2>/dev/null; then
        ws_ok=1
        break
      fi
      rm -f /workspace/.oc-ws-canary 2>/dev/null
      if [ "$ws_try" -lt 3 ]; then
        echo ">>> /workspace write-probe canary attempt $ws_try failed — settling 2s and retrying (#019)"
        sleep 2
      fi
      ws_try=$((ws_try + 1))
    done
    if [ "$ws_ok" -ne 1 ]; then
      echo "FATAL: /workspace write-probe canary failed after 3 attempts (HOST_WORKSPACE=$HOST_WORKSPACE): touch + read-back + rm of /workspace/.oc-ws-canary did not survive the mount — OrbStack share/mount is dead or stale (a bare -d test can still pass on it); aborting the arm before any cell false-fails with a deep seed ENOENT (#019)." >&2
      exit 4
    fi

    # #019: one cell attempt. $2 selects the TEST-ONLY injection: "flake" =
    # instant real node ENOENT under /workspace (same shape the OrbStack
    # share serves), "genuine" = fast failure WITHOUT the signature, "" =
    # the real cell. The caller merges stderr into the captured stream so
    # the signature is detected on either stream.
    run_attempt() {
      if [ "$2" = "flake" ]; then
        echo ">>> #019 INJECT: replacing this attempt of $1 with a flake-shaped failure (OC_FLAKE_INJECT)"
        node -e "require(\"fs\").readFileSync(\"/workspace/__oc-flake-inject__/seed-file\")"
        return $?
      fi
      if [ "$2" = "genuine" ]; then
        echo ">>> #019 INJECT: replacing this attempt of $1 with a genuine (non-signature) failure (OC_FLAKE_INJECT_GENUINE)"
        node -e "console.log(\"AssertionError [ERR_ASSERTION]: injected genuine failure (#019 test hook)\"); process.exit(1)"
        return $?
      fi
      timeout --signal=TERM --kill-after=20s "${PER_TEST_TIMEOUT}s" \
        node --test --test-concurrency=1 \
          --test-reporter=spec --test-reporter-destination=stdout \
          --test-reporter=./lib/registry-reporter.js --test-reporter-destination=stdout \
          "__tests__/tier-eval/$1.test.js"
    }

    # #019: fresh-row probe for the duplicate-emission gate. The registry is
    # appended by THIS container (registry-reporter in the cell node process),
    # so its own read-back is coherent — no cross-boundary freeze hazard.
    reg_count() {
      if [ -f "$RUN_REGISTRY_PATH" ]; then wc -l < "$RUN_REGISTRY_PATH"; else echo 0; fi
    }

    rc=0
    retried=0
    flake_injected=0
    exec 3>&1
    for stem in $TIER_EVAL_FILTER; do
      attempt=1
      while :; do
        echo ">>> $CONFIG cell: $stem (cap ${PER_TEST_TIMEOUT}s)"
        inject=""
        if [ -n "${OC_FLAKE_INJECT:-}" ] && [ "$stem" = "${OC_FLAKE_INJECT:-}" ] && [ "$attempt" -eq 1 ] && [ "$flake_injected" -eq 0 ]; then
          inject=flake
          flake_injected=1
        elif [ -n "${OC_FLAKE_INJECT_GENUINE:-}" ] && [ "$stem" = "${OC_FLAKE_INJECT_GENUINE:-}" ]; then
          inject=genuine
        fi
        reg_before=$(reg_count)
        t0=$(date +%s)
        # Stream the attempt live (tee → fd3 = real stdout) while capturing it
        # for the signature grep; the attempt rc rides fd4 out of the pipeline
        # (POSIX — busybox ash has no PIPESTATUS). stderr is merged into the
        # captured stream so a flake ENOENT is caught wherever node prints it.
        cell=$({ { run_attempt "$stem" "$inject" 2>&1; echo $? >&4; } | tee /tmp/oc-cell-out.txt >&3; } 4>&1)
        elapsed=$(( $(date +%s) - t0 ))
        if [ "$cell" -eq 124 ] || [ "$cell" -eq 137 ]; then
          # Per-cell cap fired (124 = TERM, 137 = the --kill-after KILL). The
          # killed node chain has no SIGTERM handler, so the reporter flush
          # never ran: NO row was emitted for this cell (the end-of-sweep
          # expected-attempts diff names it, #003) — and the oc-run-* sibling
          # SURVIVES the kill, parked on the tier llama-server slot. Reap the
          # containers of THIS sweep now (#004; label mac-llm-lab.sweep=$OC_SWEEP_ID
          # — only one cell is ever in flight, so sweep scope == cell scope).
          # NEVER retried (#019): a timeout is not the flake signature.
          reaped=$(docker ps -a --filter "label=mac-llm-lab.sweep=$OC_SWEEP_ID" --format "{{.Names}}" | tr "\n" " ")
          if [ -n "$reaped" ]; then
            docker rm -f $(docker ps -aq --filter "label=mac-llm-lab.sweep=$OC_SWEEP_ID") >/dev/null 2>&1
            echo ">>> cell $stem KILLED by per-cell cap (rc=$cell): NO row emitted (reporter flush never ran); reaped sweep container(s): $reaped"
          else
            echo ">>> cell $stem KILLED by per-cell cap (rc=$cell): NO row emitted (reporter flush never ran); no sweep-labeled container left to reap"
          fi
          rc=1
          break
        elif [ "$cell" -eq 0 ]; then
          break
        elif [ "$attempt" -eq 1 ] && [ "$elapsed" -le 20 ] \
            && grep -q "ENOENT.*/workspace" /tmp/oc-cell-out.txt; then
          # Flake signature (#019): first attempt, died within 20s of cell
          # start (a real cell runs an agent loop for minutes before it can
          # genuinely fail), output carries the seed-phase ENOENT under
          # /workspace. One more gate before retrying: the attempt must have
          # emitted NO registry row — a row means the cell got past seeding
          # and a second attempt would over-emit it (#003 must stay exact).
          if [ "$(reg_count)" -ne "$reg_before" ]; then
            echo ">>> cell $stem rc=$cell matches the flake signature BUT emitted a registry row — NOT retrying (a second attempt would over-emit the cell and fail the #003 audit); treating as a genuine failure"
            rc=1
            break
          fi
          retried=$((retried + 1))
          echo ">>> cell $stem RETRY (workspace mount flake): rc=$cell after ${elapsed}s with seed-phase ENOENT under /workspace and no row emitted — re-running ONCE (#019)"
          attempt=2
        else
          echo ">>> cell $stem rc=$cell (cell failed; a row was emitted iff runAgent reached the reporter flush — the end-of-sweep expected-attempts diff audits it); continuing"
          rc=1
          break
        fi
      done
    done
    echo ">>> arm $CONFIG: retried_cells=$retried"
    printf "%s\n" "$retried" > "$OC_RETRY_COUNT_FILE" || true
    exit $rc
  '
SUB_RC=$?
set -e
# #007/#002: ticker down first (the index must stop moving before the post-arm
# pass reads it), then slice every fresh runDir from the host log, repair the
# frozen ones, and scan every slice for the #002 overflow line — all strictly
# before the row audit / gate read the registry.
if [ -n "$TIMINGS_INDEX" ]; then
  stop_timings_ticker
  post_arm_capture_pass
fi
[ "$SUB_RC" -ne 0 ] && ARMS_RC=1
# #019: fold the in-runner retry counter into the arm summary line. A missing
# handoff file means the cell loop never completed (canary abort, wedged
# sub-phase) — i.e. zero retries happened.
ARM_RETRIES=0
if [ -f "$RETRY_COUNT_FILE" ]; then
  ARM_RETRIES="$(tr -cd '0-9' < "$RETRY_COUNT_FILE")"
  rm -f "$RETRY_COUNT_FILE"
fi
[ -n "$ARM_RETRIES" ] || ARM_RETRIES=0
log "==> arm $ARM exit rc=$SUB_RC retried_cells=$ARM_RETRIES (cell failures are tolerated; row accountability is audited post-gate)"
done
log ""
log "==> all arms done (arms rc=$ARMS_RC)"

# ============================================================================
# Row audit (#003) — observed-vs-planned: every planned (task, config, rep)
# cell must have produced a registry row. Runs on the FRESH rows only (the
# --since-line watermark taken before the arms phase), so REUSE_ROWS baseline
# rows neither satisfy nor inflate the plan. A shortfall names the missing
# cells and turns the sweep red (exit 2) even if every other phase passed.
# ============================================================================
log ""
log "==> Row audit: expected-attempts diff (plan: $PLAN_CSV, watermark: $REG_WATERMARK lines)"
AUDIT_RC=0
docker run --rm \
  -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
  --entrypoint node "$RUNNER_IMAGE" \
  scripts/expected-attempts.mjs diff \
  --expected "$PLAN_CSV" --registry "$HOST_REG" --since-line "$REG_WATERMARK" \
  || AUDIT_RC=1

# ============================================================================
# Gate — every row config_id-stamped, both sides of each pair bucketed
# ============================================================================
log ""
log "==> Gate: paired_bootstrap must bucket BOTH configs of every (arm, baseline) pair"
GATE_RC=0
if [ ! -s "$HOST_REG" ]; then
  # Not err(): the audit above already named every missing cell; fall through
  # to the combined exit so the arms/audit verdicts aren't masked.
  log "ERROR: no registry rows at $HOST_REG — no arm emitted anything (check arm output above)"
  GATE_RC=1
else
  # Run the gate in the runner image (it has node), against the LIVE registry +
  # libs via the path-matched mount. One gate run per non-baseline arm, with
  # EXPLICIT --treatment/--baseline. A single-arm sweep where ARM == BASELINE
  # degenerates to a row-discipline smoke (delta trivially 0) — still asserts
  # every row carries an in-enum config_id.
  TREATMENTS=""
  for ARM in $ARMS; do
    [ "$ARM" = "$BASELINE" ] || TREATMENTS="$TREATMENTS $ARM"
  done
  [ -n "$TREATMENTS" ] || TREATMENTS="$BASELINE"
  set +e
  for TREATMENT in $TREATMENTS; do
  log "[gate] treatment=$TREATMENT vs baseline=$BASELINE"
  docker run --rm \
    -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR/host/test" \
    --entrypoint node "$RUNNER_IMAGE" \
    scripts/config-ab-pairing-check.mjs "$HOST_REG" --tier "$TIER" --treatment "$TREATMENT" --baseline "$BASELINE"
  SUB_RC=$?
  [ "$SUB_RC" -ne 0 ] && GATE_RC=1
  done
  set -e
fi

log ""
log "==> Done. registry: $HOST_REG   (arms rc=$ARMS_RC, audit rc=$AUDIT_RC, overflow rc=$OVERFLOW_RC, gate rc=$GATE_RC)"
log "    verdicts: docker run --rm -v \"$REPO_DIR:$REPO_DIR\" -w \"$REPO_DIR/host/test\" --entrypoint node $RUNNER_IMAGE scripts/config-ab-verdict.mjs \"$HOST_REG\" --tier $TIER --treatment <arm> --baseline $BASELINE"
# Exit-code precedence (#003): ANY nonzero phase fails the sweep; when several
# fail, the most upstream cause wins the code — 1 arms, 2 registry
# accountability (row shortfall OR a #002 overflow relabel that could not be
# applied), 3 gate. The old `exit $GATE_RC` let a REUSE_ROWS sweep whose arms
# all wedged exit 0 on a gate that passed against pre-existing rows.
[ "$ARMS_RC"  -eq 0 ] || exit 1
[ "$AUDIT_RC" -eq 0 ] && [ "$OVERFLOW_RC" -eq 0 ] || exit 2
[ "$GATE_RC"  -eq 0 ] || exit 3
exit 0
