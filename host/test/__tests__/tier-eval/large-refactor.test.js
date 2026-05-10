// Large refactor: thread a new parameter through 5 call sites across 6 files.
//
// Difficulty knob: a single API change must cascade through an import graph.
// `formatPrice(amount)` becomes `formatPrice(amount, currency)`. Every caller
// must pass a currency. Some callers receive currency as a parameter
// themselves; others have it on `this`; one reads it from a constant. A
// model that just edits the definition leaves the codebase broken in 5
// places at once.
//
// Target: hard (saturated tier-64 ceiling probe).

/** @manifest
 * {
 *   "test_id": "large-refactor",
 *   "test_version": "v1",
 *   "primary_axis": "multi_file_context",
 *   "secondary_axes": [
 *     "convergence"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc \u00a72.1).",
 *   "expected_tier_signature": "monotonic_improving",
 *   "known_confounds": [
 *     "repo_size_dependent"
 *   ]
 * }
 */

import { describe, it } from 'node:test';

import { runAgentSetup } from '../../lib/runTest.js';
import { TIER_LABEL } from '../../lib/tier.js';

const FORMAT_JS = `\
// formatPrice — formats an amount. Currently currency is hardcoded to USD.
export function formatPrice(amount) {
  return '$' + amount.toFixed(2);
}
`;

const CART_JS = `\
import { formatPrice } from './format.js';

export class Cart {
  constructor(currency) {
    this.currency = currency;
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

export function receipt(items, currency) {
  return items.map(i => i.name + ': ' + formatPrice(i.price)).join('\\n');
}
`;

const REPORT_JS = `\
import { formatPrice } from './format.js';

const DEFAULT_CURRENCY = 'EUR';

export function report(amount) {
  return 'Total: ' + formatPrice(amount);
}
`;

const TEST_JS = `\
import assert from 'node:assert/strict';
import { Cart }    from './cart.js';
import { receipt } from './receipt.js';
import { report }  from './report.js';

const c = new Cart('GBP');
c.add({ name: 'a', price: 10 });
c.add({ name: 'b', price: 5.5 });
assert.equal(c.total(), 'GBP 15.50', 'cart total uses cart currency');

const r = receipt([{name:'x', price:3}, {name:'y', price:4.25}], 'JPY');
assert.equal(r, 'x: JPY 3.00\\ny: JPY 4.25', 'receipt uses passed currency');

assert.equal(report(99), 'Total: EUR 99.00', 'report uses module default currency EUR');
`;

const PROMPT =
  'Refactor format.js so that `formatPrice` takes a second parameter ' +
  '`currency` and returns the currency code followed by a space and the ' +
  'amount with two decimals (e.g. formatPrice(15.5, "GBP") → "GBP 15.50"). ' +
  'Then update every caller in cart.js, receipt.js, and report.js so they ' +
  'pass the appropriate currency: cart.js should use this.currency, ' +
  'receipt.js should use its `currency` parameter, and report.js should ' +
  'use the existing DEFAULT_CURRENCY constant. After your edits, running ' +
  '`node test.js` must exit 0. Do not edit test.js.';

const CLAW_TIMEOUT = 240_000;
const TIMEOUT = CLAW_TIMEOUT + 60_000;

describe(`large-refactor: thread currency through 5 call sites (tier=${TIER_LABEL})`, () => {
  it('claw threads the new parameter through every caller', { timeout: TIMEOUT }, async () => {
    const ctx = await runAgentSetup({
      prompt:               PROMPT,
      seedFiles:            { 'format.js': FORMAT_JS, 'cart.js': CART_JS, 'receipt.js': RECEIPT_JS, 'report.js': REPORT_JS, 'test.js': TEST_JS },
      preconditionMustFail: 'test.js',
      postScript:           'test.js',
      timeoutMs:            CLAW_TIMEOUT,
      testId:            'large-refactor',
    });
    await ctx.finish(() => {
      ctx.workspace.unchanged('test.js', TEST_JS);
    });
  });
});
