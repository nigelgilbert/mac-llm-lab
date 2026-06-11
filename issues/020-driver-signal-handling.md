# run-config-ab.sh: signal trap resumes a torn-down sweep + path-robustness hardening

**Type**: AFK

**Status:** ✅ Done (2026-06-11)

## Parent

PR #6 review (2026-06-11), harness-core findings 1, 3, 7. The driver is
the load-bearing sweep orchestrator; all three findings are confined to
`host/test/run-config-ab.sh`.

## What to build

Three defects in the driver's edge handling:

1. **Signal trap falls through (the blocker).** `trap cleanup EXIT INT TERM`
   installs a handler that returns normally; in bash, execution then
   resumes at the interrupted command. The per-arm `docker run` is wrapped
   in `set +e`, so a Ctrl-C / SIGTERM delivered there runs `cleanup()` —
   killing the timings ticker, reaping the sweep's containers, and
   stopping the tier llama-server if the driver started it — and then
   *continues the sweep*: capture pass, next arm, every cell against a
   dead server, emitting schema-valid `error`/`timeout` rows into the
   registry with the overflow scan disarmed. Split the signal path from
   the EXIT path (`trap 'cleanup; trap - EXIT; exit 130' INT TERM`, keep
   `trap cleanup EXIT` for the normal route) so an interrupt terminates
   the sweep after cleanup, with a loud interrupted-marker line.

2. **Word-splitting over `find` output.** `post_arm_capture_pass` collects
   run-summary paths into a string and `for rs in $summaries` splits on
   whitespace — a repo path containing a space breaks every slice/repair/
   overflow scan (each fragment logs OVERFLOW-SCAN-GAP and the #002
   relabels are silently skipped). Use `find ... -print0` with a
   `while IFS= read -r -d ''` loop via process substitution (the loop
   mutates `OVERFLOW_RC`, so no pipeline subshell).

3. **REGISTRY_OUT containment is prefix-only.** The
   `case "$HOST_REG" in "$CLAW_RT_DIR"/*)` guard accepts
   `$CLAW_RT_DIR/../../anything`, defeating the must-live-under-the-
   gitignored-runtime-root invariant the REUSE_ROWS protections rest on.
   Canonicalize before the check or reject paths containing `/../`.

## Acceptance criteria

- [x] SIGINT delivered during a live cell (manual or scripted kill of the driver mid-arm): cleanup runs once, the driver exits non-zero with an interrupted marker, and NO subsequent arm/cell/capture-pass output appears after the marker
- [x] After such an interrupt, the registry contains no rows timestamped after the interrupt (no dead-server `error`/`timeout` rows)
- [x] Driver run from a checkout path containing a space: the post-arm capture pass processes every run-summary (no OVERFLOW-SCAN-GAP from path fragments)
- [x] `REGISTRY_OUT=$CLAW_RT_DIR/../escape.jsonl` is rejected with the containment error
- [x] A clean default sweep is behaviorally unchanged (exit 0, same audit output)

## Blocked by

None - can start immediately
