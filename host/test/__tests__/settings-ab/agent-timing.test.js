// Agent-loop latency — N samples for single-file and parallel-file tasks.
//
// Runs the full claw agent via the CLI (not just the bridge), which sends the
// real 50+ tool payload on every request. This exercises the batch-size change
// directly: each claw request prefills ~2200-2800 tokens, above the 2048
// default and below the 4096 optimised batch ceiling.
//
// N=5 for single-file (fast, ~2s each) and N=3 for parallel-file (slower,
// ~8s each) to balance coverage with total runtime. Per-sample timing is
// printed so individual outliers are visible.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw }     from '../../lib/claw.js';
import * as workspace  from '../../lib/workspace.js';
import { clawModel }   from '../../lib/model.js';

const SETTINGS_LABEL = process.env.SETTINGS_LABEL || 'unknown';
const N_SINGLE       = Number(process.env.AGENT_SINGLE_N)   || 5;
const N_PARALLEL     = Number(process.env.AGENT_PARALLEL_N) || 3;
const TIMEOUT        = 300_000;

const SINGLE_PROMPT   = "create hello.py with one line: print('hello')";
const PARALLEL_PROMPT =
  'Create three files in one response: ' +
  'a.py with one line print(1), ' +
  'b.py with one line print(2), ' +
  'c.py with one line print(3).';

function stats(arr) {
  if (!arr.length) return { min: 0, median: 0, p95: 0, mean: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    min:    s[0],
    median: at(0.5),
    p95:    at(0.95),
    mean:   Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
  };
}

// --- single-file ---

describe(`agent: single-file write × ${N_SINGLE} (settings=${SETTINGS_LABEL})`, () => {
  beforeEach(() => workspace.reset());

  it(
    `${N_SINGLE} runs: all produce hello.py, latency distribution reported`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const latencies = [];
      const failures  = [];

      for (let i = 0; i < N_SINGLE; i++) {
        workspace.reset();
        const r = await runClaw({ prompt: SINGLE_PROMPT, model: clawModel, signal});
        const ok = r.code === 0 && workspace.exists('hello.py');
        latencies.push(r.elapsedMs);
        if (!ok) failures.push(`run ${i + 1}: exit=${r.code} files=${JSON.stringify(workspace.list())}`);
        console.log(`  [${i + 1}/${N_SINGLE}] exit=${r.code} ${r.elapsedMs}ms ok=${ok}`);
      }

      const s = stats(latencies);
      console.log(`\n=== agent-single (${SETTINGS_LABEL}) ===`);
      console.log(`  passes=${N_SINGLE - failures.length}/${N_SINGLE}`);
      console.log(`  latency = min ${s.min}ms · median ${s.median}ms · p95 ${s.p95}ms · mean ${s.mean}ms`);
      if (failures.length) console.log(`  failures:\n    ${failures.join('\n    ')}`);

      assert.equal(failures.length, 0, `${failures.length} run(s) failed:\n${failures.join('\n')}`);
    },
  );
});

// --- parallel-file ---

describe(`agent: parallel-file write × ${N_PARALLEL} (settings=${SETTINGS_LABEL})`, () => {
  beforeEach(() => workspace.reset());

  it(
    `${N_PARALLEL} runs: all produce a.py b.py c.py, latency distribution reported`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const latencies = [];
      const failures  = [];
      const EXPECTED  = ['a.py', 'b.py', 'c.py'];

      for (let i = 0; i < N_PARALLEL; i++) {
        workspace.reset();
        const r  = await runClaw({ prompt: PARALLEL_PROMPT, model: clawModel, signal});
        const ok = r.code === 0 && EXPECTED.every((f) => workspace.exists(f));
        latencies.push(r.elapsedMs);
        if (!ok) failures.push(`run ${i + 1}: exit=${r.code} files=${JSON.stringify(workspace.list())}`);
        console.log(`  [${i + 1}/${N_PARALLEL}] exit=${r.code} ${r.elapsedMs}ms ok=${ok}`);
      }

      const s = stats(latencies);
      console.log(`\n=== agent-parallel (${SETTINGS_LABEL}) ===`);
      console.log(`  passes=${N_PARALLEL - failures.length}/${N_PARALLEL}`);
      console.log(`  latency = min ${s.min}ms · median ${s.median}ms · p95 ${s.p95}ms · mean ${s.mean}ms`);
      if (failures.length) console.log(`  failures:\n    ${failures.join('\n    ')}`);

      assert.equal(failures.length, 0, `${failures.length} run(s) failed:\n${failures.join('\n')}`);
    },
  );
});
