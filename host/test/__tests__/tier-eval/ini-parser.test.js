/** @manifest
 * {
 *   "test_id": "ini-parser",
 *   "test_version": "v1",
 *   "primary_axis": "spec_precision",
 *   "secondary_axes": ["stateful_logic"],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps.",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [],
 *   "introduced_in": "1.21",
 *   "notes": "H4 hand-authored — axis was TBD-post-pilot per PLAN.md; locked at authoring time as spec_precision + stateful_logic via an INI-style config parser. Probes line-by-line state tracking under edge surface (top-level keys, comments, blank lines, quoted values with internal '=', duplicate keys, section reentry). Distinct from existing csv-parser/json-schema-validate by virtue of the section-state-machine pattern. Cycle 2 saturated 100% t16 — added unmatched-quote, whitespace-only-value, internal-whitespace-in-quoted-value, and section-with-spaces edges to harden against naive '.trim().slice(1,-1)' impls. Cycle-3 tweak (analyze-agent): added quoted-value-with-internal-= , single-quote-as-value, and brackets-with-trailing-junk edges; the last requires a strict regex/anchor on the section-header check rather than a naive 'line starts with [' test."
 * }
 */

// What:  Implement parseIni(text) — a line-by-line INI-style config parser.
//        Top-level keys live under the empty-string section ''. Section
//        headers must be a strict bracketed line (no trailing junk).
//        Comments are ';' or '#' as the first non-whitespace character only.
//        Quoted values strip MATCHED double quotes (preserving internal
//        whitespace, ';', '#', and '='); unmatched quotes are kept verbatim.
//        Only the FIRST '=' on a line splits key from value. Section reentry
//        merges into the existing section object; later assignments overwrite.
//        CRLF accepted; malformed lines are silently ignored.
//
// Why:   Suspected-noisy cell, saturation-defense in progress (c21 N=3:
//        ~5/noisy/4 — t32 number compromised by the bridge SSE deadlock
//        documented in usability-pack/memos/bridge-sse-deadlock.md, true
//        saturation is low). Two saturation defenses are load-bearing:
//        1) Edges added cycle-2 (unmatched-quote, whitespace-only-value,
//           internal-whitespace-in-quoted-value, section-with-spaces)
//           defeat naive `.trim().slice(1, -1)` quote-stripping.
//        2) Edges added cycle-3 (quoted-value-with-internal-=, single-
//           quote-as-value, brackets-with-trailing-junk) force a strict
//           regex/anchor on the section-header check rather than a naive
//           `line.startsWith('[')` test, and force quote-stripping AFTER
//           the first-`=` split rather than before.
//        Primary axis: spec_precision; secondary: stateful_logic (line-by-
//        line state tracking with section reentry). Re-confirm noise
//        hypothesis post-SSE-fix before any redesign. See
//        difficulty-pack/good-tests.md row 6.

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const VERIFY_JS = `\
import assert from 'node:assert/strict';
import { parseIni } from './ini-parser.js';

// Empty input → empty top-level section only
assert.deepEqual(parseIni(''),    { '': {} }, 'empty input');
assert.deepEqual(parseIni('   '), { '': {} }, 'whitespace-only input');
assert.deepEqual(parseIni('\\n\\n\\n'), { '': {} }, 'blank lines only');

// Top-level keys (no section header)
assert.deepEqual(
  parseIni('foo=bar\\nbaz=qux'),
  { '': { foo: 'bar', baz: 'qux' } },
  'top-level keys go under empty-string section'
);

// Single section
assert.deepEqual(
  parseIni('[main]\\nfoo=1\\nbar=2'),
  { '': {}, main: { foo: '1', bar: '2' } },
  'single section'
);

// Multiple sections
assert.deepEqual(
  parseIni('[a]\\nx=1\\n[b]\\ny=2'),
  { '': {}, a: { x: '1' }, b: { y: '2' } },
  'two sections'
);

// Mixed: top-level keys + section keys
assert.deepEqual(
  parseIni('top=yes\\n[s]\\nin=here'),
  { '': { top: 'yes' }, s: { in: 'here' } },
  'top-level then section'
);

// Comments: ; and # at line start
assert.deepEqual(
  parseIni('; comment\\nfoo=bar\\n# another\\nbaz=qux'),
  { '': { foo: 'bar', baz: 'qux' } },
  'line-leading semicolon and hash comments'
);

// Comments must be at the start of a line; '#' inside a value is NOT a comment
assert.deepEqual(
  parseIni('color=#ff0000'),
  { '': { color: '#ff0000' } },
  'hash inside value is part of value'
);

// Whitespace around key and value is trimmed
assert.deepEqual(
  parseIni('  spaced  =  value  '),
  { '': { spaced: 'value' } },
  'trim whitespace around key and value'
);

// '=' inside value: only the FIRST '=' is the separator
assert.deepEqual(
  parseIni('expr=a=b=c'),
  { '': { expr: 'a=b=c' } },
  'only first = splits key from value'
);

// Quoted value: surrounding double quotes are stripped, and any '#'/';' inside is preserved
assert.deepEqual(
  parseIni('msg="hello; world"'),
  { '': { msg: 'hello; world' } },
  'double-quoted value preserves semicolon'
);
assert.deepEqual(
  parseIni('path="/etc/conf"'),
  { '': { path: '/etc/conf' } },
  'double-quoted simple value strips quotes'
);

// Empty value
assert.deepEqual(
  parseIni('empty='),
  { '': { empty: '' } },
  'empty value after ='
);

// Duplicate keys: LATER wins
assert.deepEqual(
  parseIni('foo=1\\nfoo=2\\nfoo=3'),
  { '': { foo: '3' } },
  'duplicate keys: later overwrites earlier'
);

// Section reentry: keys merge into the same section object
assert.deepEqual(
  parseIni('[s]\\na=1\\n[t]\\nb=2\\n[s]\\nc=3'),
  { '': {}, s: { a: '1', c: '3' }, t: { b: '2' } },
  'section reentry merges keys'
);

// Section-reentry duplicate-key: LATER wins across the merged result
assert.deepEqual(
  parseIni('[s]\\na=1\\n[t]\\nb=2\\n[s]\\na=99'),
  { '': {}, s: { a: '99' }, t: { b: '2' } },
  'reentry overwrites prior key'
);

// Section header with surrounding whitespace
assert.deepEqual(
  parseIni('  [main]  \\nfoo=bar'),
  { '': {}, main: { foo: 'bar' } },
  'section header with surrounding whitespace'
);

// Lines without '=' (and not section/comment) are ignored
assert.deepEqual(
  parseIni('foo=1\\njust a stray line\\nbar=2'),
  { '': { foo: '1', bar: '2' } },
  'malformed lines are ignored'
);

// CRLF line endings
assert.deepEqual(
  parseIni('foo=1\\r\\n[s]\\r\\nbar=2'),
  { '': { foo: '1' }, s: { bar: '2' } },
  'CRLF line endings'
);

// Indented comment line: a comment marker that is NOT the first non-whitespace
// character on the line is part of the value, NOT a comment.
assert.deepEqual(
  parseIni('   ; this is still a comment\\nkey=val'),
  { '': { key: 'val' } },
  'leading whitespace then ; is still a comment'
);

// Unmatched single trailing quote: the value must NOT have its surrounding
// chars stripped — only paired matching double quotes are stripped.
assert.deepEqual(
  parseIni('msg="hello'),
  { '': { msg: '"hello' } },
  'unmatched quote is preserved verbatim'
);
assert.deepEqual(
  parseIni('msg=hello"'),
  { '': { msg: 'hello"' } },
  'trailing quote alone is preserved verbatim'
);

// Whitespace-only value (after stripping) is the empty string
assert.deepEqual(
  parseIni('blank=   '),
  { '': { blank: '' } },
  'value of only whitespace trims to empty string'
);

// Quoted value with INTERNAL whitespace must be preserved exactly between the quotes
assert.deepEqual(
  parseIni('msg="  hello  world  "'),
  { '': { msg: '  hello  world  ' } },
  'whitespace inside quoted value is preserved'
);

// Section name with internal whitespace is allowed and trimmed at the brackets only
assert.deepEqual(
  parseIni('[my section]\\nfoo=1'),
  { '': {}, 'my section': { foo: '1' } },
  'section name may contain internal spaces'
);

// Quoted value with internal '=' must not be re-split on the inner '='
// (the FIRST '=' splits, then quote-stripping is applied to the resulting value).
assert.deepEqual(
  parseIni('expr="a=b=c"'),
  { '': { expr: 'a=b=c' } },
  'quoted value retains internal = characters'
);

// Single-character value: a value that is exactly one '"' character is NOT
// a matched-quote pair (length-1 quoted value would be empty after stripping
// — but the rule is "wrapped in MATCHING double quotes", and a single quote
// is not a wrapping pair). Preserve verbatim.
assert.deepEqual(
  parseIni('q="'),
  { '': { q: '"' } },
  'single quote character is preserved verbatim (not a matched pair)'
);

// A line that looks like a section header but has trailing junk after the ']'
// is NOT a section header — treat as malformed (silently ignore).
assert.deepEqual(
  parseIni('[main]junk\\nfoo=bar'),
  { '': { foo: 'bar' } },
  'bracketed line with trailing junk is not a section header (ignored)'
);

// Realistic mixed input
{
  const input = [
    '; global config',
    'app=demo',
    'version=1.0',
    '',
    '[server]',
    'host=localhost',
    'port=8080',
    '# auth subsection follows',
    '[auth]',
    'token="secret;ish"',
    'realm=app=prod',     // value contains '='
    '[server]',           // re-enter server
    'host=production.example',
  ].join('\\n');
  assert.deepEqual(parseIni(input), {
    '': { app: 'demo', version: '1.0' },
    server: { host: 'production.example', port: '8080' },
    auth: { token: 'secret;ish', realm: 'app=prod' },
  }, 'realistic mixed input');
}
`;

const PROMPT = `\
Create ini-parser.js that exports \`parseIni(text)\` returning a parsed
configuration object.

INI-style format:

  ; comment line (semicolon)
  # comment line (hash)
  foo=bar               (top-level key)

  [section]
  key=value             (key inside section)

  [other]
  another=thing

Output shape:
  An object whose keys are section names. Top-level keys (those before any
  section header) live under the empty-string section "". Every parsed
  output must contain the empty-string section, even if empty.

  Example:
    parseIni('foo=bar\\n[s]\\nx=1') →
      { '': { foo: 'bar' }, s: { x: '1' } }

Rules:
  - Trim whitespace around keys, values, and section names.
  - Section names are case-sensitive; keys are case-sensitive.
  - Comments: a line whose FIRST non-whitespace character is ';' or '#' is
    a comment and is ignored. A '#' or ';' INSIDE a value is part of the
    value, not a comment.
  - Only the FIRST '=' on a line splits key from value. So
    \`expr=a=b=c\` parses to key='expr', value='a=b=c'.
  - Empty value (\`key=\`) is allowed and yields the empty string.
  - Double-quoted values: if the value (after trimming) is wrapped in
    MATCHING double quotes (both leading and trailing), strip the outer
    quotes and use the inner string verbatim, including any internal
    whitespace (do not interpret escapes). An UNMATCHED single quote
    (only one of the two ends present) is preserved as part of the value.
  - Duplicate keys within the same section: the LATER assignment wins.
  - Section reentry: if a section header repeats, subsequent keys merge
    into that section's existing object (still applying "later wins").
  - A section header is a line whose trimmed content matches exactly
    \`[ ... ]\` with the brackets at the start and end. A line like
    \`[main]junk\` is NOT a section header (the trailing 'junk' disqualifies
    it); silently ignore such lines.
  - Lines that are not blank, not comments, not section headers, and
    contain no '=' must be silently ignored (do not throw).
  - Accept both '\\n' and '\\r\\n' line endings.

All values returned are strings. Do not coerce numbers or booleans.

Then ensure \`node verify.js\` exits 0. Do not edit verify.js.`;

const CLAW_TIMEOUT = 285_000;

describe(`ini-parser: line-by-line config parser with section reentry (tier=${TIER_LABEL})`, () => {
  it('claw solves the task', { timeout: CLAW_TIMEOUT + 20_000 }, async () => {
    const ctx = await runAgentSetup({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      timeoutMs:  CLAW_TIMEOUT,
      testId:  'ini-parser',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('verify.js', VERIFY_JS);
    });
  });
});
