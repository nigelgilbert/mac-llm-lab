// Eval B: parallel tool emission. The previous default-sampling claw
// (temperature 0.7, repeat_penalty 1.05) duplicated tool calls under load —
// "create three files" frequently produced 4–5 write_file blocks for one of
// the three. The current Modelfile / grammar combo ought to issue exactly
// three distinct write_files. We verify the *outcome* (three correct files);
// duplicate-call avoidance shows up as a faster wall time.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw } from '../../lib/claw.js';
import * as workspace from '../../lib/workspace.js';
import { clawModel, BACKEND } from '../../lib/backend.js';

// Outcome-focused prompt — naming a specific tool ("write_file") in the
// prompt is fine for the raw-bridge wrap-rate test where we define our own
// tool, but here the model is using claw's built-in tool registry (Write,
// Edit, Read, Bash). Asking for `write_file` makes the model emit calls to
// a non-existent tool, claw silently rejects them, and the agent ends the
// turn with zero files written. Describe the outcome instead and let the
// model pick its native tool.
const PROMPT =
  "Create three files in one response: " +
  "a.py with one line print(1), " +
  "b.py with one line print(2), " +
  "c.py with one line print(3).";

const EXPECTED = [
  { file: 'a.py', match: /print\(\s*1\s*\)/ },
  { file: 'b.py', match: /print\(\s*2\s*\)/ },
  { file: 'c.py', match: /print\(\s*3\s*\)/ },
];

const TIMEOUT = 300_000;

describe(`eval B — three parallel writes (backend=${BACKEND}, model=${clawModel})`, () => {
  beforeEach(() => workspace.reset());

  it('claw creates a.py, b.py, c.py with matching contents', { timeout: TIMEOUT }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});

    console.log(`\n=== eval-b (${BACKEND}) ===`);
    console.log(`  exit=${r.code} elapsed=${r.elapsedMs}ms files=${JSON.stringify(workspace.list())}`);
    if (r.code !== 0) console.log(`  stderr (tail):\n${r.stderr.slice(-1500)}`);

    assert.equal(r.code, 0);
    for (const { file, match } of EXPECTED) {
      assert.equal(workspace.exists(file), true, `expected ${file} to exist`);
      assert.match(workspace.read(file), match);
    }
  });
});
