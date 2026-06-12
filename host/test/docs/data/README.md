# Canonical run registries (committed evidence)

These three JSONL registries are byte-identical copies of the canonical
`host/test/.claw-runtime/` files behind every published number in the
OpenCode-vs-claw A/B record. They are committed as a **deliberate, scoped
exception** to the `.claw-runtime/`-is-gitignored convention
([OPENCODE-MIGRATION-DECISION.md](../OPENCODE-MIGRATION-DECISION.md) §2.3,
§3.4) so the numbers stay re-derivable after the gut deletes the claw stack.
Do not edit these files; they are evidence, not working data.

| file | rows | backs | source (gitignored) |
|---|---|---|---|
| `run_registry.config-ab-20260606-165548.jsonl` | 512 = 2 arms × 32 tasks × 8 | [OPENCODE-AB-FINAL-REPORT.md](../OPENCODE-AB-FINAL-REPORT.md) tier-64 verdict (RETIRE: +3.1pp [+0.8,+6.3], 0.61× wall) | `.claw-runtime/` same name |
| `run_registry.config-ab-20260607-062848.jsonl` | 512 = 2 arms × 32 tasks × 8 | [OPENCODE-AB-FINAL-REPORT.md](../OPENCODE-AB-FINAL-REPORT.md) tier-16 verdict (KEEP: −7.7pp [−13.1,−2.5], 0.96× wall) + §6.3 normalized CI | `.claw-runtime/` same name |
| `run_registry.sidecar-port-20260610.jsonl` | 1024 = 4 arms × 32 tasks × 8 | [OPENCODE-SIDECAR-PORT-HANDOFF.md](../OPENCODE-SIDECAR-PORT-HANDOFF.md) RESULT table (prompt effect +6.6pp [+3.1,+10.2]; +prompt vs claw −1.5pp [−6.4,+3.5]; normalized +0.8pp [−3.9,+5.9]) | `.claw-runtime/` same name |
| `run_registry.prompt-halves-20260611.jsonl` | 1024 = 4 arms × 32 tasks × 8 | [OPENCODE-PROMPT-HALVES-VERDICT.md](../OPENCODE-PROMPT-HALVES-VERDICT.md) (G1 FAILED: C1 +0.1pp [−3.4,+3.9]; C2 −0.5pp [−3.9,+2.7]; C3 −3.9pp [−7.7,−0.6] — descriptive) | `.claw-runtime/` same name |

Note on the sidecar-port row count: the sweep registry is **1024** rows (the
512-row tier-16 final registry's claw/oc rows reused via `SKIP_PHASE_A`, plus
2 new arms × 32 × 8 = 512). The single `opencode-a+prompt` smoke row from
2026-06-09 lives in the separate, uncommitted
`.claw-runtime/run_registry.sidecar-port-smoke-20260609.jsonl` (513 rows) and
is not part of any published number.

## Re-deriving the published numbers

From the repo root (node lives in the test image; no host node). The bootstrap
is seeded (`B=10000`, seed `0xc0ffee`, `lib/paired_bootstrap.js`) so the CIs
are bit-for-bit reproducible.

```sh
DR="docker run --rm -v $PWD:$PWD -w $PWD/host/test --entrypoint node mac-llm-lab-test:local"

# tier-64 final → RETIRE: +3.1pp, 90% CI [0.8, 6.3]pp, wall 0.61×
$DR scripts/config-ab-verdict.mjs docs/data/run_registry.config-ab-20260606-165548.jsonl --tier 64

# tier-16 final → KEEP: −7.7pp, 90% CI [−13.1, −2.5]pp, wall 0.96×
$DR scripts/config-ab-verdict.mjs docs/data/run_registry.config-ab-20260607-062848.jsonl --tier 16
# §6.3 sensitivity → normalized −5.47pp [−10.94, 0.00]pp
$DR scripts/config-ab-normalized-ci.mjs docs/data/run_registry.config-ab-20260607-062848.jsonl --tier 16

# prompt-halves ablation (2026-06-12 verdict; renderer image: mac-llm-lab-eval-runner:local works too):
#   --treatment opencode-a+prompt    --baseline opencode-a+git → +0.1pp [−3.4, +3.9]  (C1; G1 FAILED)
#   --treatment opencode-a+prompt-h1 --baseline opencode-a+git → −0.5pp [−3.9, +2.7]  (C2, descriptive)
#   --treatment opencode-a+prompt-h2 --baseline opencode-a+git → −3.9pp [−7.7, −0.6]  (C3, descriptive)
$DR scripts/config-ab-verdict.mjs docs/data/run_registry.prompt-halves-20260611.jsonl --tier 16 --treatment opencode-a+prompt --baseline opencode-a+git

# sidecar-port sweep — the four handoff RESULT comparisons:
#   (default)                                            → −7.7pp [−13.1, −2.5]  (replication)
#   --treatment opencode-a+git                           → −8.1pp [−13.9, −2.3]  (git-init control)
#   --treatment opencode-a+prompt --baseline opencode-a+git → +6.6pp [3.1, 10.2] (prompt effect)
#   --treatment opencode-a+prompt                        → −1.5pp [−6.4, 3.5], wall 0.85× (canonical)
$DR scripts/config-ab-verdict.mjs docs/data/run_registry.sidecar-port-20260610.jsonl --tier 16 --treatment opencode-a+prompt
# normalized sensitivity → +0.78pp [−3.91, 5.86]
$DR scripts/config-ab-normalized-ci.mjs docs/data/run_registry.sidecar-port-20260610.jsonl --tier 16 --treatment opencode-a+prompt
```

All six commands above were run against these committed copies on 2026-06-10
(issue #005 of the migration suite) and reproduced the published CIs
verbatim; outputs are pasted in that ticket's §Result (the completed suite
was removed per repo convention — see `issues/005-preserve-canonical-registries.md`
at commit `48e9db3` in git history).
