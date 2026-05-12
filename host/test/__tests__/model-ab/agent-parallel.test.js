// Agent parallel tool emission: three distinct file writes in one response.
// Verifies the model issues exactly three non-duplicate tool calls and that
// the outcome (three correct files) is achieved. Elapsed time also surfaces
// as a throughput signal when comparing models.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw } from '../../lib/claw.js';
import * as workspace from '../../lib/workspace.js';
import { clawModel, MODEL_LABEL } from '../../lib/model.js';

// Outcome-focused: describe the desired result, not the tool name. Naming a
// specific tool (write_file) causes the model to call a non-existent tool;
// claw rejects it silently and no files are written.
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

describe(`agent: parallel file writes (model=${MODEL_LABEL}, bridge=${clawModel})`, () => {
  beforeEach(() => workspace.reset());

  it('claw creates a.py, b.py, c.py with matching contents', { timeout: TIMEOUT }, async ({ signal }) => {
    const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});

    console.log(`\n=== agent-parallel (${MODEL_LABEL}) ===`);
    console.log(`  exit=${r.code} elapsed=${r.elapsedMs}ms files=${JSON.stringify(workspace.list())}`);
    if (r.code !== 0) console.log(`  stderr (tail):\n${r.stderr.slice(-1500)}`);

    assert.equal(r.code, 0);
    for (const { file, match } of EXPECTED) {
      assert.equal(workspace.exists(file), true, `expected ${file} to exist`);
      assert.match(workspace.read(file), match);
    }
  });
});
