// __tests__/lib/tier-table.contract.test.js — #016 single tier table.
//
// The tier IDENTITY map (tier → port / opencode config json / launchd label /
// log tag) lives in ONE file: host/llama-server/tiers.conf. The JS side
// (lib/config.js parseTiersConf / tierTable, consumed by
// lib/opencode_server_timings.js defaultServerLogPath) must derive from that
// same file — these tests pin:
//
//   1. the parser against the conf's documented FORMAT CONTRACT (hermetic —
//      inline fixture text, no file access);
//   2. the embedded FALLBACK_TIER_TABLE's shape invariants (hermetic);
//   3. defaultServerLogPath deriving from the table, not private literals
//      (hermetic — the historical per-tier paths are pinned separately in
//      opencode-server-timings.test.js, which doubles as a fallback drift pin);
//   4. THE DRIFT GATE: wherever the real conf is readable (host node, the
//      path-matched eval-runner mount — every live seat), the parsed conf must
//      deep-equal FALLBACK_TIER_TABLE. In the baked test image the conf is
//      deliberately not mounted, so the gate clause no-ops there; the live
//      cross-check is scripts/check-tier-table.sh (host side), which runs this
//      same comparison plus every bash consumer. Doctoring tiers.conf (or
//      pointing OPENCODE_TIERS_CONF at a doctored copy) fails this test in any
//      conf-visible context — that is the #016 "cannot disagree" mechanism.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTiersConf,
  loadTierTable,
  tierTable,
  FALLBACK_TIER_TABLE,
  TIERS_CONF_DEFAULT_PATH,
} from '../../lib/config.js';
import { defaultServerLogPath } from '../../lib/opencode_server_timings.js';

describe('parseTiersConf — tiers.conf FORMAT CONTRACT (#016)', () => {
  const FIXTURE = [
    '# comment line',
    'TIERS_ALL="7 8"',
    'TIER_DEFAULT=7',
    'OPENCODE_LOG_BASE="/tmp/fixture-llama"',
    '',
    'TIER_7_PORT=1234',
    'TIER_7_OPENCODE_CONFIG="oc.7.json"',
    'TIER_7_LAUNCHD_LABEL="com.example.seven"',
    'TIER_7_LOG_TAG=""',
    'TIER_7_ALIAS="seven"',
    'TIER_7_TEMPLATE="seven.jinja"',
    'TIER_8_PORT=5678',
    'TIER_8_OPENCODE_CONFIG=oc.8.json', // unquoted form also legal
    'TIER_8_LAUNCHD_LABEL="-"',
    'TIER_8_LOG_TAG="-8"',
    'TIER_8_ALIAS=eight',
    'TIER_8_TEMPLATE="eight.jinja"',
    'tier_resolve() {',
    '  eval "TIER_PORT=\\"\\${TIER_$1_PORT}\\""', // indented fn body: ignored
    '  TIER_LOG_PATH="${OPENCODE_LOG_BASE}${TIER_LOG_TAG}.log"',
    '}',
  ].join('\n');

  it('parses column-1 KEY=VALUE rows, strips one quote pair, ignores the fn body', () => {
    const t = parseTiersConf(FIXTURE);
    assert.deepEqual(t, {
      default: '7',
      log_base: '/tmp/fixture-llama',
      tiers: {
        '7': {
          port: 1234,
          opencode_config: 'oc.7.json',
          launchd_label: 'com.example.seven',
          log_tag: '',
          alias: 'seven',
          template: 'seven.jinja',
          log_path: '/tmp/fixture-llama.log',
        },
        '8': {
          port: 5678,
          opencode_config: 'oc.8.json',
          launchd_label: '-', // "-" kept verbatim: consumers map it to "none"
          log_tag: '-8',
          alias: 'eight',
          template: 'eight.jinja',
          log_path: '/tmp/fixture-llama-8.log',
        },
      },
    });
  });

  it('throws on a structurally broken table (fail loud, never half-resolve)', () => {
    assert.throws(() => parseTiersConf('# empty\n'), /TIERS_ALL missing/);
    assert.throws(
      () => parseTiersConf('TIERS_ALL="64"\nTIER_DEFAULT=64\n'),
      /TIER_64_PORT is missing/,
    );
  });

  it('loadTierTable({ text }) parses injected text; unreadable path → null', () => {
    assert.equal(loadTierTable({ text: FIXTURE }).tiers['8'].port, 5678);
    assert.equal(loadTierTable({ path: '/nonexistent/tiers.conf' }), null);
  });
});

describe('FALLBACK_TIER_TABLE — embedded snapshot invariants (#016)', () => {
  it('carries exactly the lab tiers with distinct ports/configs/log paths', () => {
    const tiers = Object.keys(FALLBACK_TIER_TABLE.tiers).sort();
    assert.deepEqual(tiers, ['16', '32', '64']);
    assert.equal(FALLBACK_TIER_TABLE.default, '64');
    const ports = tiers.map((t) => FALLBACK_TIER_TABLE.tiers[t].port);
    assert.equal(new Set(ports).size, 3, 'tier ports must be distinct');
    const cfgs = tiers.map((t) => FALLBACK_TIER_TABLE.tiers[t].opencode_config);
    assert.equal(new Set(cfgs).size, 3, 'tier configs must be distinct');
    const logs = tiers.map((t) => FALLBACK_TIER_TABLE.tiers[t].log_path);
    assert.equal(new Set(logs).size, 3, 'tier log paths must be distinct');
  });

  it('tier-32 has no launchd path by design ("-"), 64/16 have labels', () => {
    assert.equal(FALLBACK_TIER_TABLE.tiers['32'].launchd_label, '-');
    assert.match(FALLBACK_TIER_TABLE.tiers['64'].launchd_label, /^com\./);
    assert.match(FALLBACK_TIER_TABLE.tiers['16'].launchd_label, /^com\./);
  });

  it('log paths compose as <log_base><log_tag>.log', () => {
    for (const t of Object.keys(FALLBACK_TIER_TABLE.tiers)) {
      const row = FALLBACK_TIER_TABLE.tiers[t];
      assert.equal(
        row.log_path,
        `${FALLBACK_TIER_TABLE.log_base}${row.log_tag}.log`,
        `tier ${t}`,
      );
    }
  });
});

describe('defaultServerLogPath derives from the tier table (#016)', () => {
  it('returns the table log_path for every tier; default row for unknowns', () => {
    const table = tierTable();
    for (const t of Object.keys(table.tiers)) {
      assert.equal(defaultServerLogPath(t, {}), table.tiers[t].log_path);
      assert.equal(defaultServerLogPath(Number(t), {}), table.tiers[t].log_path);
    }
    const defaultPath = table.tiers[String(table.default)].log_path;
    assert.equal(defaultServerLogPath(undefined, {}), defaultPath);
    assert.equal(defaultServerLogPath('99', {}), defaultPath);
  });

  it('OPENCODE_LLAMA_LOG still overrides VERBATIM (#007 contract unchanged)', () => {
    const env = { OPENCODE_LLAMA_LOG: '/var/log/opencode-llama-server.log' };
    assert.equal(defaultServerLogPath('32', env), '/var/log/opencode-llama-server.log');
  });
});

describe('tiers.conf ↔ JS drift gate (#016 AC3)', () => {
  it('parsed conf deep-equals FALLBACK_TIER_TABLE wherever the conf is readable', () => {
    const live = loadTierTable();
    if (live === null) {
      // Hermetic test image: host/llama-server is deliberately not mounted.
      // The gate is enforced on every conf-visible seat: host node runs,
      // path-matched runner mounts, and scripts/check-tier-table.sh.
      return;
    }
    assert.deepEqual(
      live,
      FALLBACK_TIER_TABLE,
      `tiers.conf (${process.env.OPENCODE_TIERS_CONF ?? TIERS_CONF_DEFAULT_PATH}) ` +
        'and lib/config.js FALLBACK_TIER_TABLE have drifted — update them together (#016)',
    );
  });
});
