# #004 Daily-driver acceptance — manual eval log

**Session:** 2026-06-10 · HITL, user hands-on-keyboard, Claude managing state + log
**Issue:** [004-daily-driver-acceptance.md](004-daily-driver-acceptance.md)
**Gate:** passes ⇒ unblocks #008 (gut claw). claw stays bootable until go.

## Method

User does real (toy) Python work through `oc` from a fresh, throwaway git repo
(`/Users/nigel/Desktop/bench/oc-toy`), so the agent's workspace sandbox is real
and disposable. We exercise the two daily-driver paths — `oc run "<prompt>"`
(headless one-shot) and bare `oc` (interactive TUI) — and note every friction.
Tier 64 (resident daemon, the default daily green) unless a step says otherwise.

Toy task ladder (escalating realism):
1. Greenfield create — one file, codegen + workspace write.
2. Function + unit test — multi-file, then run the test.
3. Bugfix on a planted bug — read → edit → verify (the canonical "real work").
4. (Optional) TUI session — the conversational "do I reach for this" feel.

## Environment baseline

`oc status` at session start (from repo root):
- tier 64 → port `:11436`
- config: `client/opencode/opencode.json`
- prompt: `~/.config/opencode/AGENTS.md` [wizard install], **OK (1379 bytes)**
- server: **green** (`http://127.0.0.1:11436/health`)

All preconditions satisfied — no friction at pre-flight.

## Steps

| # | Path | Command (user-entered) | Result | Friction |
|---|------|------------------------|--------|----------|
| 0 | status | `oc status` | all green (tier64/:11436, prompt OK 1379B, server green) | none |
| 1 | setup | `git init` + initial commit in `~/Desktop/bench/oc-toy` | fresh repo, README.md committed, user cd'd in | combined multi-line `&&` block was awkward — user split it; prefer one command per step |
| 2 | `oc run` | `oc run "Create a Python script hello.py that prints 'Hello, world!'..."` | agent Wrote hello.py; `python` not found → self-corrected to `python3` → printed `Hello, world!`; clean exit | container has `python3` only, no `python` alias — agent adapted, no user impact |
| 3 | verify | `cat hello.py` · `python3 hello.py` | file present on host (`print("Hello, world!")`), runs on host → `Hello, world!` | none — workspace mount round-trips both directions |
| 4 | `oc` TUI | bare `oc` (interactive) — task 2 (is_prime + unittest) done conversationally | user verdict: **"works well"** — TUI responsive, edits/tests behaved like headless | none reported |
| 5 | verify | `ls -la` · `python3 -m unittest test_mathutils -v` | mathutils.py + test_mathutils.py on host; **4/4 tests pass** in host env | none — all artifacts owned `nigel:staff` (no root-owned files despite root-in-container) |
| 6 | setup | plant buggy `fizzbuzz.py` (`% 3` before `% 15`) + `test_fizzbuzz.py`; confirm red | `test_fizzbuzz` FAILS as designed (`'Fizz' != 'FizzBuzz'`), other 3 pass | n/a (planting bug) |
| 7 | `oc run` | `oc run "test_fizzbuzz.py is failing... diagnose, fix, re-run"` | Read both files → ran tests (red) → **correct** root cause (unreachable `% 15` branch) → reorder fix (most-specific-first) → re-ran → **4/4 green** → accurate explanation | none — textbook read→diagnose→edit→verify loop |
| 8 | verify | `python3 -m unittest test_fizzbuzz -v` | **4/4 green** on host — container edit persisted to working tree | none |
| 9 | artifact | `git add -A && git commit ...` | **commit `8d58ca8`** in `oc-toy` (agent-authored fix + earlier tasks) | minor (not oc): `__pycache__/*.pyc` committed — toy repo lacks `.gitignore` |

## Friction list

No blocker-grade items. Observed nits (none warrant a follow-up issue on their own):

1. **No `python` alias in the container, only `python3`** (oc-adjacent, cosmetic).
   The agent self-corrected every time it hit `python: command not found`. Could
   add a `python`→`python3` symlink in `client/opencode/Dockerfile` to save the
   agent a wasted step, but it costs nothing functionally. → optional polish.
2. **`__pycache__/*.pyc` got committed** (not oc — toy repo had no `.gitignore`).
3. **Process nit (ours, not oc):** the multi-line `&&` setup block was awkward to
   paste; one command per step is the right cadence for HITL walkthroughs.

What worked, end to end:
- `oc status` preflight surfaced server+prompt health before any work.
- Workspace mount round-trips both directions; host artifacts owned `nigel:staff`
  (no root-owned files despite root-in-container).
- Both daily-driver paths exercised: headless `oc run` (tasks 1 & 3) and the
  interactive TUI (task 2) — user verdict on the TUI: **"works well."**
- The bugfix task (#7) was a genuine read→diagnose→edit→verify loop with a
  correct root-cause fix, not a paper-over.

## Go / no-go for #008

**GO** (pending user's explicit confirmation to record in the ticket).

Rationale: one+ real task completed end-to-end via `oc` (artifact: `oc-toy`
commit `8d58ca8`); friction list captured with zero blocker-grade items; both
invocation paths reach the "I'd reach for this" bar. Nothing here keeps claw on
life support — #008 (gut claw) is unblocked.
