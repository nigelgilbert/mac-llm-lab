# Overnight Cross-Tier Screen — explore-c21-20260503-2013

- Date: 2026-05-03 20:13
- Tiers: 16 64
- Reps per tier: 3
- Harness git SHA: e8e946d
- Registry: /Users/nigel/Desktop/bench/mac-llm-lab-1/host/test/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
- Hint file: MISSING — thermal_status will be throughput-drift only
- Order: rep-outer × tier-middle × test-inner (cheap interleave)

## rep=1 tier=16

```
 Container test-test-run-2e74cb86c766 Creating 
 Container test-test-run-2e74cb86c766 Created 

=== book-store (tier-16) ===
  claw: exit=1 elapsed=108725ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (37293 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-16)
  ✖ claw solves the task (108735.387252ms)
✖ book-store: minimum-cost partition with non-greedy trap (tier=tier-16) (108735.94829ms)

=== needle-haystack v4 (tier-16) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=0 elapsed=80027ms solve.js=true
  verify: exit=0 stdout=all-pass stderr=
[run-registry] appended needle-haystack row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16)
  ✔ claw locates REGION_KEY and writes solve.js (80069.494721ms)
✔ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16) (80069.873927ms)

=== twelve-file-refactor (tier-16) ===
  claw: exit=0 elapsed=520758ms files=[".claw",".claw-runtime",".clawd-todos.json",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  node post-fix: exit=0 stderr=
[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16)
  ✔ claw threads two parameters through every caller (115859.073942ms)
✔ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16) (115859.471275ms)

=== two-bucket (tier-16) ===
  claw: exit=1 elapsed=113722ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (35237 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16)
  ✖ claw solves the task (113736.135238ms)
✖ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16) (113736.662324ms)
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16)
  ✖ claw solves the task (741445.737969ms)
✖ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16) (741448.381809ms)

=== word-search v2 (tier-16) ===
  claw: exit=null elapsed=4570782ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  claw stderr (tail):

[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl

=== wordy (tier-16) ===
  claw: exit=1 elapsed=93973ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (37125 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-16)
  ✖ claw solves the task (93988.155101ms)
✖ wordy: arithmetic query parser (tier=tier-16) (93988.782728ms)
ℹ tests 6
ℹ suites 6
ℹ pass 2
ℹ fail 3
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1254018.151332

✖ failing tests:

test at __tests__/tier-eval/book-store.test.js:156:3
✖ claw solves the task (108735.387252ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/book-store.test.js:184:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/two-bucket.test.js:205:3
✖ claw solves the task (113736.135238ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/two-bucket.test.js:233:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/word-search.test.js:449:3
✖ claw solves the task (741445.737969ms)
  'test timed out after 305000ms'

test at __tests__/tier-eval/wordy.test.js:117:3
✖ claw solves the task (93988.155101ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/wordy.test.js:146:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

Exit code: 1 (rep=1 tier=16)

## rep=1 tier=64

```
 Container test-test-run-ea215a8c40a8 Creating 
 Container test-test-run-ea215a8c40a8 Created 

=== book-store (tier-64) ===
  claw: exit=0 elapsed=45371ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  verify: exit=null stderr=
[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-64)
  ✖ claw solves the task (55398.01043ms)
✖ book-store: minimum-cost partition with non-greedy trap (tier=tier-64) (55398.777932ms)

=== needle-haystack v4 (tier-64) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=1 elapsed=8613ms solve.js=false
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (3542924 tokens) exceeds the available context size (65536 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended needle-haystack row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64)
  ✖ claw locates REGION_KEY and writes solve.js (8713.677909ms)
✖ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64) (8714.172619ms)

=== twelve-file-refactor (tier-64) ===
  claw: exit=0 elapsed=43613ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  node post-fix: exit=0 stderr=
[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64)
  ✔ claw threads two parameters through every caller (43664.721909ms)
✔ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64) (43665.143786ms)

=== two-bucket (tier-64) ===
  claw: exit=0 elapsed=69515ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64)
  ✔ claw solves the task (69551.983854ms)
✔ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64) (69552.47048ms)

=== word-search v2 (tier-64) ===
  claw: exit=0 elapsed=40877ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  verify: exit=0 stderr=
[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64)
  ✔ claw solves the task (17048.633086ms)
✔ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64) (17049.023129ms)

=== wordy (tier-64) ===
  claw: exit=0 elapsed=74050ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  verify: exit=0 stderr=
[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-64)
  ✔ claw solves the task (74088.044533ms)
✔ wordy: arithmetic query parser (tier=tier-64) (74088.462493ms)
ℹ tests 6
ℹ suites 6
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 268613.11103

✖ failing tests:

test at __tests__/tier-eval/book-store.test.js:156:3
✖ claw solves the task (55398.01043ms)
  AssertionError [ERR_ASSERTION]: verify.js failed:
  
  
  null !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/book-store.test.js:186:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/needle-haystack.test.js:370:3
✖ claw locates REGION_KEY and writes solve.js (8713.677909ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/needle-haystack.test.js:404:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

Exit code: 1 (rep=1 tier=64)

## rep=2 tier=16

```
 Container test-test-run-5e69ad1fc2e7 Creating 
 Container test-test-run-5e69ad1fc2e7 Created 

=== book-store (tier-16) ===
  claw: exit=1 elapsed=98139ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (32781 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-16)
  ✖ claw solves the task (98151.501626ms)
✖ book-store: minimum-cost partition with non-greedy trap (tier=tier-16) (98152.402753ms)

=== needle-haystack v4 (tier-16) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=1 elapsed=204869ms solve.js=true
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (35743 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended needle-haystack row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16)
  ✖ claw locates REGION_KEY and writes solve.js (98787.799075ms)
✖ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16) (98788.338868ms)

=== twelve-file-refactor (tier-16) ===
  claw: exit=1 elapsed=104346ms files=[".claw",".claw-runtime",".clawd-todos.json",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (33134 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16)
  ✖ claw threads two parameters through every caller (104385.703931ms)
✖ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16) (104386.363308ms)

=== two-bucket (tier-16) ===
  claw: exit=0 elapsed=91945ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16)
  ✔ claw solves the task (91990.575689ms)
✔ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16) (91990.976691ms)

=== word-search v2 (tier-16) ===
  claw: exit=0 elapsed=296777ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  verify: exit=0 stderr=
[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16)
  ✔ claw solves the task (69824.748369ms)
✔ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16) (69825.150537ms)

=== wordy (tier-16) ===
  claw: exit=0 elapsed=59917ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  verify: exit=0 stderr=
[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-16)
  ✔ claw solves the task (59954.399923ms)
✔ wordy: arithmetic query parser (tier=tier-16) (59954.875341ms)
ℹ tests 6
ℹ suites 6
ℹ pass 3
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 523248.528179

✖ failing tests:

test at __tests__/tier-eval/book-store.test.js:156:3
✖ claw solves the task (98151.501626ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/book-store.test.js:184:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/needle-haystack.test.js:370:3
✖ claw locates REGION_KEY and writes solve.js (98787.799075ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/needle-haystack.test.js:404:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/twelve-file-refactor.test.js:456:3
✖ claw threads two parameters through every caller (104385.703931ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/twelve-file-refactor.test.js:490:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

Exit code: 1 (rep=2 tier=16)

## rep=2 tier=64

```
 Container test-test-run-4f62e9897134 Creating 
 Container test-test-run-4f62e9897134 Created 

=== book-store (tier-64) ===
  claw: exit=0 elapsed=26014ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-64)
  ✔ claw solves the task (26048.14397ms)
✔ book-store: minimum-cost partition with non-greedy trap (tier=tier-64) (26048.636805ms)

=== needle-haystack v4 (tier-64) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=null elapsed=1246691ms solve.js=false
  claw stderr (tail):

[run-registry] appended needle-haystack row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64)
  ✖ claw locates REGION_KEY and writes solve.js (285467.878578ms)
✖ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64) (285468.496662ms)

=== twelve-file-refactor (tier-64) ===
  claw: exit=0 elapsed=61642ms files=[".claw",".claw-runtime",".clawd-todos.json",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  node post-fix: exit=0 stderr=
[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64)
  ✔ claw threads two parameters through every caller (61688.660806ms)
✔ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64) (61689.086516ms)

=== two-bucket (tier-64) ===
  claw: exit=null elapsed=795790ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  claw stderr (tail):

[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64)
  ✖ claw solves the task (285035.40016ms)
✖ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64) (285035.980744ms)

=== word-search v2 (tier-64) ===
  claw: exit=0 elapsed=20658ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  verify: exit=0 stderr=
[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64)
  ✔ claw solves the task (20680.076758ms)
✔ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64) (20680.416592ms)

=== wordy (tier-64) ===
  claw: exit=0 elapsed=757188ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  verify: exit=0 stderr=
[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-64)
  ✔ claw solves the task (161697.683318ms)
✔ wordy: arithmetic query parser (tier=tier-64) (161698.074067ms)
ℹ tests 6
ℹ suites 6
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 840774.69574

✖ failing tests:

test at __tests__/tier-eval/needle-haystack.test.js:370:3
✖ claw locates REGION_KEY and writes solve.js (285467.878578ms)
  AssertionError [ERR_ASSERTION]: claw timed out after 1246691ms
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/needle-haystack.test.js:402:49)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'fail',
    diff: 'simple'
  }

test at __tests__/tier-eval/two-bucket.test.js:205:3
✖ claw solves the task (285035.40016ms)
  AssertionError [ERR_ASSERTION]: claw timed out after 795790ms
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/two-bucket.test.js:231:49)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'fail',
    diff: 'simple'
  }

```

Exit code: 1 (rep=2 tier=64)

## rep=3 tier=16

```
 Container test-test-run-26b44c590cea Creating 
 Container test-test-run-26b44c590cea Created 

=== book-store (tier-16) ===
  claw: exit=1 elapsed=155312ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (36704 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-16)
  ✖ claw solves the task (144820.65821ms)
✖ book-store: minimum-cost partition with non-greedy trap (tier=tier-16) (144821.245043ms)

=== needle-haystack v4 (tier-16) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=0 elapsed=50553ms solve.js=true
  verify: exit=0 stdout=all-pass stderr=
[run-registry] appended needle-haystack row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16)
  ✔ claw locates REGION_KEY and writes solve.js (50590.076748ms)
✔ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-16) (50590.487456ms)

=== twelve-file-refactor (tier-16) ===
  claw: exit=0 elapsed=101848ms files=[".claw",".claw-runtime",".clawd-todos.json",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  node post-fix: exit=0 stderr=
[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16)
  ✔ claw threads two parameters through every caller (101900.893272ms)
✔ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-16) (101901.343897ms)

=== two-bucket (tier-16) ===
  claw: exit=0 elapsed=55021ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16)
  ✔ claw solves the task (51994.124766ms)
✔ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-16) (51994.593349ms)

=== word-search v2 (tier-16) ===
  claw: exit=0 elapsed=37817ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  verify: exit=0 stderr=
[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16)
  ✔ claw solves the task (37874.474169ms)
✔ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-16) (37874.870752ms)

=== wordy (tier-16) ===
  claw: exit=1 elapsed=468183ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  claw stderr (tail):
[error-kind: api_http_error]
error: api returned 400 Bad Request: {"error":{"message":"litellm.BadRequestError: OpenAIException - request (33372 tokens) exceeds the available context size (32768 tokens), try increasing it. Received Model Group=anthropic/claw-llama\nAvailable Model Group Fallbacks=None","type":null,"param":null,"code":"400"}}

Run `claw --help` for usage.

[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-16)
  ✖ claw solves the task (90354.265204ms)
✖ wordy: arithmetic query parser (tier=tier-16) (90354.793704ms)
ℹ tests 6
ℹ suites 6
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 477691.364416

✖ failing tests:

test at __tests__/tier-eval/book-store.test.js:156:3
✖ claw solves the task (144820.65821ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/book-store.test.js:184:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at __tests__/tier-eval/wordy.test.js:117:3
✖ claw solves the task (90354.265204ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/wordy.test.js:146:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

Exit code: 1 (rep=3 tier=16)

## rep=3 tier=64

```
 Container test-test-run-253c2d36a84b Creating 
 Container test-test-run-253c2d36a84b Created 

=== book-store (tier-64) ===
  claw: exit=0 elapsed=25707ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","book-store.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended book-store row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ book-store: minimum-cost partition with non-greedy trap (tier=tier-64)
  ✔ claw solves the task (25746.010749ms)
✔ book-store: minimum-cost partition with non-greedy trap (tier=tier-64) (25746.448749ms)
[iter-distribution] artifact collection failed for 597b258f-b570-435c-b36a-ed8ba657b514: Error: Cannot create a string longer than 0x1fffffe8 characters
    at Object.readFileSync (node:fs:441:20)
    at moveAndReadSessionFiles (file:///test/lib/claw.js:547:23)
    at collectRunArtifacts (file:///test/lib/claw.js:292:26)
    at ChildProcess.<anonymous> (file:///test/lib/claw.js:130:24)
    at ChildProcess.emit (node:events:509:28)
    at maybeClose (node:internal/child_process:1124:16)
    at ChildProcess._handle.onexit (node:internal/child_process:306:5)

=== needle-haystack v4 (tier-64) ===
  canonical bootstrap: lib/utils/format.js = 'f0'
  canonical map:       lib/handlers/session.js (MAP['f0'] = 22)
  canonical table:     lib/core/scheduler.js (TABLE[22] = 'de64cc')
  decoy bootstraps: lib/core/registry.js, data/seeds.js, config/routes.js
  decoy maps:       lib/utils/parse.js, data/presets.js, config/flags.js
  decoy tables:     lib/handlers/auth.js, data/fixtures.js, config/limits.js (lengths 10/14/16)
  claw: exit=null elapsed=43738ms solve.js=false
  claw stderr (tail):

▶ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64)
  ✖ claw locates REGION_KEY and writes solve.js (48066.814867ms)
✖ needle-haystack: 30-file NIAH apply-the-needle (tier=tier-64) (48067.9957ms)

=== twelve-file-refactor (tier-64) ===
  claw: exit=0 elapsed=65003ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","audit.js","cart.js","constants.js","currency-config.js","format-config.js","format-parse.js","format.js","helper.js","invoice.js","notify.js","receipt.js","report.js","summary.js","taxes.js","test.js"]
  node post-fix: exit=0 stderr=
[run-registry] appended twelve-file-refactor row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64)
  ✔ claw threads two parameters through every caller (65053.088016ms)
✔ twelve-file-refactor: thread two params through 7 call sites in 12 files (tier=tier-64) (65053.545058ms)

=== two-bucket (tier-64) ===
  claw: exit=0 elapsed=29482ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","two-bucket.js","verify.js"]
  verify: exit=0 stderr=
[run-registry] appended two-bucket row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64)
  ✔ claw solves the task (29521.023139ms)
✔ two-bucket: shortest-path BFS with explicit path reconstruction (tier=tier-64) (29521.474722ms)

=== word-search v2 (tier-64) ===
  claw: exit=0 elapsed=16977ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","anchors.json","board.txt","verify.js","word-search.js"]
  verify: exit=0 stderr=
[run-registry] appended word-search row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64)
  ✔ claw solves the task (17022.981933ms)
✔ word-search v2.1: dual-anchor multi-match enumeration (tier=tier-64) (17023.568683ms)

=== wordy (tier-64) ===
  claw: exit=0 elapsed=63333ms files=[".claw",".claw-runtime",".sandbox-home",".sandbox-tmp","verify.js","wordy.js"]
  verify: exit=0 stderr=
[run-registry] appended wordy row → /workspace/.claw-runtime/run_registry.explore-c21-20260503-2013.jsonl
▶ wordy: arithmetic query parser (tier=tier-64)
  ✔ claw solves the task (63370.938465ms)
✔ wordy: arithmetic query parser (tier=tier-64) (63371.389839ms)
ℹ tests 6
ℹ suites 6
ℹ pass 5
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 248953.82688

✖ failing tests:

test at __tests__/tier-eval/needle-haystack.test.js:370:3
✖ claw locates REGION_KEY and writes solve.js (48066.814867ms)
  AssertionError [ERR_ASSERTION]: claw must exit cleanly
  
  null !== 0
  
      at TestContext.<anonymous> (file:///test/__tests__/tier-eval/needle-haystack.test.js:404:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

Exit code: 1 (rep=3 tier=64)

