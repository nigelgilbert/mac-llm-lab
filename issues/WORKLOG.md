# PR #6 remediation — implementation worklog

Orchestrated implementation of issues/001–017 (2026-06-10). Maintained by
the orchestrator; one entry per tranche, plus coherence-check notes. Agents
verify their own acceptance criteria and record evidence in each issue's
Result section; this file is the cross-issue narrative.

## Plan

HITL decisions (recorded in the issue files 2026-06-10, lab owner):
- **#002 → Option A**: restore the overflow→`harness_error` relabel,
  llama-server log line as the oracle, soft dependency on #007's capture
  plumbing.
- **#010 → measurement-first**: probe battery in `opencode-server probe` as
  the admission gate; `error_tool_call_count`/`tool_call_count` promoted to
  registry rows with no threshold; threshold deferred to #018.
- Commit policy: one commit per tranche, orchestrator commits after an
  interface-coherence check. Agents never commit.

Tranches (file-ownership-driven; no two parallel agents share a file):

- **T1 ×6:** #001 (lib/opencode.js status discipline) · #005
  (opencode-server lifecycle + driver STARTED_OC) · #009 (run_row config_id
  + harvester) · #012 (verdict guards + shared isEligible) · #013
  (validate-tool-calls + probe hardening) · #017 (transcript fidelity +
  numOrNull consolidation)
- **T2 ×4:** #003+#004+#006+#007-driver-plumbing (single owner of
  run-config-ab.sh) · #007-JS+#008 (single owner of
  opencode_server_timings.js) · #011 (wizard; sequenced after #005 so step
  51 delegates to a stable opencode-server) · #014 (bin/oc +
  dockerComposeArgv)
- **T3 ×2:** #002 (overflow relabel on the #007 capture) · #015 (runtime
  disk hygiene)
- **T4:** #010 (probe battery + row telemetry promotion)
- **T5:** #016 (single tier table; blocked-by #005/#007/#011/#014)
- **Pause:** /compact prep + final-verification briefing.

Interface contract pinned for T2 (driver ↔ timings JS):
`OPENCODE_SERVER_TIMINGS=1` forwarded into the eval-runner; the host
per-tier log bind-mounted read-only at `/var/log/opencode-llama-server.log`;
`OPENCODE_LLAMA_LOG` names the in-container path and, when set, overrides
`defaultServerLogPath(tier)`.

Live-resource rules: T1 — only #005 touches live servers (tiers 16/32 on
:11437/:11438 only; resident :11436 strictly read-only). T2 — live checks
against the resident server serialized via a mkdir lock
(`/tmp/oc-resident.lock.d`); joint live ACs (#007 smoke-with-timings sweep,
wizard step 61 end-to-end) run once by the orchestrator at the tranche
boundary.

## T1 — started 2026-06-10

Launched in parallel: #001, #005, #009, #012, #013, #017.

### T1 results — all six ✅ complete

- **#001** sidecar discipline: `writeSidecarOnce` guard (mirrors `settled`);
  abort provenance sampled at kill time in `onAbort` (caller wins →
  `'interrupted'`, `censored:true`, `passed:null`); schema enum already had
  `interrupted` (no schema change). 3 contract-test assertions updated —
  they had pinned the old buggy `'timeout'` labels.
- **#005** lifecycle: already-running `start` now waits green; `cmd_stop`
  bounded `kill -0` wait + port-release grace (SIGKILL escalation after
  `OPENCODE_LLAMA_STOP_TIMEOUT`=30s); install **refuses** PORT/HOST
  overrides pre-bootstrap (refuse-over-render chosen); OPENCODE_USE_GRAMMAR
  dropped entirely. Driver `STARTED_OC=1` only after a successful
  driver-invoked start. Live-verified on tiers 16/32 (SIGSTOP mid-load
  exercises); resident untouched (pid 31147 before/after). Known residual:
  shared-pidfile adoption semantics (out of scope, documented in issue).
- **#009** provenance: `assembleRow` throws `RunRowAssemblyError` on missing
  `config_id` (no claw-rig default); harvester requires `--config-id`
  validated against lib/config.js `VALID_CONFIGS`; real-runDir harvest →
  pairing gate PASS, claw-rig histogram 0.
- **#012** verdict robustness: `isEligible` exported from
  paired_bootstrap.js and imported (inline copy gone); empty-median guards
  print "wall-clock unavailable (n=0 rows with timestamps)"; byte-identical
  verdict on canonical tier-64 registry (reproduces +3.1pp [0.8, 6.3]).
- **#013** validator/probe: bash-3.2 empty-array + pipefail guards (SUMMARY/
  RESULT now always print; callers can parse final `RESULT:` line
  unconditionally); probe leak detector now matches `<tool_call>` OR
  `<function=`; `SELECTED=` token gone. Entry-point contract for #010
  documented in the issue Result.
- **#017** transcript fidelity: censored-run `pending/running` parts →
  `truncated_tool_call_count` (new run_summary field; per-call
  `result_truncated`), excluded from error counts; one exported coercing
  `numOrNull` (timings) + `strictNumOrNull` (transcript);
  `buildSqliteCliArgs` quote/$&-safe and unit-pinned. W4 packet builder
  (scripts/analysis/build-w4-packet.py) consumption documented as pending —
  one-line follow-up.

### T1 boundary verification (orchestrator)

- Full suite on the stable tree: **179 tests / 178 pass / 1 skip / 0 fail**
  (baseline 143/142/1/0; +36 tests, all T1).
- Diff audit: changed files exactly match the ownership plan; no
  out-of-scope edits.
- Live one-cell smoke (`run-config-ab.sh` defaults, resident tier-64):
  arms rc=0, gate PASS (row config_id-stamped `opencode-a`, both sides
  bucketed), clean lab-state restore. Exercises #001 handlers, #005
  STARTED_OC path, #009 emit path, #017 normalization in one pass.
- Interface coherence: #001's `'interrupted'` is excluded by the
  #012-exported `isEligible` (single predicate, contract-tested); #009's
  throw-on-missing-config_id is upstream of all emit paths the smoke
  exercised; #017's renamed exports compile against all importers (suite).
- Committed as T1.

Carry-forwards for later tranches: runAgent.js RunnerResult typedef comment
still says timeout-only (→ T2 driver agent, owns runAgent.js comments);
W4 builder truncated-counter consumption (→ T4 #010 agent, telemetry
adjacency); historical claw.gbnf mention in
docs/OPENCODE-SIDECAR-PORT-HANDOFF.md (historical doc, leave).

## T2 — started 2026-06-10

Launched in parallel: driver-accountability agent (#003+#004+#006+#007
driver plumbing) · timings agent (#007 JS + #008) · #011 wizard · #014 oc
wrapper.

### T2 agent results — all four ✅ complete

- **#003/#004/#006 (driver)**: exit precedence 1=arms / 2=row-shortfall /
  3=gate; expected-attempts re-wired (4-col plan, `--since-line` registry
  watermark — REUSE_ROWS baseline rows neither satisfy nor inflate);
  per-cell reap + trap scoped to docker label `mac-llm-lab.sweep=$OC_SWEEP_ID`
  (decoy survived); truthful kill log line; arm×tier preflight dies naming
  the missing pair (`opencode-a+prompt × 64` verified); swallowed emit
  failure now sets cell rc via `process.exitCode=1` in **registry_emit.js**
  (flagged ownership deviation — the catch lives there, not runAgent.js;
  accepted). Stale backstop comments updated; RunnerResult typedef carries
  'interrupted'.
- **#007-JS/#008 (timings)**: tier-32 log path; `OPENCODE_LLAMA_LOG`
  verbatim override; fail-loud `log_unreadable`; token-keyed join
  (tolerance ±2/field, exact-first; block `prompt_tokens`↔iter
  `input_tokens`, `decode_tokens`↔`output+reasoning`); ws020 title-block
  fixture pinned; vocabulary: join_status {disabled, no_server_timings,
  log_unreadable, ok, count_mismatch} + join_keying {token,
  ordinal_fallback, null}.
- **#011 (wizard)**: step 51 guarded; step 61 smoke surfaces in exit code;
  curl-twin probe deleted — step 51 delegates to
  `OPENCODE_TIER=$tier opencode-server probe` (3/3 invariants); clean
  full-local install green exit 0 under the resident lock.
- **#014 (oc)**: OPENCODE_CONFIG_JSON absolutized (foreign-cwd mount
  verified in-container; absent → exit 2 pre-docker); upstream `--`
  CONFIRMED honored on opencode 1.16.2 → separator added at BOTH call
  sites (oc + dockerComposeArgv); probe oracle now content-true (sentinel
  appended as last line of the injected AGENTS.md copy, grepped in the
  wire capture; attribution grep demoted to diagnostic).

### T2 boundary verification (orchestrator) — the virtiofs saga

1. Fixed the known cross-boundary item: opencode.contract.test.js argv
   pins updated for the `--` separator (2 lines). Suite then 204/203/1/0.
2. **Joint live AC for #007 initially FAILED**: flag-on smoke produced
   `join_status: no_server_timings`, empty server.timings.jsonl, despite
   the driver plumbing being demonstrably correct (env + ro-mount present)
   and the host log containing exactly the expected 9 timing blocks (8
   iterations + title) inside the cursor window. Root-cause chain, all
   live-verified:
   - parser + slice + mount all correct in isolation (fresh container
     reads the real window: 9 records);
   - instrumented run shows `byteEnd == byteStart` — the eval-runner's
     view of the bind-mounted log FROZE at container-start size;
   - monitor containers prove the freeze is **VM-wide under sweep load**:
     stat AND reads, file-mounts AND dir-mounts, existing AND
     freshly-started containers (a close-time fresh-mount relay container
     read 0 bytes mid-freeze while the host had ~18 KB there); recovers at
     idle. Host processes always see truth.
3. **Capture ladder shipped** (lib + driver + new script, fix-agent):
   in-place read → `readEofSize` (EOF by read, not stat) →
   `relayReadSliceViaDocker` (best-effort fresh-mount container) →
   **host-slice repair** (authoritative): flag-on sweeps run a host-side
   ticker (`<epoch_ms> <size>` every ~3 s →
   `.claw-runtime/server-log-index.<sweep>.txt`); post-arm, any fresh
   runDir with the freeze signature gets its run window mapped via the
   index (±1-tick pads), extracted host-side into
   `<runDir>/server-log.slice` (retained — #002's oracle artifact), and
   re-joined by `scripts/repair-server-timings.mjs` (idempotent; patches
   sidecar + run_summary with `server_timings_repaired_via: 'host_slice'`;
   never reddens the sweep; registry untouched).
4. **Live verification**: freeze reproduced during the verification sweep;
   repair fired; runDir repaired to `join_status: ok`, `join_keying:
   token`, 7/7 rows non-null decode. Flag-off sweep: zero footprint.
   Earlier in the saga one flag-on run joined clean in-place
   (`ok`, 7 rows) when a concurrent reader kept the share fresh — the
   in-place path is intact on healthy platforms.
5. Suite at T2 close: **234 tests / 233 pass / 1 skip / 0 fail**. Resident
   green (pid unchanged), no lock, no stray sweep containers. Wizard joint
   check: #011's clean-install AC ran against the final oc (sentinel
   evidence in its output) — counts as the joint check; not re-run.

### Carry-forwards

- **#002 (T3)**: overflow log-line oracle must respect the freeze
  constraints. `server-log.slice` currently exists only on REPAIRED runs;
  options for the agent: slice unconditionally when flag on, and/or detect
  in-run from the captured slice text when readable with a post-arm
  pre-gate registry patch (loud, provenance-marked) for frozen runs.
  Decide whether overflow typing rides OPENCODE_SERVER_TIMINGS or gets an
  always-on ticker/slice.
- **#015 (T3)**: log rotation MUST NOT use newsyslog (mid-sweep rotation
  corrupts cursor offsets + the host-slice index); use a between-sweeps
  truncate guarded on no-run-in-flight. Pruning must never touch
  sidecars, `server-log.slice`, or degraded-run opencode-data.
- **OrbStack workspace flake** (pre-existing, now loud): `ENOENT
  /workspace/<seed>` killed ~3 of ~10 boundary sweeps tonight under
  co-resident load; #003's audit names the lost cell and reddens the
  sweep (correct behavior). Candidate follow-up issue: mount-canary +
  one retry in the driver.
- Driver agent process note: two of its #007 trace runs were accidental
  live sweeps without the resident lock (~20 s each, no contention
  observed). No action; noted for hygiene.

Committed as T2.

## T3 — started 2026-06-10

Launched in parallel: #002 (overflow relabel, log-line oracle) · #015
(runtime disk hygiene).

### T3 agent results — both ✅ complete

- **#002 (overflow → harness_error, Option A as decided)**: oracle pinned
  empirically from a throwaway tiny-context llama-server (build
  b1-5594d13): `srv send_error: ... request (N tokens) exceeds the
  available context size (M tokens)`; negative finding — mid-decode
  ceiling returns finish_reason 'length' with NO error line, so
  pre-decode rejection is the only signal. Detection rides
  OPENCODE_SERVER_TIMINGS=1 (documented): in-run, captureServerTimings
  scans the slice and a marker rides the serverTimings channel →
  transcript relabels the sidecar BEFORE row emit
  (`harness_error:'context_overflow'`, passed null, provenance fields);
  post-arm PRE-GATE, the driver now slices EVERY fresh runDir (T2
  carry-forward adopted) and `patch-context-overflow.mjs scan-and-patch`
  patches run_summary + the emitted registry row for freeze-blinded runs
  (idempotent, atomic, foreign rows byte-identical, OVERFLOW_RC → exit
  2). detectUpstreamFailure + bridge-slice path deleted; relabel now
  unconditional on a typed overflow (the old exit≠0 gate would have
  missed the tier-16 timeout shape). Semantics-change notes dated into
  OPENCODE-AB-TIER16-VERDICT + AB-PLAN §0b.
- **#015 (disk hygiene)**: prune predicate = run_summary parses ∧
  telemetry === 'transcript' ∧ iterations.jsonl exists; runner-side hook
  after successful normalization (OPENCODE_KEEP_DATA=1 escape hatch;
  degraded/interrupted runs retain); backlog one-shot
  `prune-opencode-data.mjs` (dry-run default): **1,316 of 1,325 dirs
  pruned, 779.9 MiB freed, du 971M → 34M**, runDir count and all
  sidecars/slices byte-identical. Rotation:
  `rotate-opencode-server-log.sh` (cap 50 MB, 8 MB tail → .1,
  copytruncate verified safe under launchd's O_APPEND fd), guards:
  sweep-label containers, fresh ticker index (<30 min), resident-lock
  mutex; live demo under lock (lowered cap) with post-rotation append
  verified. NO LaunchAgent (TOCTOU vs sweep start) — manual
  between-sweeps; driver-preflight rotation recommended to #016.

### T3 boundary verification (orchestrator)

- Full suite on the stable tree: **281 tests / 280 pass / 1 skip / 0
  fail** (T2 close was 234/233/1/0).
- Combined-tree flag-on smoke (the #002 agent's green sweep predated
  #015's prune hook): first attempt died to the known ENOENT /workspace
  flake (audit named the lost cell, sweep red — correct); retry green:
  `1 sliced, 0 frozen, 0 repaired, 0 overflow-typed`, join_status ok
  (in-place rung — no repair needed this time), 7 timing rows, telemetry
  'transcript', and the runDir holds sidecars + server-log.slice with NO
  opencode-data/ — prune verified in the live pipeline.
- Coherence: prune retains everything the repair/patch passes read
  (sidecars, slice, registry untouched); overflow patch runs pre-gate;
  rotation guards include the same sweep-label and ticker-index markers
  the driver creates. No file-ownership violations in the diff.

Committed as T3.

## T4 — started 2026-06-11

Launched: #010 (Layer-A tool-call gate, measurement-first per recorded
decision).

### T4 result — ✅ complete

- Gate: `opencode-server probe` check 4 = tool-call battery via the
  #013-hardened validate-tool-calls.sh (N=6 pinned: 3 prompts ×
  non-stream+stream; `OPENCODE_PROBE_TOOLCALL_REPEATS` raises N, can't
  be zeroed; no skip knob — it IS the admission gate). Verdict line
  `probe: tool-call battery 6/6 parsed, 0 leaks — PASS`; ~4-5 s per
  tier. Agent caught a false premise in the decision text: cmd_install
  did NOT previously invoke the probe — appended `cmd_probe` to
  `cmd_install` so the install seat is real. Wizard step 51 inherits by
  delegation (no wizard edit).
- Telemetry: `tool_call_count` / `error_tool_call_count` /
  `truncated_tool_call_count` promoted to registry rows (nullable
  integers; null for outcome-only/claw-rig sidecars; no threshold
  anywhere; isEligible-neutral, contract-tested). Schema extended;
  canonical registries re-validate (2,048 rows, 0 invalid). W4 packet
  builder consumes the truncated counter (#017 carry-forward closed).
- Verified red-path: stub server (prose / leak modes) turns the probe
  red 0/6 exit 1; healthy 64 (resident, lock) + 16 + 32 (booted and
  stopped, ports quiet after) all 6/6.

### T4 boundary verification (orchestrator)

- Suite: **290 tests / 289 pass / 1 skip / 0 fail**. Diff matches
  ownership.
- Live smoke: green; the emitted row carries
  `tool_call_count: 6, error_tool_call_count: 1,
  truncated_tool_call_count: 0` — opencode-era parse-error telemetry is
  flowing (exactly what #018's threshold review needs).
- Carry-forwards to T5/#016: wizard installs now run the battery twice
  (cmd_install + step 51's probe — dedupe when consolidating call
  sites); step 51's "no tokens generated" comment stale; #015's
  driver-preflight rotation recommendation.

Committed as T4.

## T5 — started 2026-06-11

Launched: #016 (single tier table — the last open issue).

### T5 result — ✅ complete

- **`host/llama-server/tiers.conf`** is THE tier identity table
  (TIERS_ALL, TIER_DEFAULT, per-tier PORT / OPENCODE_CONFIG /
  LAUNCHD_LABEL / LOG_TAG / ALIAS / TEMPLATE, `tier_resolve()`), a
  sibling of models.conf (which stays the MODEL table — the JS
  line-parses tiers.conf, so it carries a strict KEY=VALUE format
  contract). All bash consumers (opencode-server, oc, run-config-ab.sh,
  wizard 51/52/61/doctor, validate-tool-calls, rotate script) source
  it; private case tables deleted. JS: config.js
  parseTiersConf/loadTierTable (+ contract-tested
  FALLBACK_TIER_TABLE for the hermetic unit image);
  defaultServerLogPath now table-derived. Cross-consumer assertion
  `check-tier-table.sh`: 29 ok / 0 fail across 64/16/32; doctored-conf
  drift fails the contract test by name.
- Carry-forwards closed: driver-preflight rotation (before any
  cursor/ticker/container; rc=2 refusal = skip), wizard double-battery
  deduped (exactly one battery-verified probe per install path), stale
  step-51 comment fixed.
- Live: wizard doctor + `wizard selftest` 75/75; 2-task smoke sweep
  green; timings-on sweep green with the full ladder exercised
  (1 sliced, 1 frozen, 1 repaired → join ok, token-keyed, 5/5).

### T5 boundary verification (orchestrator)

Suite: **299 tests / 298 pass / 1 skip / 0 fail**. Resident :11436
green (pid 31147 unchanged across the whole campaign), tiers 16/32
quiet, no stray containers/locks. Committed as T5.

---

# Campaign wrap — all 17 issues complete (2026-06-11)

| Tranche | Commit | Issues |
|---|---|---|
| T1 | a489f7e | #001 #005 #009 #012 #013 #017 |
| T2 | a909a30 | #003 #004 #006 #007 #008 #011 #014 (+ virtiofs capture ladder) |
| T3 | 7d3dc9e | #002 #015 |
| T4 | 27bda27 | #010 |
| T5 | (this commit) | #016 |

Suite trajectory: 143/142/1/0 → 299/298/1/0 (+156 tests, 0 fails at
every boundary). Every tranche boundary ran the full suite + at least
one live smoke; every agent recorded per-AC evidence in its issue's
Result section.

## Brief for the final verification pass (post-/compact)

**What to verify end-to-end (in rough priority order):**
1. Full suite in the pinned container (must be ≥ 299/298/1/0).
2. A clean full-local `wizard install` (deliberately NOT re-run after
   T5's call-site dedupe — T5 verified doctor + selftest + step-level
   paths only; the install path now runs: guarded step 51 →
   opencode-server install → canonical probe incl. 6-call tool battery
   → honest step-61 smoke with sentinel oracle). Under the resident
   lock; it reinstalls the resident daemon and must end green.
3. One multi-arm sweep at tier 16 or 32 (e.g. TIER=16
   ARMS="opencode-a+git opencode-a+prompt" BASELINE=opencode-a+git)
   — exercises on-demand server lifecycle (#005), arm×tier preflight
   (#006), per-cell reap labels (#004), row audit (#003), telemetry
   columns (#010) and the tier table (#016) in one shot.
4. OPENCODE_SERVER_TIMINGS=1 sweep: confirm join_status ok (in-place or
   repaired), slice retained, prune fired (no opencode-data/ in the
   fresh runDir).
5. `check-tier-table.sh` (29 assertions) + a verdict render on a
   canonical registry (byte-stability was pinned in #012).

**Known residuals / accepted risks (cross-agent roll-up):**
- OrbStack: (a) the virtiofs freeze (memory + capture ladder; T2
  section above); (b) the ENOENT /workspace cell flake (~30-50% of
  sweeps under load, now LOUD via the row audit) — candidate follow-up
  issue: driver mount-canary + one cell retry.
- #018 is the designated next step: threshold review after the first
  N=8 post-sprint sweep generates real parse-error telemetry (rows now
  carry tool_call_count / error_tool_call_count /
  truncated_tool_call_count; the T4 boundary smoke already showed
  error_tool_call_count=1 on a passing run).
- tiers.conf ↔ config.js FALLBACK_TIER_TABLE must be edited together
  (contract test catches drift everywhere the conf is visible; the
  hermetic unit image alone cannot).
- #005: shared per-tier pidfile adoption semantics (a driver can adopt
  + later stop a foreign mid-load server it waited green) — inherent
  to the pidfile contract, documented in the issue, out of scope.
- #013: validator's per-run display filter could in-theory pipefail on
  a machine-token-only verdict block (unreachable today).
- Rotation under an operator-held resident lock requires
  OC_ROTATE_HOLDING_LOCK=1 (deliberate #015 posture).
- Flag-off sweeps keep pre-#002 overflow semantics (overflow counts as
  model failure) — documented in the AB plan + tier-16 verdict notes.
