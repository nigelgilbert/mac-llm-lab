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

(awaiting agent reports)
