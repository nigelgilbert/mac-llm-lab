/** @manifest
 * {
 *   "test_id": "twelve-file-refactor",
 *   "test_version": "v3",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": ["convergence"],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Drop if t16 pass rate ≥85% across two consecutive confirmatory sweeps. Companion to large-refactor (6 files); this extends to 12 files threading TWO parameters (currency + locale).",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": ["repo_size_dependent", "context_pressure_high"],
 *   "introduced_in": "1.21",
 *   "notes": "v3 cycle-19 — v2 still saturated at t16 in 20 iters: model read all 14 files, wrote a config-driven formatPrice in one shot, took one debug iter to fix float precision in the fractional part (Math.round). Round-trip alone wasn't enough friction. v3 splits fraction-digit count off the locale and into a NEW currency-config.js (CURRENCIES map: USD/EUR/GBP/CHF/CAD/AUD = 2, JPY/KRW = 0, BHD/KWD = 3). format-parse.js does a two-step parse: extract the [A-Z]{3} currency at the locale's known position, look up CURRENCIES[ccy].fractionDigits, then build the per-currency amount regex. test.js now exercises a 0-decimal currency (JPY in receipt) and a 3-decimal currency (BHD in summary) — so a hardcoded toFixed(2) can no longer round-trip. Same 12 source files; workspace adds format-config.js + format-parse.js + currency-config.js (3 verifier-owned files, total 15). Allowed edits exclude all three verifier files."
 * }
 */

// What:  Refactor formatPrice across 12 source files (7 call sites threading
//        amount/currency/locale) so every formatted string round-trips
//        through parsePrice in format-parse.js. Locale presentation rules
//        live in format-config.js; per-currency fraction-digit counts live
//        in currency-config.js (JPY/KRW=0, USD/EUR/GBP/CHF/CAD/AUD=2,
//        BHD/KWD=3). Both configs are verifier-owned — the model cannot
//        edit them.
//
// Why:   Weak monotonic tier discriminator, debug-capacity class (c21 N=3:
//        t16 2/3, t64 3/3). Two earlier versions saturated cleanly:
//          - v1 (c1, c2): one-shot formatPrice; fully saturated.
//          - v2 (c18): round-trip invariant added; still saturated 20 iters
//            because the model could infer locale rules from worked examples.
//        v3 defeats that by splitting fraction-digits off the locale and
//        into a separate currency-config.js with non-2-decimal currencies
//        (JPY, BHD) actually exercised. A hardcoded toFixed(2) no longer
//        round-trips; the model must read AND merge two configs. The c19
//        defeat path was iter-storm + claw error at t16 (4 format.js
//        rewrites). Primary axis: multi_file_context. Lineage and saturation
//        story live in difficulty-pack/memos/twelve-file-refactor-v2-v3-redesign.md;
//        c21 evidence in good-tests.md row 3.

import { describe, it } from 'node:test';

import assert from 'node:assert/strict';
import { runAgent } from '../../lib/runAgent.js';
import { TIER_LABEL } from '../../lib/tier.js';

// formatPrice — formats an amount. Currency and locale are currently hardcoded.
// Refactor target: take (amount, currency, locale) and emit a string that
// round-trips through parsePrice (in format-parse.js). Locale rules live in
// format-config.js as data — not in this comment, not in the prompt, not in
// the test assertions.
const FORMAT_JS = `\
export function formatPrice(amount) {
  return 'USD ' + amount.toFixed(2);
}
`;

// format-config.js — locale rules (presentation: decimal char, thousands
// char, currency position, separator, negative sign). The fraction-digit
// count is NOT here — it's per-currency, defined in currency-config.js.
const FORMAT_CONFIG_JS = `\
// Per-locale presentation rules. Fraction-digit count is defined per
// currency in currency-config.js — formatPrice and parsePrice both have to
// merge the two configs.
//
// Fields:
//   decimal           character separating integer from fraction digits
//                     (only emitted when fractionDigits > 0)
//   thousands         character grouping every 3 integer digits ('' = none)
//   currencyPosition  'prefix' | 'suffix' relative to the amount text
//   sep               literal character placed between amount and currency code
//   negativeSign      '-' placed immediately before the first digit/group
//                     (parenthesized accounting style is NOT used)
export const LOCALES = {
  en: {
    decimal: '.',
    thousands: '',
    currencyPosition: 'prefix',
    sep: ' ',
    negativeSign: '-',
  },
  de: {
    decimal: ',',
    thousands: '.',
    currencyPosition: 'suffix',
    sep: ' ',
    negativeSign: '-',
  },
};
`;

// currency-config.js — per-currency fraction-digit count. Real-world ISO 4217
// minor-unit conventions: most currencies use 2; JPY/KRW use 0; BHD/KWD use 3.
// formatPrice MUST consult this map (not hardcode toFixed(2)).
const CURRENCY_CONFIG_JS = `\
// ISO-4217-style minor-unit counts used by formatPrice and parsePrice.
// fractionDigits === 0 means: no decimal separator is emitted at all.
export const CURRENCIES = {
  USD: { fractionDigits: 2 },
  EUR: { fractionDigits: 2 },
  GBP: { fractionDigits: 2 },
  CHF: { fractionDigits: 2 },
  CAD: { fractionDigits: 2 },
  AUD: { fractionDigits: 2 },
  JPY: { fractionDigits: 0 },
  KRW: { fractionDigits: 0 },
  BHD: { fractionDigits: 3 },
  KWD: { fractionDigits: 3 },
};
`;

// format-parse.js — strict, two-step parser. Step 1 extracts the [A-Z]{3}
// currency code at the locale's known position (prefix/suffix). Step 2 looks
// up CURRENCIES[ccy].fractionDigits and validates the amount text against a
// per-currency-aware regex. fractionDigits === 0 means: NO decimal separator
// at all — just a signed integer.
const FORMAT_PARSE_JS = `\
import { LOCALES }    from './format-config.js';
import { CURRENCIES } from './currency-config.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}

// parsePrice(s, locale) → { amount: number, currency: string } | null
//
// Strict: anchored ^...$, no leading/trailing chars tolerated. Two-step:
//   1. peel the [A-Z]{3} currency code at the locale's currencyPosition.
//   2. look up CURRENCIES[ccy].fractionDigits → build the precise amount
//      regex (with or without a decimal sub-pattern) and match.
export function parsePrice(s, locale) {
  const cfg = LOCALES[locale];
  if (!cfg) throw new Error('unknown locale: ' + locale);
  if (typeof s !== 'string') return null;

  const sep = escapeRegex(cfg.sep);
  const ccyHead = cfg.currencyPosition === 'prefix'
    ? new RegExp('^([A-Z]{3})' + sep + '(.*)$')
    : new RegExp('^(.*)' + sep + '([A-Z]{3})$');
  const headM = s.match(ccyHead);
  if (!headM) return null;
  const [currency, amtText] = cfg.currencyPosition === 'prefix'
    ? [headM[1], headM[2]]
    : [headM[2], headM[1]];

  const ccyCfg = CURRENCIES[currency];
  if (!ccyCfg) return null;

  const dec  = escapeRegex(cfg.decimal);
  const thou = cfg.thousands ? escapeRegex(cfg.thousands) : '';
  const intPart = thou
    ? '\\\\d{1,3}(?:' + thou + '\\\\d{3})*'
    : '\\\\d+';
  const fracPart = ccyCfg.fractionDigits > 0
    ? dec + '\\\\d{' + ccyCfg.fractionDigits + '}'
    : '';
  const amtRe = new RegExp('^-?' + intPart + fracPart + '$');
  if (!amtRe.test(amtText)) return null;

  let normalized = amtText;
  if (cfg.thousands)        normalized = normalized.split(cfg.thousands).join('');
  if (cfg.decimal !== '.')  normalized = normalized.replace(cfg.decimal, '.');
  const amountN = Number(normalized);
  if (!Number.isFinite(amountN)) return null;
  return { amount: amountN, currency };
}
`;

const CART_JS = `\
import { formatPrice } from './format.js';

export class Cart {
  constructor(currency, locale) {
    this.currency = currency;
    this.locale = locale;
    this.items = [];
  }
  add(item) { this.items.push(item); }
  total() {
    const amt = this.items.reduce((s, i) => s + i.price, 0);
    return formatPrice(amt);
  }
}
`;

const RECEIPT_JS = `\
import { formatPrice } from './format.js';

export function receipt(items, currency, locale) {
  return items.map(i => i.name + ': ' + formatPrice(i.price)).join('\\n');
}
`;

const REPORT_JS = `\
import { formatPrice } from './format.js';

const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_LOCALE = 'de';

export function report(amount) {
  return 'Total: ' + formatPrice(amount);
}
`;

const INVOICE_JS = `\
import { formatPrice } from './format.js';

export class Invoice {
  constructor(config) {
    // config = { currency, locale }
    this.config = config;
    this.lines = [];
  }
  addLine(line) { this.lines.push(line); }
  render() {
    const total = this.lines.reduce((s, l) => s + l.amount, 0);
    return 'INVOICE: ' + formatPrice(total);
  }
}
`;

const AUDIT_JS = `\
import { formatPrice } from './format.js';

// logFinancial returns a string for an audit log row.
// record shape: { amount, currency, locale, kind }
export function logFinancial(record) {
  return record.kind + '|' + formatPrice(record.amount);
}
`;

const SUMMARY_JS = `\
import { formatPrice } from './format.js';

// summaryRow takes an items array and an options bag.
// opts = { currency, locale }
export function summaryRow(items, opts) {
  const total = items.reduce((s, i) => s + i.price, 0);
  return formatPrice(total);
}
`;

const TAXES_JS = `\
import { formatPrice } from './format.js';

// taxLine prints a tax line for a jurisdiction.
// jurisdiction = { name, rate, currency, locale }
export function taxLine(amount, jurisdiction) {
  const tax = amount * jurisdiction.rate;
  return jurisdiction.name + ' tax: ' + formatPrice(tax);
}
`;

const NOTIFY_JS = `\
// notify.js — utility module. Does NOT import format directly. Distractor.
export function notify(channel, message) {
  return '[' + channel + '] ' + message;
}
`;

const HELPER_JS = `\
// helper.js — math utilities. Distractor for the refactor (no formatPrice).
export const round2 = (x) => Math.round(x * 100) / 100;
export const sumByKey = (arr, key) => arr.reduce((s, x) => s + x[key], 0);
`;

const CONSTANTS_JS = `\
// constants.js — currency code lookups. Distractor (no formatPrice).
export const CCY_NAMES = { USD: 'US Dollar', EUR: 'Euro', GBP: 'Pound', JPY: 'Yen' };
export const LOCALE_NAMES = { en: 'English', de: 'German', fr: 'French' };
`;

// test.js is the round-trip verifier. It does NOT contain literal expected
// price strings; it imports the canonical strict parser from format-parse.js
// and asserts parsePrice(formatPrice(amount, currency, locale), locale)
// returns { amount, currency } for every call site. Per-call-site wrappers
// ('Total: ', 'INVOICE: ', 'PAY|', 'CA tax: ', 'name: ') are still asserted
// structurally so the model can't smuggle the format through the wrapper.
const TEST_JS = `\
import assert from 'node:assert/strict';
import { Cart }         from './cart.js';
import { receipt }      from './receipt.js';
import { report }       from './report.js';
import { Invoice }      from './invoice.js';
import { logFinancial } from './audit.js';
import { summaryRow }   from './summary.js';
import { taxLine }      from './taxes.js';
import { parsePrice }   from './format-parse.js';

function approx(a, b) { return Math.abs(a - b) < 1e-9; }

function expectFmt(out, expectedAmount, expectedCcy, locale, label) {
  const p = parsePrice(out, locale);
  assert.ok(p !== null, label + ': parsePrice rejected ' + JSON.stringify(out));
  assert.equal(p.currency, expectedCcy,
    label + ': currency ' + p.currency + ' != ' + expectedCcy);
  assert.ok(approx(p.amount, expectedAmount),
    label + ': amount ' + p.amount + ' != ' + expectedAmount);
}

// Cart — uses this.currency + this.locale.
{
  const c = new Cart('GBP', 'en');
  c.add({ name: 'a', price: 10 });
  c.add({ name: 'b', price: 5.5 });
  expectFmt(c.total(), 15.5, 'GBP', 'en', 'cart en');
}

// receipt — passes currency + locale; joins per-line "<name>: <formatted>".
// JPY has 0 fraction digits per currency-config — outputs are bare integers.
{
  const r = receipt([{ name: 'x', price: 3 }, { name: 'y', price: 4 }], 'JPY', 'de');
  const lines = r.split('\\n');
  assert.equal(lines.length, 2, 'receipt: 2 lines');
  assert.ok(lines[0].startsWith('x: '), 'receipt: line 0 prefix');
  assert.ok(lines[1].startsWith('y: '), 'receipt: line 1 prefix');
  expectFmt(lines[0].slice('x: '.length), 3, 'JPY', 'de', 'receipt de jpy line 0');
  expectFmt(lines[1].slice('y: '.length), 4, 'JPY', 'de', 'receipt de jpy line 1');
}

// report — uses module-level DEFAULT_CURRENCY=EUR, DEFAULT_LOCALE=de.
{
  const out = report(99);
  const PREFIX = 'Total: ';
  assert.ok(out.startsWith(PREFIX), 'report: prefix preserved');
  expectFmt(out.slice(PREFIX.length), 99, 'EUR', 'de', 'report (module defaults)');
}

// Invoice — uses this.config.currency + this.config.locale.
{
  const inv = new Invoice({ currency: 'USD', locale: 'en' });
  inv.addLine({ amount: 100 });
  inv.addLine({ amount: 50 });
  const out = inv.render();
  const PREFIX = 'INVOICE: ';
  assert.ok(out.startsWith(PREFIX), 'invoice: prefix preserved');
  expectFmt(out.slice(PREFIX.length), 150, 'USD', 'en', 'invoice');
}

// audit — uses record.currency + record.locale.
{
  const log = logFinancial({ amount: 42, currency: 'CHF', locale: 'de', kind: 'PAY' });
  const PREFIX = 'PAY|';
  assert.ok(log.startsWith(PREFIX), 'audit: prefix preserved');
  expectFmt(log.slice(PREFIX.length), 42, 'CHF', 'de', 'audit');
}

// summary — uses opts.currency + opts.locale. BHD has 3 fraction digits per
// currency-config, so the formatter must respect per-currency decimal counts.
{
  const sum = summaryRow([{ price: 1.234 }, { price: 2.345 }], { currency: 'BHD', locale: 'en' });
  expectFmt(sum, 1.234 + 2.345, 'BHD', 'en', 'summary BHD (3 fraction digits)');
}

// taxes — uses jurisdiction.currency + jurisdiction.locale.
{
  const tx = taxLine(200, { name: 'CA', rate: 0.10, currency: 'CAD', locale: 'en' });
  const PREFIX = 'CA tax: ';
  assert.ok(tx.startsWith(PREFIX), 'taxes: prefix preserved');
  expectFmt(tx.slice(PREFIX.length), 20, 'CAD', 'en', 'taxes');
}

// Thousands grouping: 4-digit amount in de must be grouped per format-config.
{
  const big = receipt([{ name: 'big', price: 1234.5 }], 'EUR', 'de');
  expectFmt(big.slice('big: '.length), 1234.5, 'EUR', 'de', 'receipt de big (4-digit)');
}
// Thousands grouping: 5-digit amount in en must NOT be grouped per format-config.
{
  const bigEn = new Cart('USD', 'en');
  bigEn.add({ name: 'p', price: 12345.67 });
  expectFmt(bigEn.total(), 12345.67, 'USD', 'en', 'cart en big (5-digit)');
}

// Negative amounts.
{
  const negEn = logFinancial({ amount: -42.5, currency: 'USD', locale: 'en', kind: 'REFUND' });
  assert.ok(negEn.startsWith('REFUND|'), 'audit negative en: prefix preserved');
  expectFmt(negEn.slice('REFUND|'.length), -42.5, 'USD', 'en', 'audit negative en');
}
{
  const negDe = logFinancial({ amount: -1234.5, currency: 'EUR', locale: 'de', kind: 'REFUND' });
  assert.ok(negDe.startsWith('REFUND|'), 'audit negative de: prefix preserved');
  expectFmt(negDe.slice('REFUND|'.length), -1234.5, 'EUR', 'de', 'audit negative de');
}

// Multi-thousands grouping (de): 7-digit amount must be grouped every 3 digits.
{
  const huge = receipt([{ name: 'm', price: 1234567.89 }], 'EUR', 'de');
  expectFmt(huge.slice('m: '.length), 1234567.89, 'EUR', 'de', 'receipt de huge (7-digit)');
}

// Thousands grouping × 0 fraction digits (KRW in de): no decimal at all,
// just a grouped integer. Forces the formatter to suppress the decimal
// separator (and the trailing fraction) when CURRENCIES[ccy].fractionDigits
// === 0.
{
  const huge = receipt([{ name: 'k', price: 1234567 }], 'KRW', 'de');
  expectFmt(huge.slice('k: '.length), 1234567, 'KRW', 'de', 'receipt de KRW (0 dec, grouped)');
}
`;

const PROMPT = `\
This workspace contains 15 files. The function \`formatPrice\` in format.js
currently hardcodes the currency to "USD" and the locale to a period decimal.

Refactor \`formatPrice(amount, currency, locale)\` so that its output
round-trips through the canonical strict parser \`parsePrice\` exported by
format-parse.js. For every (amount, currency, locale) the test asserts:

    parsePrice(formatPrice(amount, currency, locale), locale)
        gives back { amount, currency }

Two configuration files together define the format — read both before
implementing:

  - format-config.js     per-locale presentation rules (decimal char,
                         thousands char, currency position, sep char,
                         negative-sign placement)
  - currency-config.js   per-currency fraction-digit count
                         (some currencies use 0, some 2, some 3)

The fraction-digit count comes from the CURRENCY, not the locale. When a
currency has fractionDigits === 0, your output must contain NO decimal
separator at all (just a signed integer with locale-appropriate thousands
grouping). The parser is strict: anchored ^...$, exact whitespace, exact
fraction-digit count per currency, [A-Z]{3} currency code, locale-correct
thousands grouping — any deviation returns null and the assertion fails.

Your formatter must handle:
  - integer and fractional amounts of arbitrary integer-digit length
  - negative amounts (sign immediately before the first digit/group)
  - locales 'en' and 'de'
  - currencies passed as 3-letter ISO codes (USD, EUR, GBP, JPY, KRW,
    BHD, KWD, …; already uppercase)

Then update every caller so it threads BOTH \`currency\` and \`locale\`
through to formatPrice. Each caller obtains them from its own idiomatic
source — read each file to find out where the values come from:
  - cart.js:    Cart instance fields (this.currency, this.locale)
  - receipt.js: function parameters
  - report.js:  module-level constants DEFAULT_CURRENCY, DEFAULT_LOCALE
  - invoice.js: this.config.currency, this.config.locale
  - audit.js:   record.currency, record.locale (the parameter is the record)
  - summary.js: opts.currency, opts.locale (options-bag pattern)
  - taxes.js:   jurisdiction.currency, jurisdiction.locale

After your edits, running \`node test.js\` must exit 0. Do not edit
test.js, format-config.js, currency-config.js, or format-parse.js.

Files notify.js, helper.js, and constants.js are distractors that do NOT
call formatPrice — leave them alone.`;

const CLAW_TIMEOUT = 285_000;

describe(`twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=${TIER_LABEL})`, () => {
  it('claw threads two parameters through every caller', { timeout: CLAW_TIMEOUT + 20_000 }, async (t) => {
    const ctx = await runAgent({
      prompt:               PROMPT,
      seedFiles:            {
        'format.js':          FORMAT_JS,
        'format-config.js':   FORMAT_CONFIG_JS,
        'currency-config.js': CURRENCY_CONFIG_JS,
        'format-parse.js':    FORMAT_PARSE_JS,
        'cart.js':            CART_JS,
        'receipt.js':         RECEIPT_JS,
        'report.js':          REPORT_JS,
        'invoice.js':         INVOICE_JS,
        'audit.js':           AUDIT_JS,
        'summary.js':         SUMMARY_JS,
        'taxes.js':           TAXES_JS,
        'notify.js':          NOTIFY_JS,
        'helper.js':          HELPER_JS,
        'constants.js':       CONSTANTS_JS,
        'test.js':            TEST_JS,
      },
      preconditionMustFail: 'test.js',
      postScript:           'test.js',
      testId:            'twelve-file-refactor',
      t,
    });
    assert.equal(ctx.agent.code, 0, 'agent must exit cleanly');
    ctx.workspace.unchanged('test.js', TEST_JS);
    ctx.workspace.unchanged('format-config.js', FORMAT_CONFIG_JS);
    ctx.workspace.unchanged('currency-config.js', CURRENCY_CONFIG_JS);
    ctx.workspace.unchanged('format-parse.js', FORMAT_PARSE_JS);
    ctx.workspace.unchanged('notify.js', NOTIFY_JS);
    ctx.workspace.unchanged('helper.js', HELPER_JS);
    ctx.workspace.unchanged('constants.js', CONSTANTS_JS);
    if (ctx.post) assert.equal(
      ctx.post.status, 0,
      `post-script failed:\n${ctx.post.stderr.slice(0, 800)}`,
    );
  });
});
