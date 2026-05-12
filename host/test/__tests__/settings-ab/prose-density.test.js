// Prose density observation — N=5 samples per phase.
//
// Records how often the model produces structured markdown (headers + bullets)
// vs smushed output (newlines stripped, bullets inline). Used to detect quality
// regressions from settings changes, comparable across phases.
//
// The workspace is reset before each sample to prevent files from the
// agent-timing tests (a.py, b.py, hello.py, .claw/) from appearing in claw's
// context and silently changing its output behaviour.
//
// Hard assertion: all runs must exit 0 (claw must not crash).
// Informational: pass count is printed for human comparison between phases.
// No threshold assertion — the model's smush rate varies naturally (~1-in-3
// to ~4-in-5) and isn't reliably attributable to inference settings.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runClaw }    from '../../lib/claw.js';
import * as workspace from '../../lib/workspace.js';
import { clawModel }  from '../../lib/model.js';

const SETTINGS_LABEL = process.env.SETTINGS_LABEL || 'unknown';
const N              = Number(process.env.PROSE_N) || 5;
const TIMEOUT        = 300_000;
const MIN_LEN        = 600;
const MIN_NEWLINES   = 5;
const MIN_BULLETS    = 3;

const PROMPT =
  'Write a short markdown explainer about React components. ' +
  'Use 2 headers (## style) and at least 4 bullet points. ' +
  'Aim for around 250 words. Do not call any tools, just respond with the markdown.';

const ANSI_RE   = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

describe(`prose density observation (settings=${SETTINGS_LABEL})`, () => {
  it(
    `${N} samples: all exit 0, pass count reported (informational)`,
    { timeout: TIMEOUT },
    async ({ signal }) => {
      const results = [];

      for (let i = 0; i < N; i++) {
        workspace.reset();   // prevent agent-timing artefacts contaminating context
        const r        = await runClaw({ prompt: PROMPT, model: clawModel, signal});
        const clean    = stripAnsi(r.stdout);
        const newlines = (r.stdout.match(/\n/g) ?? []).length;
        const bullets  = (clean.match(/^[ \t]*[-*•]\s/gm) ?? []).length;
        const pass     = r.code === 0 && clean.length >= MIN_LEN && newlines >= MIN_NEWLINES && bullets >= MIN_BULLETS;
        results.push({ code: r.code, cleanLen: clean.length, newlines, bullets, elapsedMs: r.elapsedMs, pass });
        console.log(
          `  [${i + 1}/${N}] exit=${r.code} ${r.elapsedMs}ms ` +
          `len=${clean.length} newlines=${newlines} bullets=${bullets} pass=${pass}`,
        );
      }

      const passing = results.filter((r) => r.pass).length;
      const sample  = stripAnsi(results[0]?.stdout ?? '').slice(0, 300).replace(/\n/g, '\\n');
      console.log(`\n=== prose-density (${SETTINGS_LABEL}) ===`);
      console.log(`  ${passing}/${N} samples passed criteria (len≥${MIN_LEN} newlines≥${MIN_NEWLINES} bullets≥${MIN_BULLETS})`);
      console.log(`  sample[0]: ${sample}`);

      // Only hard-assert that claw didn't crash — pass rate is for human comparison.
      const nonzero = results.filter((r) => r.code !== 0);
      assert.equal(nonzero.length, 0, `${nonzero.length} claw run(s) exited non-zero`);
    },
  );
});
