#!/usr/bin/env node
// Integration smoke for lib/opencode.js's runOpenCode — the live-docker half the
// contract unit tests (docker-free, fake `exec`) can't cover. Two checks:
//
//   1. LIVE  — drive a real one-shot against :11436. Asserts a real /workspace
//      mutation AND a row-writable runDir (run_summary.json present + the
//      registry reporter's own writeAssertionResult lands assertion_result.json).
//   2. DEAD  — point OpenCode at a dead port (host.docker.internal:19999). #009
//      Finding 2: the model resolves but the endpoint-down-mid-stream wedges with
//      NO exit code. Asserts runOpenCode's timeoutMs hard-kill RESOLVES with
//      terminal_status 'timeout' (never hangs, never rejects) — the no-false-green
//      guard for the load-bearing timeout path.
//
// Needs a docker daemon + the opencode:local image + a live :11436. Because the
// lab keeps node in containers and this shells out to `docker compose`, run it
// Docker-out-of-Docker with the repo path-matched (so the host daemon resolves
// the compose-relative mounts + WORKSPACE identically). See `npm`-less invocation
// at the bottom of this file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOpenCode } from '../lib/opencode.js';
import { writeAssertionResult } from '../lib/registry_emit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const OC_DIR = path.join(REPO_ROOT, 'client', 'opencode');
const COMPOSE = path.join(OC_DIR, 'docker-compose.yml');
// Host-visible scratch under the (gitignored) runtime root, so the host daemon
// can bind-mount the per-run workspace + the dead-port override files.
const SCRATCH = path.join(OC_DIR, '.opencode-runtime', 'smoke');

let failures = 0;
const check = (name, cond, detail = '') => {
  const ok = !!cond;
  console.log(`  ${ok ? '✔' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

function freshDir(p) {
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
  return p;
}

async function liveCheck() {
  console.log('\n=== LIVE: one-shot against :11436 ===');
  const workspaceDir = freshDir(path.join(SCRATCH, 'live-ws'));
  const runtimeRoot = freshDir(path.join(SCRATCH, 'live-runtime'));

  const r = await runOpenCode({
    prompt: "Create a file smoke.py containing exactly: print('ok')",
    workspaceDir,
    runtimeRoot,
    timeoutMs: 120_000,
  });

  console.log(`  → code=${r.code} terminal_status=${r.terminal_status ?? '(none)'} elapsedMs=${r.elapsedMs}`);
  check('resolved (did not reject)', true);
  check('real /workspace mutation: smoke.py exists', fs.existsSync(path.join(workspaceDir, 'smoke.py')),
    fs.existsSync(path.join(workspaceDir, 'smoke.py')) ? fs.readFileSync(path.join(workspaceDir, 'smoke.py'), 'utf8').trim() : 'MISSING');
  check('runDir populated', typeof r.runDir === 'string' && fs.existsSync(r.runDir), r.runDir);
  check('run_summary.json present', fs.existsSync(path.join(r.runDir, 'run_summary.json')));

  // Prove row-writability the exact way the registry reporter does.
  writeAssertionResult(r.runDir, { passed: true, claw_exit: r.code, post_status: 0, post_stderr_tail: null });
  check('reporter can write assertion_result.json into runDir',
    fs.existsSync(path.join(r.runDir, 'assertion_result.json')));

  // Exit code is telemetry only — note it, don't gate on it.
  if (r.code !== 0) console.log(`  ℹ note: agent exit=${r.code} (telemetry only; oracle is the workspace)`);
}

async function deadPortCheck() {
  console.log('\n=== DEAD: timeout path RESOLVES (no hang / no reject) ===');
  const workspaceDir = freshDir(path.join(SCRATCH, 'dead-ws'));
  const runtimeRoot = freshDir(path.join(SCRATCH, 'dead-runtime'));
  const overrideDir = freshDir(path.join(SCRATCH, 'dead-override'));

  // Dead-port provider config + a compose override that mounts it over the live
  // opencode.json. :19999 has nothing listening → #009 Finding-2 mid-stream hang.
  const deadConfig = path.join(overrideDir, 'opencode.deadport.json');
  fs.writeFileSync(deadConfig, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'llama-local': {
        name: 'DEAD PORT (smoke timeout test)',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'http://host.docker.internal:19999/v1', apiKey: 'sk-local-no-auth' },
        models: { opencode: { name: 'dead' } },
      },
    },
    model: 'llama-local/opencode',
  }, null, 2) + '\n');
  const overrideCompose = path.join(overrideDir, 'docker-compose.deadport.yml');
  fs.writeFileSync(overrideCompose,
    `services:\n  opencode:\n    volumes:\n      - ${deadConfig}:/root/.config/opencode/opencode.json:ro\n`);

  const TIMEOUT_MS = 12_000;
  const start = Date.now();
  let r, threw = null;
  try {
    r = await runOpenCode({
      prompt: "Create a file should_not_exist.py with print('nope')",
      workspaceDir,
      runtimeRoot,
      composeFile: [COMPOSE, overrideCompose],
      timeoutMs: TIMEOUT_MS,
    });
  } catch (e) {
    threw = e;
  }
  const elapsed = Date.now() - start;
  console.log(`  → elapsedMs=${elapsed} terminal_status=${r?.terminal_status ?? '(threw)'}`);

  check('did NOT reject on hang', threw === null, threw ? String(threw.message) : '');
  check('resolved terminal_status:timeout', r?.terminal_status === 'timeout', r?.terminal_status);
  check('code is null on timeout', r?.code === null);
  check('killed near timeoutMs, did not hang', elapsed >= TIMEOUT_MS - 500 && elapsed < TIMEOUT_MS + 20_000, `${elapsed}ms`);
  check('sidecar marks timeout', (() => {
    try { return JSON.parse(fs.readFileSync(path.join(r.runDir, 'run_summary.json'), 'utf8')).timeout === true; }
    catch { return false; }
  })());
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  await liveCheck();
  await deadPortCheck();
  console.log(`\n${failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures} check(s) failed)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(2); });
