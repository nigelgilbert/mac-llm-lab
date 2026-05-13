// Subtle broken spec: the prompt is internally suggestive ("compact form,
// omit zero components"), but the verify script tests the OPPOSITE behavior
// for zero-component edge cases. The model writes the natural compact-form
// implementation, fails on `formatTime(0)`, `formatTime(60)`, and similar
// zero-minute / zero-second cases, and must iterate to converge on the
// verbose form the verify actually demands.
//
// Predicted dominant class: A (verify-loop) with a CLEANER trace than
// expression-eval — the failure is concentrated on 2-3 specific assertions
// rather than spread across 25+, so the W4 classifier can produce sharper
// Class-A signatures for downstream lever authoring.
//
// Methodology caveat: this is intentional spec deception. The audit flags
// it as an ethical test-design call. Including in the pilot per the user's
// decision; if the trace shape ends up dominated by deception-handling
// rather than iteration-loop behavior, exclude from the production suite
// and report as a methodology note.

/** @manifest
 * {
 *   "test_id": "subtle-broken-spec",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1 flags as too-easy at tier-64; expected verify-loop signature is the diagnostic value).",
 *   "expected_tier_signature": "unknown",
 *   "known_confounds": [
 *     "context_pressure_high"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { formatTime } from './formatTime.js';

// Under-minute durations.
assert.equal(formatTime(5),     '5s',         '5 seconds');
assert.equal(formatTime(45),    '45s',        '45 seconds');
assert.equal(formatTime(59),    '59s',        '59 seconds');

// Minute range — verify REQUIRES the seconds component even when zero.
// The prompt's "omit zero components" framing pushes the model toward '1m'.
assert.equal(formatTime(60),    '1m 0s',      'exactly 1 minute (verbose form)');
assert.equal(formatTime(65),    '1m 5s',      '1 minute 5 seconds');
assert.equal(formatTime(125),   '2m 5s',      '2 minutes 5 seconds');
assert.equal(formatTime(3599),  '59m 59s',    'just under an hour');

// Hour range — verify REQUIRES the minutes component even when zero.
assert.equal(formatTime(3600),  '1h 0m',      'exactly 1 hour (verbose form)');
assert.equal(formatTime(3661),  '1h 1m',      '1 hour 1 minute (drops seconds)');
assert.equal(formatTime(7200),  '2h 0m',      'exactly 2 hours (verbose form)');
assert.equal(formatTime(36000), '10h 0m',     '10 hours');

// Zero — the prompt's "compact form" implies empty string; verify demands '0s'.
assert.equal(formatTime(0),     '0s',         'zero seconds');
`;

const PROMPT =
  'Create formatTime.js exporting `formatTime(seconds)` that returns a ' +
  'concise human-readable duration string. Always drop zero-valued ' +
  'components — only show parts of the duration that have a non-zero ' +
  'value. Examples:\n' +
  '  - formatTime(125)  → "2m 5s"     (minutes and seconds)\n' +
  '  - formatTime(65)   → "1m 5s"     (minutes and seconds)\n' +
  '  - formatTime(60)   → "1m"        (zero seconds dropped)\n' +
  '  - formatTime(3661) → "1h 1m"     (zero seconds dropped)\n' +
  '  - formatTime(3600) → "1h"        (zero minutes dropped)\n' +
  '  - formatTime(45)   → "45s"       (just seconds)\n' +
  '  - formatTime(0)    → ""          (empty string for zero duration)\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 180_000;

describe(`subtle-broken-spec: formatTime with prompt/verify mismatch (tier=${TIER_LABEL})`, () => {
  it('claw implements formatTime to match verify (despite suggestive prompt)', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'subtle-broken-spec',
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
