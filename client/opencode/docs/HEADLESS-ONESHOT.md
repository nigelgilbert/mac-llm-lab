# Headless `opencode run` one-shot — exit & cleanup semantics (Config B)

**Issue [#009](../../../issues/009-opencode-headless-oneshot.md) · 2026-06-06 ·
OpenCode `1.16.2` · container [`opencode:local`](../docker-compose.yml) →
host llama-server `:11436` ([#005](../../../issues/005-second-llama-server-config.md))**

> The **first true end-to-end Config-B agent run**: prove `opencode run "<prompt>"`
> mutates the mounted `/workspace`, exits, and orphans nothing — then nail down the
> exit-code semantics that [#001](../../../issues/001-pass-oracle-workspace-only.md)'s
> `crashed_before_finishing` telemetry and the
> [#010](../../../issues/010-runopencode-outcome-only.md) `runOpenCode` contract
> depend on. HITL because exit/cleanup behavior was empirically unknown.

## Verdict — acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | `opencode run` edits a mounted `/workspace` file end-to-end | ✅ **PASS** — `/workspace/hello.py` = exactly `print('hi')` (11 bytes), generated against `:11436` (server log shows `POST /v1/chat/completions → 200`) |
| 2 | Clean exit, no orphaned client/server process | ✅ **PASS** — container returns to just `sleep infinity`; **0 orphaned processes** across every run |
| 3 | Exit-code semantics documented (success / failure / partial) | ✅ see [table](#exit-code-semantics--for-runopencode-010) below |
| 4 | Reproducible invocation recorded | ✅ see [Reproduce](#reproduce) below |

**Bottom line: the headless one-shot works, exits 0, and leaves no orphan — BUT only
after black-holing `models.dev` (see [Finding 1](#finding-1--the-modelsdev-bootstrap-hang-the-real-blocker)).
Without that, `opencode run` wedges silently and forever.** That fix is now baked into
[`docker-compose.yml`](../docker-compose.yml) (`extra_hosts: models.dev:127.0.0.1`).

## Reproduce

```sh
# 1. host: second, OpenCode-dedicated llama-server (tier-64) on :11436
host/llama-server/scripts/opencode-server start

# 2. container: WORKSPACE=scratch dir, then up (idles on `sleep infinity`)
cd client/opencode
cp .env.example .env            # set WORKSPACE (default ./workspace, gitignored)
docker compose up -d

# 3. drive a one-shot; confirms the file appears ON THE HOST
docker compose exec -T opencode \
  opencode run "Create a file hello.py containing exactly: print('hi')"
cat workspace/hello.py          # -> print('hi')   (exit 0, ~3 s warm)
```

Deterministic: 4 consecutive cold runs from a freshly-recreated container → exit 0 in
2–3 s each, byte-exact file, zero orphans. (`docker compose up` publishes `8080`; if
the sibling `claw-code` container already holds it, run with an override that clears
the port — the dev-server port is irrelevant to a headless one-shot.)

## Exit-code semantics — for `runOpenCode` (#010)

`opencode run` exit codes are **coarse**: `0` = success, `1` = *any* pre-flight error,
signal codes when killed. The error *class* is never in the code — it's only in the
`Error: {...}` JSON on stderr. Worse, two failure modes **do not produce an exit code
at all** — they hang.

| Scenario | Exit | Workspace | Notes |
|---|---|---|---|
| **Success** (task completed) | **`0`** | mutated | streams `Wrote file successfully`; real `POST …/v1/chat/completions → 200` on `:11436` |
| Bad model id (`-m llama-local/nope`) | **`1`** | untouched | `Error: {"name":"UnknownError",…}` on stderr — fast |
| Bad provider (`-m nope/nope`) | **`1`** | untouched | same generic `UnknownError` |
| Unknown flag | **`1`** | untouched | prints usage |
| Empty prompt (`opencode run`) | **`1`** | untouched | `Error: You must provide a message or a command` |
| `SIGINT` (Ctrl-C) | **`130`** | untouched | 128+2; responds promptly |
| `SIGTERM` | **`143`** | partial-possible | 128+15; responds promptly |
| **models.dev fetch stalls** (bootstrap) | **— HANG —** | untouched | wedges at `format init`, no output, no request, indefinite. **Fixed** (Finding 1) |
| **llama-server endpoint down mid-stream** | **— HANG —** | task-dependent | logs `AI_APICallError/ConnectionRefused`, then **does not exit**. Needs external kill (Finding 2) |

**Implications for `runOpenCode`:**

- **Adopt the workspace-only pass oracle ([plan §0b](../../../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md)).**
  `agent.code` here is too coarse to gate pass/fail (every error is `1`) and can be
  *absent entirely* (hangs). Use `post.status === 0` for pass; keep the exit code as
  recorded telemetry + the `crashed_before_finishing` diagnostic only.
- **`runOpenCode` MUST enforce its own `timeoutMs` with a hard kill** (the
  timeout-resolves-not-rejects pattern from [§4.3](../../../host/test/docs/OPENCODE-HARNESS-AB-PLAN.md)).
  A hung run yields **no exit code**, so without the timeout a single dead-endpoint or
  catalog stall halts the whole sweep. Map a timeout-kill to
  `terminal_status: 'timeout'`; reserve `crashed_before_finishing` for a non-zero exit
  with an unmet workspace oracle.
- **No compatibility shim, no `--dangerously-skip-permissions` needed** for plain file
  writes: `run` mode auto-approved the `write` tool and completed unattended.

## Finding 1 — the models.dev bootstrap hang (the real blocker)

On **every** `opencode run`, bootstrap fetches the **models.dev** model catalog over
HTTPS (`https://models.dev`, Cloudflare; the 2.2 MB `~/.cache/opencode/models.json`).
That fetch has **no effective timeout**. When the Cloudflare connection stalls
(socket `ESTABLISHED`, no response), `opencode run` blocks in `epoll_pwait2` and
**hangs silently and indefinitely at the `format init` log line** — *before* any model
work: zero stdout, no request to `:11436`, process idle. Observed first run: **13+ min**
wedged, killed only by `SIGINT` (→ 130).

Diagnosis trail: the hung process held one `ESTABLISHED` socket to `172.67.69.147:443`
(DNS-confirmed **models.dev**) and was parked in `epoll_pwait2`; the opencode log
stopped at `service=format init`.

**The catalog is never needed here.** Our provider `llama-local` is fully declared in
[`opencode.json`](../opencode.json), and the `@ai-sdk/openai-compatible` SDK is
**bundled in the opencode binary** (log: `pkg=@ai-sdk/openai-compatible using bundled
provider`; it is not unpacked into any `node_modules` — `find / -name openai-compatible`
is empty even on a successful run). So the catalog fetch is pure startup tax we can drop.

**Fix (committed):** black-hole models.dev so the fetch **fails fast** and OpenCode falls
straight through. One line in [`docker-compose.yml`](../docker-compose.yml):

```yaml
extra_hosts:
  - "models.dev:127.0.0.1"   # fetch → ECONNREFUSED → bundled-provider fast path
```

**Verified:** truly cold container (no catalog cache, no provider `node_modules`) +
models.dev black-holed → exit 0 in 2–3 s, byte-exact file, catalog never re-created,
**4/4 + 2/2 (post-recreate) runs reliable**. With models.dev *reachable* the wedge
recurred intermittently (1 of ~3 runs), so this is a sweep-grade hazard, not a one-off.

> ⚠️ **Red-herring corrected:** an early hypothesis blamed a missing
> `@ai-sdk/openai-compatible` install and a manual `npm install` "fixed" it. It did not
> — that run simply caught models.dev on a good day. Removing the package entirely and
> black-holing models.dev is **reliable**. The provider is bundled; do **not** add a
> provider-install step to the image.

## Finding 2 — endpoint-down-mid-stream also hangs (≠ pre-flight errors)

A second, distinct hang: when the model *resolves* fine but the llama-server **endpoint
is unreachable** once streaming starts, OpenCode logs the failure
(`AI_APICallError / ConnectionRefused / …/v1/chat/completions`) and then **does not
exit** — it parks in `epoll_pwait2`. Killed cleanly by `SIGTERM` (→ 143).

Contrast with the **pre-flight** errors (bad model/provider/flag) which fail *before*
the agent loop and exit `1` promptly. The boundary:

- error **before** the agent loop starts → clean `exit 1`
- endpoint dies **during** the agent loop → **hang** (no exit)

This is exactly the realistic phase-swap failure (server not up yet / wrong port), and
it is **not** covered by the models.dev fix. It is the concrete reason `runOpenCode`'s
own `timeoutMs`-kill is mandatory rather than nice-to-have.

## Process-cleanup verdict

After **every** terminating run (success, `exit 1`, signal-kill), the container process
table returns to **just PID 1 `sleep infinity`** — no orphaned `opencode` client or
server process. (`ps` is absent in the slim image; verified via `/proc/[0-9]*/comm`.)

One cosmetic artifact: a stale `LISTEN` entry for OpenCode's internal server port
(127.0.0.1:37223) can linger in `/proc/net/tcp` after exit, but it is owned by **no
process and no fd** and **refuses connections** (`curl` → exit 7) — benign kernel
bookkeeping, not a live orphan.

## Honest boundary

Validated for the **single-shot file-write** shape on tier-64. Multi-turn sessions
(`-c/--session`), the `--format json` event stream (which [#021](../../../issues/021-transcript-adapter.md)'s
transcript adapter will consume), and `--dangerously-skip-permissions` for destructive
tools are **not** exercised here. The two hangs above are the load-bearing findings for
[#010](../../../issues/010-runopencode-outcome-only.md); everything else is happy-path.
