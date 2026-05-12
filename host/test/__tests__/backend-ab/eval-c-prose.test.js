// Eval C: prose density.
//
// KNOWN ISSUE — marked `it.skip` (body does not execute). Captured here
// as a runnable spec for the markdown-smush bug observed in claw-code on
// 2026-04-27, where final-message text renders with bold/header markers
// intact but newlines stripped, collapsing structured output onto one
// run-on line. Flip `it.skip` → `it` to re-enable once the underlying
// model behavior changes.
//
// Reproduces only through `claw -p`, never via the raw bridge with the
// same model, sampler, claw-verbatim system prompt, and a 50-tool catalog
// — so it isn't sampler-driven, isn't tools-driven, and isn't
// system-prompt-content driven in any way we could mimic externally.
// Workspace CLAUDE.md instructions reach the model (verified via a
// "respond with ZEBRA" probe — ZEBRA appears) but markdown directives
// specifically only land 1/3 of the time, even when phrased with strong
// MUST framing. The model has an "agent mode → terse output" prior that
// outweighs explicit formatting instructions non-deterministically.
//
// Likely paths to fix:
//   1. Model swap — bug is qwen3-coder-specific; a successor or peer model
//      with stronger instruction-following under `tools` context may not
//      exhibit it. See host/test/__tests__/model-ab/prose-density.test.js
//      which runs this check against qwen3.6 without the skip.
//   2. Forking claw-code to modify its hardcoded system prompt at source
//      (its `with_output_style` builder is unreachable from -p mode).
//      Speculative — the prompt-position lever may not move the needle
//      either, given CLAUDE.md only got 1/3.
//
// Functional impact today is bounded: tool-call correctness is unaffected
// (eval-a, eval-b, wrap-rate all green). Only final-message readability
// in claw degrades. Investigation logged in conversation transcripts on
// 2026-04-27.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw } from '../../lib/claw.js';
import { clawModel, BACKEND } from '../../lib/backend.js';

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

describe(`prose density via claw (backend=${BACKEND}, model=${clawModel})`, () => {
  it.skip(
    `${N}× markdown response: len ≥ ${MIN_TEXT_LEN}, newlines ≥ ${MIN_NEWLINES}, bullets ≥ ${MIN_BULLETS} — KNOWN ISSUE, see header`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const results = [];
      for (let i = 0; i < N; i++) {
        const r = await runClaw({ prompt: PROMPT, model: clawModel, signal});
        const clean    = stripAnsi(r.stdout);
        const newlines = (r.stdout.match(/\n/g) ?? []).length;
        // Bullet at start of a line — the strongest smush signal. In
        // smushed output the bullet glyphs end up inline (no leading \n),
        // so this count goes to ~0 even if `•` characters exist in the body.
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

      console.log(`\n=== prose-density via claw (${BACKEND}) ===`);
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
