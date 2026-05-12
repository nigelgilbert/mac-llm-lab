// Prose quality — TWO sub-suites:
//
//   1. Raw bridge (assertive). Hits the bridge directly via streamMessage()
//      and counts newlines/bullets in the streamed text. This isolates model
//      behavior from claw's terminal renderer. If the model emits structured
//      markdown, this passes; if it doesn't, we have a real model regression.
//
//   2. Through claw (informational only). Same prompt, but invoked via
//      runClaw() and counted on the rendered stdout. Reliably under-counts
//      newlines because claw's markdown renderer strips header markers
//      (`## `) without preserving the trailing `\n`. Kept for visibility —
//      shows what the user actually sees — but no longer asserts.
//
// Why split: prior eval rounds chased sampler/grammar fixes for a smush
// that reproduces only through claw's renderer (verified via comment in
// host/test/__tests__/backend-ab/eval-c-prose.test.js — same prompt, same
// sampler, same system prompt: smushes via claw, doesn't via raw bridge).
// The model-side fix has already happened (repeat-penalty 1.05); what's
// left is a renderer issue claw owns.
//
// Reference: host/llama-server/docs/TODO-PROSE-SMUSH.md,
//            host/test/docs/MODEL-AB-RESULTS.md.

/** @manifest
 * {
 *   "test_id": "prose-quality",
 *   "test_version": "v1",
 *   "primary_axis": "productivity",
 *   "secondary_axes": [
 *     "local_usability"
 *   ],
 *   "suite_layer": "B",
 *   "difficulty_band": "easy",
 *   "oracle_type": "rubric",
 *   "keep_drop_rule": "Keep \u2014 sole existing productivity-axis signal until Sprint 3 lands judge-graded productivity tests. Rubric is deterministic newline/bullet counts.",
 *   "expected_tier_signature": "tier_insensitive",
 *   "known_confounds": [],
 *   "notes": "Productivity axis is otherwise unmeasured; revisit classification once Sprint 3 productivity families ship."
 * }
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { streamMessage } from '../../lib/bridge.js';
import { runClaw } from '../../lib/claw.js';
import { bridgeModel, clawModel, TIER_LABEL } from '../../lib/tier.js';

const PROMPT =
  'Write a short markdown explainer about React components. ' +
  'Use 2 headers (## style) and at least 4 bullet points. ' +
  'Aim for around 250 words. Do not call any tools, just respond with the markdown.';

const N            = Number(process.env.PROSE_N) || 3;
const TIMEOUT      = 300_000;
const MIN_TEXT_LEN = 600;
const MIN_NEWLINES = 5;
const MIN_BULLETS  = 3;

const ANSI_RE  = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

function countText(text) {
  const newlines = (text.match(/\n/g) ?? []).length;
  // Leading-bullet lines are the strongest smush signal: in smushed output
  // bullet chars exist but without a leading newline, this count drops to ~0.
  const bullets  = (text.match(/^[ \t]*[-*•]\s/gm) ?? []).length;
  return { newlines, bullets };
}

// ---- raw bridge — assertive ----
describe(`prose quality via raw bridge (tier=${TIER_LABEL})`, () => {
  it(
    `${N}× markdown via streamMessage: len ≥ ${MIN_TEXT_LEN}, newlines ≥ ${MIN_NEWLINES}, bullets ≥ ${MIN_BULLETS}`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const results = [];
      for (let i = 0; i < N; i++) {
        const t0 = Date.now();
        const r  = await streamMessage({
          model:     bridgeModel,
          messages:  [{ role: 'user', content: PROMPT }],
          maxTokens: 1024,
          requestTimeoutMs: 120_000,
        });
        const text = r.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('');
        const { newlines, bullets } = countText(text);
        results.push({
          elapsedMs: Date.now() - t0,
          stopReason: r.stopReason,
          textLen: text.length,
          newlines,
          bullets,
          text,
        });
      }

      console.log(`\n=== prose-quality:bridge (${TIER_LABEL}) ===`);
      results.forEach((r, i) => {
        console.log(`  [${i + 1}/${N}] stop=${r.stopReason} ${r.elapsedMs}ms textLen=${r.textLen} newlines=${r.newlines} bullets=${r.bullets}`);
      });
      console.log(`  sample[0] (first 320 chars, \\n literal):`);
      console.log(`    ${(results[0]?.text ?? '').slice(0, 320).replace(/\n/g, '\\n')}`);

      for (const [i, r] of results.entries()) {
        assert.ok(r.textLen >= MIN_TEXT_LEN,
          `[${i + 1}] response too short: textLen=${r.textLen} < ${MIN_TEXT_LEN}`);
        assert.ok(r.newlines >= MIN_NEWLINES,
          `[${i + 1}] model-side smush: ${r.newlines} newlines in ${r.textLen} chars (sampler/template issue, not renderer)`);
        assert.ok(r.bullets >= MIN_BULLETS,
          `[${i + 1}] missing bullet structure: ${r.bullets} bullet-lines`);
      }
    },
  );
});

// ---- through claw — informational ----
describe(`prose quality via claw renderer (tier=${TIER_LABEL}, informational)`, () => {
  it(
    `${N}× markdown via claw: counts reported, no assertions`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const results = [];
      for (let i = 0; i < N; i++) {
        const r     = await runClaw({ prompt: PROMPT, model: clawModel, signal});
        const clean = stripAnsi(r.stdout);
        const { newlines, bullets } = countText(clean);
        results.push({ code: r.code, elapsedMs: r.elapsedMs, rawLen: r.stdout.length, cleanLen: clean.length, newlines, bullets, clean });
      }

      console.log(`\n=== prose-quality:claw-renderer (${TIER_LABEL}) ===`);
      results.forEach((r, i) => {
        console.log(`  [${i + 1}/${N}] exit=${r.code} ${r.elapsedMs}ms rawLen=${r.rawLen} cleanLen=${r.cleanLen} newlines=${r.newlines} bullets=${r.bullets}`);
      });
      console.log(`  sample[0] (first 320 chars, ANSI stripped, \\n literal):`);
      console.log(`    ${(results[0]?.clean ?? '').slice(0, 320).replace(/\n/g, '\\n')}`);
      console.log(`  (informational only — claw's renderer strips header markers without preserving \\n; see host/llama-server/docs/TODO-PROSE-SMUSH.md)`);
    },
  );
});
