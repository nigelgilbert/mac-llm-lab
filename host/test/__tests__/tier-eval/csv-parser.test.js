// CSV parser: RFC 4180 with quoted fields, escaped quotes, embedded newlines.
//
// Difficulty knob: small-language parser with multiple interacting rules.
// Naive implementations (split-on-comma, split-on-newline-then-comma)
// fail every hard case. The model must implement a state machine over
// characters, OR carefully think through all the edge cases.
//
// Specifically tested:
//   - basic comma-separated values
//   - quoted fields containing commas
//   - quoted fields containing newlines (embedded)
//   - escaped quotes inside quoted fields ("" → ")
//   - empty fields and trailing empties
//   - mixed quoted/unquoted in same record
//   - CRLF and LF line endings both work
//   - trailing newline does NOT add a phantom empty record
//
// Target: hard.

/** @manifest
 * {
 *   "test_id": "csv-parser",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": [
 *     "stateful_logic"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1).",
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
import { parseCSV } from './csv.js';

// (1) Basic.
assert.deepEqual(
  parseCSV('a,b,c\\n1,2,3'),
  [['a','b','c'],['1','2','3']],
  'basic two-row',
);

// (2) Quoted field containing comma.
assert.deepEqual(
  parseCSV('name,desc\\nfoo,"a, b, c"'),
  [['name','desc'],['foo','a, b, c']],
  'quoted comma',
);

// (3) Quoted field containing newline.
assert.deepEqual(
  parseCSV('a,b\\n"line1\\nline2",x'),
  [['a','b'],['line1\\nline2','x']],
  'embedded newline',
);

// (4) Escaped quotes (doubled).
assert.deepEqual(
  parseCSV('a\\n"she said ""hi"""'),
  [['a'],['she said "hi"']],
  'escaped quote',
);

// (5) Empty fields including trailing.
assert.deepEqual(
  parseCSV('a,,b,\\n,,,'),
  [['a','','b',''],['','','','']],
  'empty fields',
);

// (6) Mixed quoted/unquoted on same record.
assert.deepEqual(
  parseCSV('1,"two",3'),
  [['1','two','3']],
  'mixed quoting',
);

// (7) CRLF line endings.
assert.deepEqual(
  parseCSV('a,b\\r\\n1,2\\r\\n3,4'),
  [['a','b'],['1','2'],['3','4']],
  'CRLF',
);

// (8) Trailing newline does NOT add a phantom empty record.
assert.deepEqual(
  parseCSV('a,b\\n1,2\\n'),
  [['a','b'],['1','2']],
  'trailing newline',
);

// (9) Empty input → empty array.
assert.deepEqual(parseCSV(''), [], 'empty input');

// (10) Single field, no comma.
assert.deepEqual(parseCSV('hello'), [['hello']], 'single field');

// (11) Quoted comma + escaped quote + embedded newline, all in one field.
assert.deepEqual(
  parseCSV('a\\n"x, ""y"",\\nz"'),
  [['a'],['x, "y",\\nz']],
  'all features at once',
);
`;

const PROMPT =
  'Create csv.js that exports `parseCSV(input)`. Parse a CSV string and ' +
  'return an array of records, each record being an array of field strings. ' +
  'Behavior (RFC 4180-ish):\n' +
  '  - Records are separated by LF or CRLF.\n' +
  '  - Fields are separated by commas.\n' +
  '  - A field may be wrapped in double quotes. Inside a quoted field, a ' +
  'comma, LF, or CR is part of the field, not a separator.\n' +
  '  - A literal double-quote inside a quoted field is escaped by doubling ' +
  'it ("") which decodes to a single ".\n' +
  '  - Empty input returns an empty array.\n' +
  '  - A trailing line terminator does NOT produce a phantom empty record.\n' +
  '  - Empty fields produce empty strings (not undefined).\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const CLAW_TIMEOUT = 240_000;
const TIMEOUT = CLAW_TIMEOUT + 20_000;

describe(`csv-parser: RFC 4180-ish parser (tier=${TIER_LABEL})`, () => {
  it('claw implements parseCSV handling every quoting case', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      testId:  'csv-parser',
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
