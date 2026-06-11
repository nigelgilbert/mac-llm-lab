# Verdict — claw-rig vs OpenCode config-(a), **tier-64** (issue #016)

**Decision: RETIRE the bespoke claw serving stack at tier-64.** Both
pre-registered §0a rules are MET; OpenCode config-(a) is in fact *superior* on
pass-rate (CI excludes 0) and ~1.6× faster on median wall-clock.

> **Scope: tier-64 ONLY.** tier-16 is evaluated independently in #019 and is not
> touched here — per §0a, a tier-64 retire and a tier-16 keep would both be valid.
> A "retire" here is an adoption call for the M5 Max / 64 GB box, nothing wider.

This verdict is rendered, not asserted. Every figure below is re-derived from the
raw registry by [scripts/config-ab-verdict.mjs](../scripts/config-ab-verdict.mjs),
which reuses the #015 statistic ([lib/paired_bootstrap.js](../lib/paired_bootstrap.js))
and the registry reader ([lib/registry.js](../lib/registry.js)) — the same code the
#013 pairing gate runs. To audit, re-run the command in [Reproduce](#reproduce) and
diff against this page.

---

## Dataset (verified, gitignored — recorded in #014)

`host/test/.claw-runtime/run_registry.config-ab-20260606-165548.jsonl`

- **512 rows** = 2 configs × 32 paired tasks × N=8 (256 / 256).
- **32 paired** `runAgent` tasks, **0 unpaired** — every task has eligible runs on
  both sides. (The plan's "35" over-counted: `latency`, `prose-quality`,
  `tool-discipline` are claw-bridge probe diagnostics that never call `runAgent` and
  emit no registry row; the 4 `frontier/` tasks are claw-wired and out of v1 scope.
  True A/B set = **32**. See #014 AC.)
- Driver: [run-config-ab.sh](../run-config-ab.sh), `PHASE_SWAP=1 TIER=64
  CONFIG_AB_REPEATS=8`, per-cell cap 600s. Sweep span 2026-06-06T21:55:49Z →
  2026-06-07T02:17:33Z (≈4.36 h, monitored). Harness commit at run time `3d474f5`.
- Production claw `llama-server` was brought down for Phase B and restored green by
  the EXIT trap (#014 Result).

## Apples-to-apples conditions (what was held constant)

Both sides ran the **same weights, same engine, same sampler, same thinking-mode** —
verified identical in the rows' provenance fingerprints:

| Held constant (both sides) | Value (from the rows) |
|---|---|
| Model / GGUF | `unsloth/Qwen3.6-35B-A3B-GGUF@UD-Q4_K_XL` |
| Quantization | `UD-Q4_K_XL` (~21 GB) |
| Inference engine | llama.cpp `llama-server` (own port each, phase-swapped) |
| `context_limit` | 65536 |
| Sampler config | `v1-prod` (identical id both sides) |
| Prompt pack | `pp01` |
| Thinking mode | **OFF both sides** (claw via the `claw-llama` LiteLLM route; OpenCode via `--chat-template-kwargs '{"enable_thinking":false}'` — §0, #017) |
| N per cell | 8 |
| Pass oracle | `public_verifier` (`/workspace` post-script only — §0b; no `agent.code` gate) |

The **only** moving parts (the bundle on trial): LiteLLM Anthropic bridge,
`claw.gbnf` grammar, `system-prompt.md`, and the Anthropic-API tool path — all
removed on the OpenCode side in favour of native `<tool_call>` parsing + a corrected
Jinja template + OpenCode defaults. A delta is attributable to *that bundle*, not the
model (§1).

### Provenance line per side (§4.7)

- **claw-rig** — `model_config_id` `qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01`; Qwen3.6-35B-A3B
  UD-Q4_K_XL @ ctx 65536; sampler `v1-prod`; LiteLLM bridge + `claw.gbnf` + `system-prompt.md`;
  thinking-off; oracle `public_verifier`.
- **opencode-a** — `model_config_id` `qwen36-35b-a3b-q4kxl-ctx65k-v1prod-pp01-opencode-a`
  (distinct serving fingerprint per §4.5: same weights/quant/ctx/sampler, but corrected
  Jinja, no grammar, native tool-call, no LiteLLM); thinking-off; oracle `public_verifier`.

---

## Rule 0a.1 — pass-rate non-inferiority → **MET** (in fact superior)

Unit of analysis: per-task pass-probability, **paired by task**, bootstrapped over the
32 tasks (B=10000, seed `0xc0ffee`). Not 256 pooled Bernoulli trials.

- Aggregate delta `(opencode-a − claw-rig)` = **+3.1 pp** (3.125 pp exact).
- **90% paired-bootstrap CI = [+0.8, +6.3] pp.**
- Decision: CI lower bound **+0.8 pp > −5 pp** margin → **non-inferiority MET**.
- The CI **excludes 0** (lower bound > 0) → OpenCode is **statistically superior**, not
  merely non-inferior, on this panel.
- Stable across seeds (`0xc0ffee`, `0x1`, `0x3039` all give +3.1 pp, [0.8, 6.3] pp).

**Per-task deltas (regressions not averaged away — §0a).** Every task: delta ≥ 0
(OpenCode matched or beat claw on every one of the 32). Tasks that differ:

| test_id | claw-rig | opencode-a | delta |
|---|---|---|---|
| expression-eval | 3/6 † | 8/8 | **+50.0 pp** |
| wordy | 6/8 | 8/8 | +25.0 pp |
| book-store | 7/8 | 8/8 | +12.5 pp |
| deep-equal | 7/8 | 8/8 | +12.5 pp |
| two-bucket | 7/8 | 7/8 | +0.0 pp |
| *(remaining 27 tasks)* | 8/8 | 8/8 | +0.0 pp |

No task regressed under OpenCode. The aggregate is carried by `expression-eval` (where
claw context-overflowed/timed-out, below) and `wordy`. † `expression-eval` claw cell is
N=6 after attrition — see footnotes.

## Rule 0a.2 — wall-clock → **MET**

Median wall-clock per side (end_time − start_time, all 256 runs; eligible-only median
in parens — immaterial difference):

| config | median | p90 | max | n |
|---|---|---|---|---|
| claw-rig | **21.7 s** (elig 21.6 s) | 76.5 s | 352.0 s | 256 |
| opencode-a | **13.2 s** (elig 13.2 s) | 39.3 s | 266.6 s | 256 |

- Ratio = 13.2 / 21.7 = **0.61×** ≤ 1.5× → **MET**. OpenCode is faster, not just within
  budget. (claw's median is computed over all 256 incl. its two long context-overflow
  crashes at 348/315 s; excluding them, claw median = 21.6 s — the ratio is 0.61× either
  way.)

> The #014 ticket Result line quotes claw median "21.9 s / 0.60×"; re-derived from the
> rows it is **21.7 s / 0.61×**. The decision is unchanged (≤ 1.5× by a wide margin);
> this doc reports the re-derived figure.

---

## Iteration parity (recorded, not gated — §0b)

| config | median | min | max | n |
|---|---|---|---|---|
| claw-rig | 5 | 0 | 22 | 256 |
| opencode-a | 5 | 1 | 31 | 256 |

Median iteration count is **identical (5)**. OpenCode's tail is longer (max 31 vs 22) —
consistent with its native loop running unbounded under the same wall-clock budget (no
imposed iteration cap, §0b) — but it does not cost wall-clock or pass-rate, so it is
recorded, not gated.

## Attrition — nothing silently dropped

Eligibility follows [lib/paired_bootstrap.js](../lib/paired_bootstrap.js) `isEligible`:
a row counts only with a boolean `passed` and `terminal_status ∉ {harness_error,
interrupted}`.

| config | rows | terminal_status histogram | eligible |
|---|---|---|---|
| claw-rig | 256 | done 252 · error 1 · harness_error 2 · timeout 1 | **254** |
| opencode-a | 256 | done 256 | **256** |

All four non-`done` rows are claw-side; OpenCode had zero attrition:

- `deep-equal` — **error**, `passed=false` → **eligible** fail (claw cell 7/8).
- `expression-eval` — **harness_error** ×2 (`context_overflow`, `passed=null`) →
  **DROPPED** as ineligible; plus **timeout** ×1 (`passed=false`) → **eligible** fail.
  Net: claw `expression-eval` cell = **3/6 eligible** (8 attempts − 2 dropped). The cell
  is under-sampled (N=6, not 8) but still paired and not materially thin; it is the
  task where claw is weakest and OpenCode is 8/8.

No row was silently excluded: the 2 dropped rows are the only ineligible rows, and both
are enumerated. The #013 pairing gate independently confirms claw baseline bucketed 254
(not 0) eligible paired runs.

---

## Deferred (not in this verdict, honestly noted)

- **Token parity — NOT RECORDED in this dataset.** The `run_registry` schema carries no
  token field, so token counts cannot be derived from these rows. Cross-harness token
  parity is deferred to the #021 transcript adapter; it is *not* implied here.
- **Server prompt/decode parity — DEFERRED.** The #014 sweep ran with
  `OPENCODE_SERVER_TIMINGS` **OFF**, because the #021/#022 ordinal join has a known
  `count_mismatch` (OpenCode emits an extra title-generation server request → 5 server
  timings vs 4 harness iterations), which would misalign a server-decode split. The
  tier-64 verdict therefore stands **without** a server-decode comparison; it is deferred
  until the join is keyed robustly (not ordinally). The sweep was **not** re-run for this.

These deferrals do not bear on either §0a rule — both rules are met on pass-rate and
wall-clock alone, which are the only two limbs of the pre-registered decision.

---

## Verdict

| Pre-registered rule (§0a) | Result |
|---|---|
| 0a.1 — 90% paired-bootstrap CI lower bound on `(oc − claw)` pass-rate > −5 pp | **MET** (+0.8 pp; CI [+0.8, +6.3], excludes 0 → superior) |
| 0a.2 — OpenCode median wall-clock ≤ 1.5× claw | **MET** (0.61×) |

**Both rules MET → RETIRE the bespoke claw serving stack (LiteLLM bridge + `claw.gbnf`
+ `system-prompt.md` + Anthropic tool path) at tier-64.** On the same weights, engine,
sampler, and thinking-mode, vanilla OpenCode's native serving path matches-or-beats the
claw rig on every one of the 32 tasks and is faster. The standalone maintenance win of
deleting the bridge + grammar + prompt is realized with no measured pass-rate cost — and
a small measured pass-rate *gain*.

tier-16 remains open (#019).

---

## Reproduce

```sh
# from repo root; node lives in the test image (mac-llm-lab-test:local)
REG="$PWD/host/test/.claw-runtime/run_registry.config-ab-20260606-165548.jsonl"

# full verdict render (this document's figures):
docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" \
  --entrypoint node mac-llm-lab-test:local \
  scripts/config-ab-verdict.mjs "$REG" --tier 64

# independent #013 pairing gate (config_id discipline + both sides bucket):
docker run --rm -v "$PWD:$PWD" -w "$PWD/host/test" \
  --entrypoint node mac-llm-lab-test:local \
  scripts/config-ab-pairing-check.mjs "$REG" --tier 64
```

Both reuse `lib/paired_bootstrap.js` + `lib/registry.js`; the bootstrap is seeded
(`0xc0ffee`, B=10000) so the CI is bit-for-bit reproducible.
