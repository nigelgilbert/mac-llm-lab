// parseISO with timezone: implement an ISO 8601 parser that handles offsets and
// invalid input.
//
// Difficulty knob (rule #6): the natural `return new Date(s)` implementation
// passes the well-formed cases (since Date already parses most ISO 8601), but
// fails the invalid-input assertions because Date returns `Invalid Date`
// rather than throwing. The model must validate input and re-throw on bad
// strings — the same shape as the throw-on-error path in expression-eval, but
// with a much narrower spec, producing a cleaner Class-A trace.
//
// Predicted dominant class: A (verify-loop on offset arithmetic or invalid-
// input detection). Diversifies the A-class population beyond expression-eval.
// Pilot first; may be too easy at tier-64 since Date manipulation is well-
// trained.

/** @manifest
 * {
 *   "test_id": "parseISO-with-timezone",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "medium",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1 flags as too-easy at tier-64; lower-tier behavior unknown).",
 *   "expected_tier_signature": "unknown",
 *   "known_confounds": []
 * }
 */

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { parseISO } from './iso.js';

const ZULU = parseISO('2024-01-15T10:30:00Z');
assert.ok(ZULU instanceof Date,                                                'Z returns Date instance');
assert.equal(ZULU.getTime(),                Date.UTC(2024, 0, 15, 10, 30, 0),  'UTC Z basic');
assert.equal(parseISO('2024-01-15T10:30:00.123Z').getTime(),
             Date.UTC(2024, 0, 15, 10, 30, 0) + 123,                           'milliseconds');
assert.equal(parseISO('2024-01-15T10:30:00+00:00').getTime(), ZULU.getTime(),  '+00:00 equals Z');
assert.equal(parseISO('2024-01-15T10:30:00+05:30').getTime(),
             Date.UTC(2024, 0, 15,  5,  0, 0),                                 '+05:30 offset');
assert.equal(parseISO('2024-01-15T18:30:00-08:00').getTime(),
             Date.UTC(2024, 0, 16,  2, 30, 0),                                 '-08:00 offset');
assert.equal(parseISO('2024-06-15T14:00:00-05:30').getTime(),
             Date.UTC(2024, 5, 15, 19, 30, 0),                                 '-05:30 offset');
assert.ok(parseISO('2024-01-15T10:30:00') instanceof Date,                     'no-offset returns Date');

assert.throws(() => parseISO(123),                  /string|invalid|input/i,   'non-string throws');
assert.throws(() => parseISO(''),                   /empty|invalid|input/i,    'empty string throws');
assert.throws(() => parseISO('not a date'),         /invalid|format|parse/i,   'gibberish throws');
assert.throws(() => parseISO('2024-13-15T10:30:00Z'), /invalid|month|range/i,  'invalid month throws');
`;

const PROMPT =
  'Create iso.js that exports a single function `parseISO(s)` returning a ' +
  'Date for ISO 8601 strings. Handle:\n' +
  '  - UTC `Z` suffix (e.g. "2024-01-15T10:30:00Z").\n' +
  '  - Fractional seconds (e.g. "...10:30:00.123Z").\n' +
  '  - Fixed offsets like `+05:30`, `-08:00`, `+00:00`.\n' +
  '  - No-offset strings (assume local time).\n' +
  '  - Invalid input: throw an Error with a descriptive message. Triggers:\n' +
  '      • non-string input → message contains "string", "invalid", or "input"\n' +
  '      • empty string → message contains "empty", "invalid", or "input"\n' +
  '      • unparseable string → message contains "invalid", "format", or "parse"\n' +
  '      • out-of-range fields (e.g. month 13) → message contains "invalid", "month", or "range"\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const CLAW_TIMEOUT = 180_000;
const TIMEOUT = CLAW_TIMEOUT + 20_000;

describe(`parseISO-with-timezone: ISO 8601 parser (tier=${TIER_LABEL})`, () => {
  it('claw implements parseISO with offset handling and invalid-input throws', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'parseISO-with-timezone',
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
