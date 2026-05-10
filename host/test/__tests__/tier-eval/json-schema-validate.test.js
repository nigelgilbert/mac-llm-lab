// Recursive JSON-schema-like validator.
//
// Difficulty knob: recursive structure + multiple keyword interactions +
// path tracking for error messages. The validator must descend into
// objects and arrays, accumulate errors with JSONPath-like paths, and
// return { valid, errors }. A model that handles type+required at the
// top level only fails most cases.
//
// Target: hard.

/** @manifest
 * {
 *   "test_id": "json-schema-validate",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "stateful_logic"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Keep \u2014 recursive structure + path tracking is axis-critical for spec_precision.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [
 *     "context_pressure_high"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { validate } from './validator.js';

const userSchema = {
  type: 'object',
  required: ['name', 'age'],
  properties: {
    name: { type: 'string', minLength: 1 },
    age:  { type: 'number', minimum: 0 },
    email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
    tags: { type: 'array', items: { type: 'string' } },
    address: {
      type: 'object',
      required: ['city'],
      properties: {
        city: { type: 'string' },
        zip:  { type: 'string', pattern: '^\\\\d{5}$' },
      },
    },
  },
};

// (1) Valid input.
{
  const r = validate({ name: 'Ada', age: 30 }, userSchema);
  assert.deepEqual(r, { valid: true, errors: [] }, 'valid minimal');
}

// (2) Missing required field — error with path.
{
  const r = validate({ name: 'Ada' }, userSchema);
  assert.equal(r.valid, false, 'invalid: missing age');
  assert.equal(r.errors.length, 1, 'one error');
  assert.match(r.errors[0].path, /^\\.?age$|^age$/, 'path is age');
  assert.match(r.errors[0].message, /required/i, 'message mentions required');
}

// (3) Wrong type at top level.
{
  const r = validate({ name: 123, age: 30 }, userSchema);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].path, /name/, 'path mentions name');
  assert.match(r.errors[0].message, /string/i, 'message mentions expected type');
}

// (4) minLength.
{
  const r = validate({ name: '', age: 5 }, userSchema);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].path, /name/);
}

// (5) minimum.
{
  const r = validate({ name: 'A', age: -1 }, userSchema);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].path, /age/);
}

// (6) Pattern mismatch.
{
  const r = validate({ name: 'A', age: 5, email: 'not-an-email' }, userSchema);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].path, /email/);
}

// (7) Array items: every element validated, path includes index.
{
  const r = validate({ name: 'A', age: 5, tags: ['ok', 42, 'good'] }, userSchema);
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 1, 'exactly one bad tag');
  assert.match(r.errors[0].path, /tags\\[1\\]|tags\\.1|tags\\/1/, 'path includes index 1');
}

// (8) Nested object — error path includes parent.
{
  const r = validate({ name: 'A', age: 5, address: { zip: 'abcde' } }, userSchema);
  assert.equal(r.valid, false);
  // Two errors: missing city, bad zip pattern.
  assert.ok(r.errors.length >= 1, 'at least one error');
  const paths = r.errors.map(e => e.path).join('|');
  assert.match(paths, /address.*city|address.*zip/, 'errors include nested path');
}

// (9) Multiple top-level errors accumulate (not short-circuit).
{
  const r = validate({}, userSchema);
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 2, 'both name and age missing');
}

// (10) Extra properties are allowed by default.
{
  const r = validate({ name: 'A', age: 5, extra: 'whatever' }, userSchema);
  assert.equal(r.valid, true, 'extras OK');
}
`;

const PROMPT =
  'Create validator.js that exports `validate(value, schema)`. The schema ' +
  'is a JSON-schema-like descriptor supporting these keywords:\n' +
  '  - type:       "string" | "number" | "boolean" | "array" | "object" | "null"\n' +
  '  - required:   array of property names that must be present (object only)\n' +
  '  - properties: map of property-name to sub-schema (object only)\n' +
  '  - items:      sub-schema applied to every element (array only)\n' +
  '  - minLength:  minimum string length (string only)\n' +
  '  - minimum:    minimum numeric value (number only)\n' +
  '  - pattern:    regex source string the value must match (string only)\n' +
  'The function must return { valid: boolean, errors: Array<{path, message}> }.\n' +
  'Behaviour:\n' +
  '  - Accumulate ALL errors; do not short-circuit.\n' +
  '  - Each error has a `path` string identifying the location of the bad ' +
  'value (e.g. "name", "address.city", "tags[1]"; any path format that ' +
  'unambiguously names the location is fine).\n' +
  '  - Recurse into nested objects and arrays.\n' +
  '  - Extra properties (not listed in `properties`) are allowed.\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 300_000;

describe(`json-schema-validate: recursive validator (tier=${TIER_LABEL})`, () => {
  it('claw implements validate with recursive paths and error accumulation', { timeout: TIMEOUT }, async () => {
    const ctx = await runAgentSetup({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      timeoutMs:  TIMEOUT,
      testId:  'json-schema-validate',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('verify.js', VERIFY_JS);
    });
  });
});
