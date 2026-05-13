// LRU cache with TTL, eviction callback, and peek.
//
// Difficulty knob: many concurrent invariants the model must maintain at
// once. The verify suite probes nine distinct behaviors. A model that hits
// 7/9 is "almost right" but fails. The behaviors interact: TTL and LRU
// eviction can both fire on the same get; peek must NOT bump recency; the
// eviction callback must fire on every removal path (capacity, TTL,
// explicit delete).
//
// Target: hard (frontier ceiling probe). Designed to differentiate
// "implements the obvious shape" from "tracks every spec bullet."

/** @manifest
 * {
 *   "test_id": "lru-cache",
 *   "test_version": "v1",
 *   "primary_axis": "stateful_logic",
 *   "secondary_axes": [
 *     "spec_precision"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "hard",
 *   "oracle_type": "public_verifier",
 *   "keep_drop_rule": "Do not drop until tier-32 and tier-16 are measured (strategy doc §2.1).",
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
import { LRUCache } from './lru.js';

// (1) Basic set/get.
{
  const c = new LRUCache({ capacity: 3 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), 1, 'basic get');
  assert.equal(c.get('z'), undefined, 'missing returns undefined');
}

// (2) Capacity eviction is least-recently-USED, not least-recently-INSERTED.
{
  const c = new LRUCache({ capacity: 3 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.get('a');               // bump a
  c.set('d', 4);            // should evict b (LRU), not a
  assert.equal(c.get('a'), 1, 'a survives — was bumped');
  assert.equal(c.get('b'), undefined, 'b was evicted');
  assert.equal(c.get('c'), 3, 'c survives');
  assert.equal(c.get('d'), 4, 'd present');
}

// (3) set() on existing key updates value AND bumps recency.
{
  const c = new LRUCache({ capacity: 2 });
  c.set('a', 1); c.set('b', 2);
  c.set('a', 11);           // bump a
  c.set('c', 3);            // should evict b, not a
  assert.equal(c.get('a'), 11, 'updated value');
  assert.equal(c.get('b'), undefined, 'b evicted after a was bumped');
}

// (4) peek() does NOT bump recency.
{
  const c = new LRUCache({ capacity: 2 });
  c.set('a', 1); c.set('b', 2);
  c.peek('a');              // must NOT bump a
  c.set('c', 3);            // should evict a (still LRU)
  assert.equal(c.get('a'), undefined, 'peek did not protect a');
  assert.equal(c.get('b'), 2, 'b still there');
}

// (5) TTL: expired entries return undefined and are evicted.
{
  let now = 1000;
  const c = new LRUCache({ capacity: 5, ttlMs: 100, now: () => now });
  c.set('a', 1);
  now = 1050;
  assert.equal(c.get('a'), 1, 'still alive at 50ms');
  now = 1101;
  assert.equal(c.get('a'), undefined, 'expired at 101ms');
  // After expiry-on-get the entry must be gone (size goes back to 0).
  assert.equal(c.size(), 0, 'expired entry removed');
}

// (6) onEvict fires for capacity eviction, TTL eviction, and delete().
{
  let now = 1000;
  const evicted = [];
  const c = new LRUCache({
    capacity: 2,
    ttlMs:    100,
    now:      () => now,
    onEvict:  (k, v, reason) => evicted.push([k, v, reason]),
  });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);                                 // capacity-evicts a
  assert.deepEqual(evicted[0], ['a', 1, 'capacity'], 'capacity eviction reported');

  now = 1200;
  c.get('b');                                    // ttl-evicts b
  assert.deepEqual(evicted[1], ['b', 2, 'ttl'], 'ttl eviction reported');

  c.delete('c');                                 // explicit delete
  assert.deepEqual(evicted[2], ['c', 3, 'delete'], 'delete eviction reported');
}

// (7) delete() returns true if the key existed, false otherwise.
{
  const c = new LRUCache({ capacity: 2 });
  c.set('a', 1);
  assert.equal(c.delete('a'), true,  'delete returns true on hit');
  assert.equal(c.delete('a'), false, 'delete returns false on miss');
}

// (8) size() reflects current entry count, not capacity.
{
  const c = new LRUCache({ capacity: 5 });
  assert.equal(c.size(), 0, 'empty');
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.size(), 2, 'two entries');
}

// (9) Iteration order via keys() is most-recently-used FIRST.
{
  const c = new LRUCache({ capacity: 3 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.get('a'); // a is now MRU
  assert.deepEqual([...c.keys()], ['a', 'c', 'b'], 'MRU-first iteration');
}
`;

const PROMPT =
  'Create lru.js exporting a class `LRUCache`. The constructor takes an ' +
  'options object: { capacity, ttlMs?, now?, onEvict? }. Implement these ' +
  'methods and behaviors:\n' +
  '  - set(key, value): inserts or updates; updating bumps recency. When ' +
  'inserting beyond capacity, evict the least-recently-used entry.\n' +
  '  - get(key): returns the value and bumps recency. Returns undefined if ' +
  'missing OR if the entry is older than ttlMs (in which case the entry is ' +
  'also removed).\n' +
  '  - peek(key): same as get but does NOT bump recency. Still respects TTL ' +
  '(expired entry returns undefined and is removed).\n' +
  '  - delete(key): removes the entry. Returns true if the key existed, ' +
  'false otherwise.\n' +
  '  - size(): returns the current number of entries.\n' +
  '  - keys(): returns an iterator over keys in most-recently-used FIRST order.\n' +
  '  - When provided, onEvict(key, value, reason) is called for every ' +
  'removal. reason is one of "capacity", "ttl", or "delete".\n' +
  '  - When provided, `now` is a function returning the current time in ms; ' +
  'use it (not Date.now) for all TTL comparisons. Default to () => Date.now().\n' +
  '  - When ttlMs is omitted, entries never expire by time.\n' +
  'Then ensure `node verify.js` exits 0. Do not edit verify.js.';

const TIMEOUT = 240_000;

describe(`lru-cache: LRU + TTL + eviction callback (tier=${TIER_LABEL})`, () => {
  it('claw implements LRUCache satisfying every spec bullet', { timeout: TIMEOUT }, async (t) => {
    const ctx = await runAgent({
      prompt:     PROMPT,
      seedFiles:  { 'verify.js': VERIFY_JS },
      postScript: 'verify.js',
      clawTimeoutMs:    TIMEOUT,
      testId:  'lru-cache',
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
