// __tests__/lib/prompt-halves.contract.test.js — prompt-halves artifact pins
// (OPENCODE-PROMPT-HALVES-PREREG.md §2.2, signed off 2026-06-11; T11 wiring).
//
// The half arms (config_id opencode-a+prompt-h1 / -h2) plant
// host/llama-server/docs/system-prompt.h1.md / .h2.md as the git-committed
// AGENTS.md (lib/runAgent.js AGENTS_MD_SOURCE_BY_CONFIG). The prereg pins the
// halves BYTE-PRECISE: each is a verbatim line-subset of the parent
// system-prompt.md assembled exactly as `sed -n '1,7p'` (h1) and
// `sed -n '1,4p;8,10p'` (h2) — an adapted prompt would be a different,
// non-comparable treatment (OPENCODE-SIDECAR-PORT-HANDOFF.md §6.4). These
// tests pin:
//
//   1. (hermetic) the embedded PARENT_SNAPSHOT against the prereg's parent
//      pin, and each half ASSEMBLY (the exact sed line-subset of the
//      snapshot) against the prereg's half pins — enforced in EVERY seat,
//      including the baked test image;
//   2. (live drift gate) wherever the real artifacts are readable (host
//      node, the path-matched eval-runner mount — every live seat), the
//      committed parent must byte-equal the snapshot and each committed half
//      must byte-equal its assembly AND match its pinned sha256 + byte
//      count. The baked test image deliberately mounts only
//      host/test/{lib,scripts,__tests__}, so the live clause no-ops there —
//      the same artifact-outside-the-hermetic-image visibility pattern as
//      the tiers.conf drift gate (tier-table.contract.test.js, #016).
//
// Any change to system-prompt.md or the halves fails one of these pins —
// which is the point: the prereg is frozen, so a drift here is a protocol
// deviation and must be reported as such (prereg §9).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(HERE, '../../../llama-server/docs');

// The prereg §2.2 pins, embedded so they are enforced even where the
// artifacts are not mounted (the hermetic baked test image).
const PINS = {
  parent: {
    file: 'system-prompt.md',
    bytes: 1379,
    sha256: '84992e1c67accc9e7be857ae9efca622f4a868314d367b8099269f56abc1ef21',
  },
  h1: {
    file: 'system-prompt.h1.md',
    lines: [1, 2, 3, 4, 5, 6, 7], // sed -n '1,7p' — preamble+header+rules 1–3
    bytes: 740,
    sha256: 'cf7dafb075e68543c89ab9e9514f473066b8ad13190c95cabc11f5d401ab2585',
  },
  h2: {
    file: 'system-prompt.h2.md',
    lines: [1, 2, 3, 4, 8, 9, 10], // sed -n '1,4p;8,10p' — preamble+header+rules 4–6
    bytes: 802,
    sha256: 'cd3213d8847f7d7e88def206cd054310dcb79c74ca103ffea51ca1f1c47448d3',
  },
};

// Embedded byte-verbatim snapshot of the parent system-prompt.md (the
// FALLBACK_TIER_TABLE pattern): the hermetic half-assembly pins below derive
// from it, and the live drift gate asserts the committed parent still equals
// it. Itself pinned against PINS.parent first, so the snapshot cannot drift
// silently either.
const PARENT_SNAPSHOT = `You are an autonomous coding agent operating through structured tool calls.

# Tool-use discipline (applies regardless of any caller-supplied instructions above)

1. ONE tool call per response when only one operation is needed. Do not emit duplicate tool_call blocks for the same target. If the user asks for one file, write it once.
2. Trust tool results. After a tool returns a non-error result (e.g. "Wrote /path (N lines)" or {"type": "create"}), the operation is complete. Do NOT call the same tool again with the same arguments. Move on or end the turn.
3. When multiple distinct operations are needed (e.g. three different files), emit one tool_call per operation in a single response, and do NOT repeat them in any subsequent turn.
4. Never quote, echo, paraphrase, or describe the contents of the <available_tools> section in your visible response. Those definitions are reference material, not output.
5. After the user's request is satisfied, end with a brief confirmation (one or two sentences). Do not propose alternatives, do not retry.
6. ACT, do not narrate. If the user asks you to create, edit, or run something, emit the tool_call(s) immediately. Do not write "I'll create..." or "Let me start by..." as a substitute for the actual tool_call. Saying you will do something is not the same as doing it. The user sees only what the tools produce, not your plans.
`;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
function byteLen(text) {
  return Buffer.byteLength(text, 'utf8');
}

// `sed -n '<lines>p'` semantics on a newline-terminated file: each selected
// line is emitted with its trailing newline, in file order. The halves are
// DEFINED as exactly this assembly (prereg §2.2), so the test reimplements it
// rather than trusting any pre-assembled string.
function sedLineSubset(text, lineNums) {
  assert.ok(text.endsWith('\n'), 'parent must be newline-terminated for sed line assembly');
  const lines = text.split('\n').slice(0, -1);
  return lineNums.map((n) => `${lines[n - 1]}\n`).join('');
}

function readIfVisible(file) {
  try {
    return fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
  } catch {
    return null;
  }
}

describe('prompt halves — prereg §2.2 pins (hermetic, embedded snapshot)', () => {
  it('PARENT_SNAPSHOT matches the pinned parent (10 lines, 1379 bytes)', () => {
    assert.equal(byteLen(PARENT_SNAPSHOT), PINS.parent.bytes, 'parent byte count');
    assert.equal(sha256(PARENT_SNAPSHOT), PINS.parent.sha256, 'parent sha256');
    assert.equal(
      PARENT_SNAPSHOT.split('\n').length - 1, 10,
      'parent is 10 newline-terminated lines (prereg §2.2 structure)',
    );
  });

  for (const half of ['h1', 'h2']) {
    it(`${half} assembly (parent lines ${PINS[half].lines.join(',')}) matches its pinned sha256 + byte count`, () => {
      const assembled = sedLineSubset(PARENT_SNAPSHOT, PINS[half].lines);
      assert.equal(byteLen(assembled), PINS[half].bytes, `${half} byte count`);
      assert.equal(sha256(assembled), PINS[half].sha256, `${half} sha256`);
    });
  }

  it('scaffolding rule: lines 1–4 (preamble+header) open BOTH halves (prereg §2.2)', () => {
    const scaffold = sedLineSubset(PARENT_SNAPSHOT, [1, 2, 3, 4]);
    for (const half of ['h1', 'h2']) {
      const assembled = sedLineSubset(PARENT_SNAPSHOT, PINS[half].lines);
      assert.ok(assembled.startsWith(scaffold), `${half} starts with the shared scaffolding`);
    }
  });
});

describe('prompt halves — committed artifacts drift gate (live seats)', () => {
  it('committed parent + halves byte-match the snapshot/assembly + pins wherever readable', () => {
    const parent = readIfVisible(PINS.parent.file);
    if (parent === null) {
      // Hermetic test image: host/llama-server is deliberately not mounted.
      // The gate is enforced on every artifact-visible seat: host node runs
      // and the path-matched eval-runner mount (the hermetic pins above
      // still ran for real here).
      return;
    }
    assert.equal(
      parent, PARENT_SNAPSHOT,
      `${PINS.parent.file} and this test's PARENT_SNAPSHOT have drifted — the ` +
        'half pins derive from the prereg-pinned parent; a parent change is a ' +
        'protocol deviation (prereg §9) and must update prereg + halves + this test together',
    );
    for (const half of ['h1', 'h2']) {
      const committed = readIfVisible(PINS[half].file);
      assert.ok(
        committed !== null,
        `${PINS[half].file} is missing/unreadable while the parent is readable — ` +
          'the half artifacts are committed siblings of the parent (T11 wiring item 1)',
      );
      assert.equal(
        committed, sedLineSubset(parent, PINS[half].lines),
        `${PINS[half].file} is not the verbatim line-subset ${PINS[half].lines.join(',')} of the parent`,
      );
      assert.equal(byteLen(committed), PINS[half].bytes, `${PINS[half].file} byte count vs prereg pin`);
      assert.equal(sha256(committed), PINS[half].sha256, `${PINS[half].file} sha256 vs prereg pin`);
    }
  });
});
