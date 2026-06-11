#!/usr/bin/env python3
"""W4 — build a classifier packet for one (or all) long-tail run(s).

Per TODO-ITERATION-DISTRIBUTION-TEST.md §"W4 — failure-mode classification":
selection rule (per (test_id, sampler_id) cell) is `top-5 by iter_count
∪ wallclock > p90 ∪ residual > 1.5σ from wallclock~output_tokens+iter_count
fit`. The union across cells is the long-tail set.

Each packet is a single Markdown file written into the run's directory:
host/test/.claw-runtime/<run-id>/w4-packet.md

Stdlib only.

Usage:
  build-w4-packet.py                  # build for every long-tail-selected run
  build-w4-packet.py --run-id <uuid>  # build for one run only
  build-w4-packet.py --all-runs       # ignore selection rule, build every run
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Optional

DEFAULT_RUNTIME = (
    Path(__file__).resolve().parents[3] / "test" / ".claw-runtime"
)


def _safe_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def percentile(values: list[float], q: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = (len(s) - 1) * q
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return s[lo]
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)


def _solve_normal(X, y):
    n = len(y)
    if n < 3:
        return None
    p = len(X[0])
    XtX = [[0.0] * p for _ in range(p)]
    Xty = [0.0] * p
    for i in range(n):
        xi = X[i]
        for a in range(p):
            Xty[a] += xi[a] * y[i]
            for b in range(a, p):
                XtX[a][b] += xi[a] * xi[b]
    for a in range(p):
        for b in range(a + 1, p):
            XtX[b][a] = XtX[a][b]
    M = [row + [Xty[i]] for i, row in enumerate(XtX)]
    for col in range(p):
        pivot = col
        for r in range(col, p):
            if abs(M[r][col]) > abs(M[pivot][col]):
                pivot = r
        if abs(M[pivot][col]) < 1e-12:
            return None
        if pivot != col:
            M[col], M[pivot] = M[pivot], M[col]
        for r in range(p):
            if r == col:
                continue
            factor = M[r][col] / M[col][col]
            for c in range(col, p + 1):
                M[r][c] -= factor * M[col][c]
    return [M[i][p] / M[i][i] for i in range(p)]


def cell_residuals(rs: list[dict]) -> dict[str, float]:
    """Returns {run_id: residual_z}. Residuals are from per-cell OLS fit
    wallclock ~ output_tokens + iter_count; standardized by σ."""
    rs2 = [r for r in rs if (r.get("terminal_status") or "").lower() == "completed"]
    rows = []
    for r in rs2:
        wallclock = _safe_float(r.get("wallclock_ms"))
        iters = _safe_float(r.get("iter_count"))
        out = _safe_float(r.get("total_output_tokens"))
        if wallclock is None or iters is None or out is None:
            continue
        rows.append((r["run_id"], wallclock, iters, out))
    if len(rows) < 4:
        return {}
    X = [[1.0, ri[3], ri[2]] for ri in rows]
    y = [ri[1] for ri in rows]
    coefs = _solve_normal(X, y)
    if coefs is None:
        return {}
    preds = [coefs[0] + coefs[1] * ri[3] + coefs[2] * ri[2] for ri in rows]
    resids = [yi - pi for yi, pi in zip(y, preds)]
    if len(resids) < 2:
        return {}
    sigma = statistics.pstdev(resids)
    if sigma == 0:
        return {}
    return {ri[0]: (yi - pi) / sigma for ri, yi, pi in zip(rows, y, preds)}


def classify_stratum(run: dict) -> str:
    """Routes a run into 'failed-tail' or 'successful-tail'.

    Two regimes:
    - Newer runs have `passed` populated from assertion_result.json (the
      eval-test harness writes the real verify.js outcome there). When
      present, it is the source of truth.
    - Older runs (pre-2026-04-28) leave `passed` null. Fall back to the
      proxy used by sampler-arm-compare.py's `passed_count`:
      terminal_status == "done" AND exit_code == 0.
    """
    ts = (run.get("terminal_status") or "").lower()
    exit_code = run.get("exit_code")
    passed_str = (run.get("passed") or "").strip().lower() if run.get("passed") is not None else ""
    has_real_passed = passed_str in ("true", "false", "1", "0")
    if has_real_passed:
        if ts == "done" and exit_code in ("0", 0) and passed_str in ("true", "1"):
            return "successful-tail"
        return "failed-tail"
    if ts == "done" and exit_code in ("0", 0):
        return "successful-tail"
    return "failed-tail"


def select_long_tail(runs: list[dict]) -> dict[str, str]:
    """Selects long-tail runs and returns {run_id: stratum}."""
    cells: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in runs:
        cells[(r.get("test_id"), r.get("sampler_id"))].append(r)
    selected: set[str] = set()
    for key, rs in cells.items():
        # Top-5 by iter_count (ties included).
        s = sorted(rs, key=lambda r: -(_safe_float(r.get("iter_count")) or 0))
        if len(s) >= 5:
            cutoff = _safe_float(s[4].get("iter_count"))
            for r in s:
                ic = _safe_float(r.get("iter_count"))
                if ic is not None and cutoff is not None and ic >= cutoff:
                    selected.add(r["run_id"])
        else:
            for r in s:
                selected.add(r["run_id"])
        # p90 wallclock.
        wallclocks = [_safe_float(r.get("wallclock_ms")) for r in rs]
        wallclocks = [v for v in wallclocks if v is not None]
        p90w = percentile(wallclocks, 0.9)
        if p90w is not None:
            for r in rs:
                wc = _safe_float(r.get("wallclock_ms"))
                if wc is not None and wc > p90w:
                    selected.add(r["run_id"])
        # |residual| > 1.5σ.
        z = cell_residuals(rs)
        for run_id, resid in z.items():
            if abs(resid) > 1.5:
                selected.add(run_id)
    by_id = {r["run_id"]: r for r in runs}
    # All terminal failures (regardless of iter_count tail) go in too —
    # at small n, every failed run is informative for the failure taxonomy.
    for r in runs:
        if classify_stratum(r) == "failed-tail":
            selected.add(r["run_id"])
    return {rid: classify_stratum(by_id[rid]) for rid in selected if rid in by_id}


def load_iterations(p: Path) -> list[dict]:
    out = []
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _truncate(s: str, n: int) -> str:
    if s is None:
        return ""
    s = str(s)
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


def render_packet(run_id: str, summary: dict, iters: list[dict]) -> str:
    L = []
    L.append(f"# W4 packet — {run_id[:8]} ({summary.get('test_id')})")
    L.append("")
    L.append("## Run summary")
    L.append("")
    fields = [
        ("test_id", summary.get("test_id")),
        ("sampler_id", summary.get("sampler_id")),
        ("model_id", summary.get("model_id")),
        ("terminal_status", summary.get("terminal_status")),
        ("censored", summary.get("censored")),
        ("join_status", summary.get("join_status")),
        ("exit_code", summary.get("exit_code")),
        ("wallclock_ms", summary.get("run_elapsed_ms")),
        ("iter_count", summary.get("iter_count")),
        ("total_input_tokens", summary.get("total_input_tokens")),
        ("total_output_tokens", summary.get("total_output_tokens")),
        ("max_input_tokens", summary.get("max_input_tokens")),
        ("total_model_elapsed_ms", summary.get("total_model_elapsed_ms")),
        ("total_non_model_gap_ms", summary.get("total_non_model_gap_ms")),
        ("tool_call_count", summary.get("tool_call_count")),
        ("workspace_changed_count", summary.get("workspace_changed_count")),
        ("no_progress_repeat_count", summary.get("no_progress_repeat_count")),
        ("error_tool_call_count", summary.get("error_tool_call_count")),
        ("truncated_tool_call_count", summary.get("truncated_tool_call_count")),
        ("timing_caveats", summary.get("timing_caveats")),
    ]
    for k, v in fields:
        L.append(f"- **{k}:** {v}")
    L.append("")

    L.append("## Iteration table")
    L.append("")
    L.append("| iter | model_ms | gap_ms | input_tok | output_tok | stop | tools (name+ws+err) |")
    L.append("|---|---|---|---|---|---|---|")
    for it in iters:
        tcs = it.get("tool_calls", []) or []
        tc_summary = ", ".join(
            f"{t.get('name')}({'err' if t.get('result_is_error') else 'ok'},ws={t.get('workspace_changed')})"
            for t in tcs
        )
        L.append(
            f"| {it['iter']} | {it.get('model_elapsed_ms')} | {it.get('non_model_gap_ms')} | "
            f"{it.get('input_tokens')} | {it.get('output_tokens')} | {it.get('stop_reason')} | "
            f"{tc_summary or '_no tool calls_'} |"
        )
    L.append("")

    # Selected transcript excerpts: first 3 iters + last 3 + error iters.
    n_iters = len(iters)
    selected = set()
    selected.update(range(min(3, n_iters)))
    selected.update(range(max(0, n_iters - 3), n_iters))
    for i, it in enumerate(iters):
        if any(t.get("result_is_error") for t in it.get("tool_calls", [])):
            selected.add(i)

    L.append("## Selected iteration excerpts")
    L.append("")
    for i in sorted(selected):
        it = iters[i]
        L.append(f"### iter {it['iter']}")
        for t in it.get("tool_calls", []) or []:
            L.append(f"- tool: **{t.get('name')}** arg_hash={(t.get('arg_hash') or '')[:24]}")
            arg_summary = t.get("arg_summary")
            if arg_summary:
                arg_text = json.dumps(arg_summary, indent=None)[:400]
                L.append(f"  - args: `{arg_text}`")
            if t.get("result_is_error"):
                L.append(f"  - **error class:** {t.get('result_error_class')}")
                L.append(f"  - **signature:** `{_truncate(t.get('result_error_signature'), 200)}`")
            L.append(
                f"  - workspace_changed={t.get('workspace_changed')} "
                f"result_changed_vs_previous_same_call={t.get('result_changed_vs_previous_same_call')}"
            )
        L.append("")

    # Files touched (from tool_calls across iterations).
    L.append("## Files touched (heuristic)")
    L.append("")
    files: dict[str, dict] = {}
    for it in iters:
        for t in it.get("tool_calls", []) or []:
            arg = t.get("arg_summary") or {}
            path = arg.get("path") if isinstance(arg, dict) else None
            if not path:
                continue
            entry = files.setdefault(path, {"reads": 0, "writes": 0, "edits": 0, "runs": 0, "iters": []})
            entry["iters"].append(it["iter"])
            name = t.get("name")
            if name == "read_file":
                entry["reads"] += 1
            elif name == "write_file":
                entry["writes"] += 1
            elif name == "edit_file":
                entry["edits"] += 1
            else:
                entry["runs"] += 1
    if not files:
        L.append("_(no path-bearing tool args observed)_")
    else:
        for path, e in sorted(files.items()):
            iters_str = ",".join(str(i) for i in e["iters"][:8])
            L.append(
                f"- `{path}` — reads={e['reads']} writes={e['writes']} edits={e['edits']} "
                f"runs={e['runs']} (iters: {iters_str}{'…' if len(e['iters']) > 8 else ''})"
            )
    L.append("")
    L.append("## Pointer to raw artifacts")
    L.append("")
    L.append(f"- `iterations.jsonl`: in this run directory")
    L.append(f"- `bridge.iterations.jsonl`: in this run directory")
    L.append(f"- `sessions/<workspace_hash>/session-*.jsonl`: full transcript")
    return "\n".join(L) + "\n"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    p.add_argument("--run-id")
    p.add_argument("--all-runs", action="store_true")
    args = p.parse_args()

    csv_path = args.runtime / "iter-distribution-runs.csv"
    if not csv_path.exists():
        print(f"missing run table at {csv_path}", file=sys.stderr)
        return 2
    with csv_path.open(newline="") as f:
        runs = list(csv.DictReader(f))

    if args.run_id:
        targets = {args.run_id: classify_stratum(next((r for r in runs if r["run_id"] == args.run_id), {}))}
    elif args.all_runs:
        targets = {r["run_id"]: classify_stratum(r) for r in runs}
    else:
        targets = select_long_tail(runs)

    n_failed = sum(1 for s in targets.values() if s == "failed-tail")
    n_succ = sum(1 for s in targets.values() if s == "successful-tail")
    print(
        f"selected {len(targets)} run(s) — failed-tail={n_failed} successful-tail={n_succ}",
        file=sys.stderr,
    )
    for r in runs:
        if r["run_id"] not in targets:
            continue
        run_dir = args.runtime / r["run_id"]
        summary_path = run_dir / "run_summary.json"
        if not summary_path.exists():
            continue
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        iters = load_iterations(run_dir / "iterations.jsonl")
        packet = render_packet(r["run_id"], summary, iters)
        out_path = run_dir / "w4-packet.md"
        out_path.write_text(packet, encoding="utf-8")
        print(f"  → {out_path}")

    # Emit an index for the classifier prompt, with stratum routing.
    index_path = args.runtime / "_w4-index.jsonl"
    with index_path.open("w") as f:
        for r in runs:
            if r["run_id"] not in targets:
                continue
            f.write(json.dumps({
                "run_id": r["run_id"],
                "test_id": r.get("test_id"),
                "sampler_id": r.get("sampler_id"),
                "iter_count": r.get("iter_count"),
                "wallclock_ms": r.get("wallclock_ms"),
                "terminal_status": r.get("terminal_status"),
                "passed": r.get("passed"),
                "stratum": targets[r["run_id"]],
                "packet_path": str((args.runtime / r["run_id"] / "w4-packet.md").resolve()),
            }) + "\n")
    print(f"wrote selection index → {index_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
