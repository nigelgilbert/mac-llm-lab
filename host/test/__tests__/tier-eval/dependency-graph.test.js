// Dependency graph: implement topological sort with cycle detection.
//
// Difficulty knob: graph algorithm + edge-case correctness. Inputs include
// a DAG (must produce a valid topological order), a graph with a cycle
// (must throw with "cycle" in the message), and a disconnected graph
// (must include every node). The "valid order" check is structural — any
// topo order is accepted — so the model can pick DFS or Kahn's, but it
// must handle all three cases.
//
// Target: hard.

/** @manifest
 * {
 *   "test_id": "dependency-graph",
 *   "test_version": "v1",
 *   "primary_axis": "stateful_logic",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 graph algorithm with cycle/disconnected/DAG branches.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { topoSort } from './graph.js';

function isValidTopoOrder(graph, order) {
  const pos = new Map(order.map((n, i) => [n, i]));
  for (const [node, deps] of Object.entries(graph)) {
    if (!pos.has(node)) return false;
    for (const d of deps) {
      if (!pos.has(d)) return false;
      // d must come BEFORE node (d is a prerequisite)
      if (pos.get(d) >= pos.get(node)) return false;
    }
  }
  return order.length === Object.keys(graph).length;
}

// DAG: a depends on b,c; b depends on c; c depends on nothing; d depends on nothing.
const dag = { a: ['b', 'c'], b: ['c'], c: [], d: [] };
const order1 = topoSort(dag);
assert.ok(Array.isArray(order1),                'returns array for DAG');
assert.ok(isValidTopoOrder(dag, order1),        'returns a valid topo order');

// Disconnected graph: two independent chains.
const disc = { a: ['b'], b: [], x: ['y'], y: [] };
const order2 = topoSort(disc);
assert.ok(isValidTopoOrder(disc, order2),       'handles disconnected graph');

// Cycle: a -> b -> a.
const cyclic = { a: ['b'], b: ['a'] };
assert.throws(() => topoSort(cyclic), /cycle/i, 'throws on cycle with message containing "cycle"');

// Self-loop is a cycle.
const selfLoop = { a: ['a'] };
assert.throws(() => topoSort(selfLoop), /cycle/i, 'self-loop is a cycle');

// Empty graph.
assert.deepEqual(topoSort({}), [], 'empty graph returns empty array');

// Single node, no deps.
assert.deepEqual(topoSort({ a: [] }), ['a'], 'single node');
`;

const PROMPT =
  'Create graph.js that exports `topoSort(graph)`. The input is an object ' +
  'mapping each node name to an array of node names it depends on (its ' +
  'prerequisites). Return an array of all node names in a valid ' +
  'topological order: a node must appear after all of its prerequisites. ' +
  'If the graph contains a cycle (including a self-loop), throw an Error ' +
  'whose message contains the word "cycle". An empty graph returns an ' +
  'empty array. Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 300_000;

describe(`dependency-graph: topological sort with cycle detection (tier=${TIER_LABEL})`, () => {
  it('claw implements topoSort handling DAG, cycle, and disconnected', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'dependency-graph',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('verify.js', VERIFY_JS);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
