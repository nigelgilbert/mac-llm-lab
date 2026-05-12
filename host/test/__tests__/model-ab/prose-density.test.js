// Prose density: does the model format structured markdown correctly through claw?
//
// This is the headline comparison test. The equivalent test in backend-ab/ is
// marked `it.skip` because qwen3-coder exhibits a markdown-smush bug where
// final-message text renders with bold/header markers intact but newlines
// stripped, collapsing structured output onto one run-on line.
//
// This version is NOT skipped. Running both models lets us determine whether
// the smush is model-specific (qwen3-coder only → qwen3.6 passes) or something
// deeper in the claw output pipeline (both fail). Either result is useful:
//
//   qwen3.6 passes, qwen3-coder fails → model swap fixes the smush; unblock
//     backend-ab/eval-c-prose.test.js after switching production model.
//   Both fail → bug is in claw's output rendering, not model-specific;
//     investigate claw's `with_output_style` builder or system prompt injection.
//   Both pass → regression fixed elsewhere; flip eval-c to `it` in backend-ab/.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw } from '../../lib/claw.js';
import { clawModel, MODEL_LABEL } from '../../lib/model.js';

const PROMPT =
  'Write a short markdown explainer about React components. ' +
  'Use 2 headers (## style) and at least 4 bullet points. ' +
  'Aim for around 250 words. Do not call any tools, just respond with the markdown.';

const N            = Number(process.env.PROSE_N) || 3;
const TIMEOUT      = 300_000;
const MIN_TEXT_LEN = 600;
const MIN_NEWLINES = 5;
const MIN_BULLETS  = 3;

// Strip ANSI escape sequences (claw colorizes headers and bullets) before
// counting structure markers. Newlines aren't ANSI-wrapped, so the newline
// count is taken from raw stdout.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

describe(`prose density via claw (model=${MODEL_LABEL}, bridge=${clawModel})`, () => {
  it(
    `${N}× markdown response: len ≥ ${MIN_TEXT_LEN}, newlines ≥ ${MIN_NEWLINES}, bullets ≥ ${MIN_BULLETS}`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const results = [];
      for (let i = 0; i < N; i++) {
        const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});
        const clean    = stripAnsi(r.stdout);
        const newlines = (r.stdout.match(/\n/g) ?? []).length;
        // Bullet at start of a line — the strongest smush signal. In smushed
        // output the bullet glyphs end up inline (no leading \n), so this count
        // drops to ~0 even if bullet characters exist in the body.
        const bullets  = (clean.match(/^[ \t]*[-*•]\s/gm) ?? []).length;
        results.push({
          code: r.code,
          elapsedMs: r.elapsedMs,
          rawLen: r.stdout.length,
          cleanLen: clean.length,
          newlines,
          bullets,
          stdout: r.stdout,
          clean,
        });
      }

      console.log(`\n=== prose-density via claw (${MODEL_LABEL}) ===`);
      results.forEach((r, i) => {
        console.log(`  [${i + 1}/${N}] exit=${r.code} ${r.elapsedMs}ms rawLen=${r.rawLen} cleanLen=${r.cleanLen} newlines=${r.newlines} bullets=${r.bullets}`);
      });
      const sample = stripAnsi(results[0]?.stdout ?? '').slice(0, 320);
      console.log(`  sample[0] (first 320, ANSI stripped, \\n shown literal):`);
      console.log(`    ${sample.replace(/\n/g, '\\n')}`);

      for (const [i, r] of results.entries()) {
        assert.equal(r.code, 0, `[${i + 1}] claw exited non-zero`);
        assert.ok(r.cleanLen >= MIN_TEXT_LEN,
          `[${i + 1}] response too short: cleanLen=${r.cleanLen} < ${MIN_TEXT_LEN}`);
        assert.ok(r.newlines >= MIN_NEWLINES,
          `[${i + 1}] markdown smush: ${r.newlines} newlines in ${r.cleanLen} chars (sampler suppressed line breaks)`);
        assert.ok(r.bullets >= MIN_BULLETS,
          `[${i + 1}] missing bullet structure: ${r.bullets} bullet-lines (smushed bullets render inline)`);
      }
    },
  );
});
