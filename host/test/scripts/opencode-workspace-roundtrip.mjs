#!/usr/bin/env node
// Live cross-container /workspace round-trip for issue #011.
//
// Proves the OPENCODE-WORKSPACE-CONTRACT (docs/OPENCODE-WORKSPACE-CONTRACT.md):
// when the suite runs under CONFIG=opencode-a, a file the HARNESS seeds into the
// test container's /workspace is visible to the OpenCode SIBLING container, and a
// file the AGENT writes in the sibling is visible to the post-script oracle back
// in the test container — because both /workspace paths are backed by the same
// host dir (HOST_WORKSPACE). Not asserted by inspection; proven by a real
// round-trip through the actual #011 selector.
//
// This script runs INSIDE a path-matched test container. The driver wiring (the
// docker run incantation: -v "$REPO:$REPO", the host socket, -v "$H:/workspace",
// CONFIG/HOST_WORKSPACE/TIER) is documented in OPENCODE-WORKSPACE-CONTRACT.md and
// echoed in the run-instructions at the bottom of this file.
//
// What it exercises (the real path, no shortcuts):
//   1. workspace.reset() + seed via lib/workspace.js   (the harness's own module)
//   2. selectRunner() → runOpenCode                    (the real #011 selector)
//   3. read the agent's output back via lib/workspace.js (the oracle's view)
//
// A unique token threads seed → agent → result, so a green result can ONLY mean
// the seed crossed INTO the sibling (the agent read it) and the agent's write
// crossed BACK to the oracle. Needs a docker daemon (host socket) + a live
// OpenCode server for the target tier (oc-64 :11436 is the proven path).

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import * as workspace from '../lib/workspace.js';
import { selectRunner } from '../lib/runAgent.js';

const TIMEOUT_MS = Number(process.env.ROUNDTRIP_TIMEOUT_MS) || 180_000;

let failures = 0;
const check = (name, cond, detail = '') => {
  const ok = !!cond;
  console.log(`  ${ok ? '✔' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function main() {
  console.log('=== #011 cross-container /workspace round-trip ===');
  console.log(`  CONFIG=${process.env.CONFIG ?? '(unset)'}  HOST_WORKSPACE=${process.env.HOST_WORKSPACE ?? '(unset)'}  TIER=${process.env.TIER ?? '(default 64)'}`);

  if (process.env.CONFIG !== 'opencode-a') {
    console.error('FAIL: this round-trip must run under CONFIG=opencode-a');
    process.exit(2);
  }

  // Resolve the runner through the REAL selector. Throws here (loudly) if
  // HOST_WORKSPACE is unset — that throw is itself part of the #011 contract.
  let run;
  try {
    run = selectRunner();
  } catch (e) {
    console.error(`FAIL: selectRunner threw: ${e.message}`);
    process.exit(2);
  }

  // 1. Harness seeds a uniquely-tokened file into the (shared) /workspace.
  const token = `rt-${randomUUID()}`;
  workspace.reset();
  // lib/workspace.js exposes no write helper (runAgent seeds via fs directly), so
  // seed the same way runAgent does.
  writeFileSync(path.join(workspace.WORKSPACE, 'seed.txt'), token);
  check('seed.txt written into test-container /workspace', workspace.exists('seed.txt'), token);

  // 2. Drive the agent in the SIBLING container via the #011 selector. The prompt
  //    forces a read of the seed (proves seed→sibling) and a write echoing the
  //    token (proves agent-write→oracle).
  const prompt =
    'There is a file named seed.txt in your current working directory. ' +
    'Read its contents, then create a new file named result.txt whose contents ' +
    'are exactly the contents of seed.txt followed by a space and the word DONE. ' +
    'Do not modify seed.txt.';

  console.log(`  → driving opencode sibling (timeout ${TIMEOUT_MS}ms)…`);
  const r = await run({ prompt, signal: new AbortController().signal, timeoutMs: TIMEOUT_MS });
  console.log(`  → code=${r.code} terminal_status=${r.terminal_status ?? '(none)'} elapsedMs=${r.elapsedMs} runDir=${r.runDir}`);

  // 3. Read the agent's output back through the oracle's view (test container).
  const wrote = workspace.exists('result.txt');
  check('result.txt visible to the post-script oracle (agent write crossed back)', wrote);
  if (wrote) {
    const body = workspace.read('result.txt');
    check('result.txt carries the seeded token (seed crossed INTO the sibling)',
      body.includes(token), JSON.stringify(body.slice(0, 120)));
  } else {
    console.log(`  ℹ workspace now contains: ${JSON.stringify(workspace.list())}`);
    if (r.stderr) console.log(`  ℹ agent stderr tail: ${r.stderr.slice(-600)}`);
  }
  // seed.txt must survive (the agent was told not to touch it) — also confirms the
  // sibling didn't wipe the shared dir.
  check('seed.txt still present and unchanged', workspace.exists('seed.txt') && workspace.read('seed.txt') === token);

  console.log(`\n${failures === 0 ? 'ROUND-TRIP PASS' : `ROUND-TRIP FAIL (${failures} check(s) failed)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('round-trip crashed:', e); process.exit(2); });

// ---------------------------------------------------------------------------
// Run it (host has docker + compose, no host node; oc-64 :11436 must be up):
//
//   REPO="$(git rev-parse --show-toplevel)"
//   H="$REPO/client/opencode/.opencode-runtime/roundtrip-ws"
//   rm -rf "$H" && mkdir -p "$H"
//   docker run --rm \
//     -v "$REPO:$REPO" -w "$REPO/host/test" \
//     -v /var/run/docker.sock:/var/run/docker.sock \
//     -v "$H:/workspace" \
//     -e CONFIG=opencode-a -e HOST_WORKSPACE="$H" -e TIER=64 \
//     --entrypoint sh docker:cli -c \
//     'apk add --no-cache nodejs docker-cli-compose >/dev/null && node scripts/opencode-workspace-roundtrip.mjs'
// ---------------------------------------------------------------------------
