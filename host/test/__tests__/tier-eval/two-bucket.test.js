/** @manifest
 * {
 *   "test_id": "two-bucket",
 *   "test_version": "v1",
 *   "primary_axis": "convergence",
 *   "secondary_axes": ["spec_precision"],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "Adapted from Exercism JS 'two-bucket' (MIT); mutation depth: HEAVY; key changes: findShortestPath(vesselA,vesselB,target,primary) not solve(...), avoid (3,5,*) and (3,7,*) capacities (use (3,8,*), (4,7,*) instead), result keys actionCount/holder/residual (not moves/goalBucket/otherBucket), holder values 'A'/'B' (not 'one'/'two'), unsolvable returns null (not throws), path: Array<[a,b]> array added (forces BFS-path reconstruction). Per mutations.md §7 mutation-depth gate, the rule-3 'forbid both at same amount < target' twist deferred from v1 to limit ambiguity; revisit after pilot. Canonical at host/test/docs/difficulty-pack/canonicals/two-bucket/. Cycle-3 tweak round 1 (commit 2bfadb9): added per-assertion JSON.stringify(r) payload — REVERTED after c3 evidence that the larger payloads compounded the t16 ctx-overflow problem (B-tweak wrong axis: addressed 'model can't read output' when binding constraint was iter-storm). Cycle-3 tweak round 2 (kept): worked example for findShortestPath(3,8,5,'A') in PROMPT — lower-token cost, clarifies return shape with a concrete trace."
 * }
 */

// What:  Implement findShortestPath(vesselA, vesselB, target, primary) — a
//        BFS over (3,8,*) and (4,7,*) bucket capacities. Allowed actions:
//        fill, empty, pour A→B / B→A. Return {actionCount, holder, residual,
//        path: Array<[a,b]>} for the shortest sequence reaching `target` in
//        either bucket; return null if unsolvable. `primary` constrains the
//        opening move (the chosen bucket gets filled first).
//
// Why:   Softest cell in the c21 N=3 corpus — flat across tiers (t16 2/3,
//        t64 2/3, with one t64 285s claw-timeout on a normal path). Earlier
//        single-rep evidence (c3+c4 t16 0-1/3, t32 3/3) suggested a clean
//        convergence discriminator; that did not replicate at N=3, so the
//        cell is now flagged "candidate tier-sensitivity probe pending
//        wider-N evidence" rather than a confirmed discriminator. Kept in
//        the pack because the saturation defenses still look principled:
//          1) Renamed function + result keys (actionCount/holder/residual)
//             defeat memorized Exercism solutions.
//          2) The path: Array<[a,b]> field forces actual BFS path
//             reconstruction, not just an action count.
//          3) null (not throw) on unsolvable punishes copy-paste shortcuts.
//        Primary axis: convergence. See difficulty-pack/good-tests.md row 5.
//        Rule-3 'forbid both at same amount < target' twist deferred to v2.

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { findShortestPath } from './two-bucket.js';

// Validate that path is a legal sequence of moves.
function isValidStep(prev, curr, capA, capB) {
  const [a1, b1] = prev;
  const [a2, b2] = curr;
  // fill A
  if (a1 < capA && a2 === capA && b2 === b1) return 'fillA';
  // fill B
  if (b1 < capB && b2 === capB && a2 === a1) return 'fillB';
  // empty A
  if (a1 > 0 && a2 === 0 && b2 === b1) return 'emptyA';
  // empty B
  if (b1 > 0 && b2 === 0 && a2 === a1) return 'emptyB';
  // pour A→B
  {
    const t = Math.min(a1, capB - b1);
    if (t > 0 && a2 === a1 - t && b2 === b1 + t) return 'pourAB';
  }
  // pour B→A
  {
    const t = Math.min(b1, capA - a1);
    if (t > 0 && b2 === b1 - t && a2 === a1 + t) return 'pourBA';
  }
  return null;
}

function checkSolvable(capA, capB, target, primary, expected, label) {
  const r = findShortestPath(capA, capB, target, primary);
  assert.notEqual(r, null, label + ': must find a solution');
  assert.equal(typeof r, 'object', label + ': result must be object');
  assert.equal(r.actionCount, expected.actionCount, label + ': actionCount');
  assert.equal(r.holder, expected.holder, label + ': holder');
  assert.equal(r.residual, expected.residual, label + ': residual');

  // Path: array of [a,b] state pairs; length === actionCount + 1; starts at [0,0]
  assert.ok(Array.isArray(r.path), label + ': path is array');
  assert.equal(r.path.length, r.actionCount + 1, label + ': path length === actionCount + 1');
  assert.deepEqual(r.path[0], [0, 0], label + ': path starts at [0,0]');

  // Move 1 must fill the primary bucket (canonical rule)
  if (primary === 'A') {
    assert.deepEqual(r.path[1], [capA, 0], label + ': first move fills primary A');
  } else {
    assert.deepEqual(r.path[1], [0, capB], label + ': first move fills primary B');
  }

  // Each step is a legal move
  for (let i = 1; i < r.path.length; i++) {
    const op = isValidStep(r.path[i-1], r.path[i], capA, capB);
    assert.ok(op !== null, label + ': step ' + i + ' is illegal: ' + JSON.stringify(r.path[i-1]) + '→' + JSON.stringify(r.path[i]));
  }

  // Final state must match holder/residual
  const [finalA, finalB] = r.path[r.path.length - 1];
  if (r.holder === 'A') {
    assert.equal(finalA, target, label + ': final A === target');
    assert.equal(finalB, r.residual, label + ': final B === residual');
  } else {
    assert.equal(finalB, target, label + ': final B === target');
    assert.equal(finalA, r.residual, label + ': final A === residual');
  }
}

// (3,8,3,'A'): trivially fill A as move 1
checkSolvable(3, 8, 3, 'A',
  { actionCount: 1, holder: 'A', residual: 0 },
  '(3,8,3,A) trivial fill A'
);

// (3,8,8,'A'): fill A then fill B (canonical optimization fills the second
// bucket on move 2 if its capacity equals the goal)
checkSolvable(3, 8, 8, 'A',
  { actionCount: 2, holder: 'B', residual: 3 },
  '(3,8,8,A) goal === capB triggers move-2 fill'
);

// (3,8,5,'A'): fill A, fill B, empty A, pour B→A → (3,5)
checkSolvable(3, 8, 5, 'A',
  { actionCount: 4, holder: 'B', residual: 3 },
  '(3,8,5,A) four-move classic'
);

// (3,8,5,'B'): fill B, pour B→A → (3,5) — primary B is faster here
checkSolvable(3, 8, 5, 'B',
  { actionCount: 2, holder: 'B', residual: 3 },
  '(3,8,5,B) primary B is two moves'
);

// (4,7,3,'A'): fill A, fill B, empty A, pour B→A → (4,3)
checkSolvable(4, 7, 3, 'A',
  { actionCount: 4, holder: 'B', residual: 4 },
  '(4,7,3,A) four-move via fill-then-pour'
);

// Unsolvable: gcd doesn't divide target
{
  const r1 = findShortestPath(2, 4, 3, 'A');
  assert.equal(r1, null, '(2,4,3,A) unsolvable: gcd(2,4)=2 does not divide 3');
}
{
  const r2 = findShortestPath(3, 6, 5, 'A');
  assert.equal(r2, null, '(3,6,5,A) unsolvable: gcd(3,6)=3 does not divide 5');
}

// Unsolvable: target exceeds both capacities
{
  const r3 = findShortestPath(3, 8, 9, 'A');
  assert.equal(r3, null, '(3,8,9,A) unsolvable: target > max capacity');
}

// Target equals primary capacity (trivial)
checkSolvable(5, 11, 5, 'A',
  { actionCount: 1, holder: 'A', residual: 0 },
  '(5,11,5,A) trivial primary fill'
);
`;

const PROMPT = `\
Create two-bucket.js that exports \`findShortestPath(vesselA, vesselB, target, primary)\`.

You have two vessels with integer capacities \`vesselA\` and \`vesselB\` (both > 0).
Both start empty (0, 0). Find the SHORTEST sequence of actions that produces
the integer \`target\` amount in either vessel.

Allowed actions on each step:
  - Fill A: pour from infinite source until A is full
  - Fill B: same for B
  - Empty A: dump all of A
  - Empty B: same for B
  - Pour A→B: pour from A into B until A is empty or B is full
  - Pour B→A: same in reverse

Constraints:
  - The FIRST action MUST fill the primary vessel.
    (\`primary === 'A'\` ⇒ first action is "Fill A".)
  - If after the first action the OTHER vessel's capacity equals \`target\`,
    you may take a second action filling that vessel — this is permitted but
    not required by the rules; it just produces a 2-move solution when
    applicable.

Inputs:
  - \`vesselA\`, \`vesselB\`: positive integers (vessel capacities).
  - \`target\`: positive integer (desired amount).
  - \`primary\`: either \`'A'\` or \`'B'\`.

Return value:
  - If no sequence reaches \`target\`: return \`null\`.
  - Otherwise return:
      {
        actionCount: <number of actions in the shortest sequence>,
        holder: <'A' or 'B'>,           // which vessel ends up with the target amount
        residual: <integer>,             // amount in the OTHER vessel at the end
        path: <array of [a, b] state pairs from (0,0) to the final state>
      }
    The \`path\` array must include the initial state \`[0, 0]\` and end with
    the final state. Its length is therefore \`actionCount + 1\`.

Worked example for \`findShortestPath(3, 8, 5, 'A')\`:
  Move 1: Fill A   → state [3, 0]   (mandatory: primary A)
  Move 2: Fill B   → state [3, 8]
  Move 3: Empty A  → state [0, 8]
  Move 4: Pour B→A → state [3, 5]   (target reached in B)
  Result: { actionCount: 4, holder: 'B', residual: 3,
            path: [[0,0],[3,0],[3,8],[0,8],[3,5]] }

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const TIMEOUT = 285_000;

describe(`two-bucket: shortest-path BFS with explicit path reconstruction (tier=${TIER_LABEL})`, () => {
  it('claw solves the task', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'two-bucket',
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
