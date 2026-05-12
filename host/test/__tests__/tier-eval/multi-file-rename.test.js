// Multi-file rename + signature change.
//
// Three files are seeded into the workspace; index.js fails because it imports
// a `transform` symbol that lib.js doesn't yet export. The model must:
//   1. Rename `compute` → `transform` in lib.js *and* change the body
//      from `x * 2` to `x * 2 + 1`.
//   2. Update the import + call site in service.js so `run` keeps working.
//   3. Leave index.js alone (the asserts already match the new contract).
//
// Single-file refactor.test.js doesn't exercise cross-file awareness — a model
// that edits lib.js but forgets service.js leaves a broken `run()` and the
// post-condition fails. Expected differentiator: planning + completing
// multi-step edits without dropping a step.

/** @manifest
 * {
 *   "test_id": "multi-file-rename",
 *   "test_version": "v1",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 minimal multi-file refactor; pairs with api-evolution and large-refactor at increasing scale.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const LIB_JS = `\
export function compute(x) {
  return x * 2;
}
`;

const SERVICE_JS = `\
import { compute } from './lib.js';

export function run(n) {
  return compute(n);
}
`;

const INDEX_JS = `\
import assert from 'node:assert/strict';
import { run } from './service.js';
import { transform } from './lib.js';

assert.equal(run(5),       11, 'run(5) should equal 11');
assert.equal(transform(5), 11, 'transform(5) should equal 11');
assert.equal(transform(0),  1, 'transform(0) should equal 1');
`;

const PROMPT =
  'index.js fails because lib.js does not yet export `transform`. ' +
  'Rename the function `compute` to `transform` in lib.js and change its body ' +
  'so it returns `x * 2 + 1`. Update service.js so `run` calls the renamed ' +
  '`transform` directly (the body of `run` should just return `transform(n)`). ' +
  'Leave index.js unchanged. After your edits, running `node index.js` must exit 0.';

const TIMEOUT = 300_000;

describe(`multi-file rename + signature change (tier=${TIER_LABEL})`, () => {
  it('claw renames across files and updates the call site', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            { 'lib.js': LIB_JS, 'service.js': SERVICE_JS, 'index.js': INDEX_JS },
      preconditionMustFail: 'index.js',
      postScript:           'index.js',
      testId:            'multi-file-rename',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('index.js', INDEX_JS);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
