# The gut: tag `claw-stack-final`, delete the claw production stack

**Type**: AFK (pre-decided and tag-reversible; note it stops the old production service `:11435`)

**Status:** ✅ Done (2026-06-10)

## Parent

[OPENCODE-MIGRATION-DECISION.md](../host/test/docs/OPENCODE-MIGRATION-DECISION.md) §2.2, §3.4.

## What to build

The demolition, in order:

1. Tag the pre-gut commit `claw-stack-final` (the archive; reproducing the
   baseline = checkout the tag).
2. Stop and unload the claw llama-server launchd service (`:11435`) and the
   LiteLLM bridge.
3. Delete from the working tree: `client/claw-code`, `host/litellm`, the
   claw grammar(s), claw llama-server plists, and the wizard's
   litellm/clawcode steps (48/49) plus their bringup/smoke references.
4. Update the root README and wizard README to describe the opencode stack
   only, linking the decision doc and the tag for the old stack.

Leave `host/test/lib/claw.js` and the harness's claw branches in place —
their removal is #010's scoped change (keeps this PR mechanical:
production stack only).

Verify the new stack is unaffected: resident opencode server green, `oc run`
smoke passes after the deletions.

## Acceptance criteria

- [x] `git tag` shows `claw-stack-final`; `git show claw-stack-final:client/claw-code/README.md` resolves (archive intact)
- [x] No process listening on `:11435`/`:4000`; launchd no longer lists the claw/litellm services
- [x] `git ls-files` shows no `client/claw-code`, `host/litellm`, claw grammar, or claw plists; wizard has no steps 48/49
- [x] Post-gut: resident opencode server `/health` green and one `oc run` smoke passes
- [x] READMEs updated (root + wizard) with decision-doc + tag pointers

## Blocked by

- #004
- #005
- #007

## Result

All five acceptance criteria verified on 2026-06-10. Changes are **staged,
not committed** (orchestrator commits at the tranche boundary).

### 1. Tag (archive)

Annotated tag `claw-stack-final` → pre-gut HEAD `8d6d93d` ("Record #004
daily-driver acceptance: GO"), message pointing at the decision doc.
Verified BEFORE any deletion:

```
$ git tag | grep claw
claw-stack-final
$ git show claw-stack-final:client/claw-code/README.md | head -1
# claw-code (containerised, points at the lab's bridge)
```

### 2. Services stopped (and how)

| service | how it was managed | how stopped | restart-at-login? |
|---|---|---|---|
| claw llama-server `:11435` | launchd `com.mac-llm-lab.llama-server` (pid 80680, RunAtLoad + KeepAlive) | `launchctl bootout gui/501/...` then `rm ~/Library/LaunchAgents/com.mac-llm-lab.llama-server.plist` | no — plist removed; nothing fought back (bootout removes the job, so KeepAlive can't respawn) |
| LiteLLM bridge `:4000` | docker compose (container `mac-llm-lab-litellm`, `restart: unless-stopped`, compose project at `host/litellm/`) — :4000 listener was OrbStack's port-forward | `docker compose down` from `host/litellm` (before deleting the dir): container + network removed | no — container gone |
| `claw-code` container | **investigated:** image `claw-code:local`, compose project from the older clone `~/Desktop/bench/lab/client/claw-code` → it IS the lab's claw client | `docker rm -f claw-code` | no. The `claw-code:local` **image was kept** — `host/test/Dockerfile` (harness, #010 scope) COPYs the claw binary from it |

After:

```
$ lsof -nP -iTCP:11435 -iTCP:4000 -sTCP:LISTEN   → no listeners
$ launchctl list | grep mac-llm-lab              → only com.mac-llm-lab.opencode-server (pid 31147)
$ ls ~/Library/LaunchAgents | grep mac-llm-lab   → only com.mac-llm-lab.opencode-server.plist
$ docker ps -a | grep -iE 'claw|litellm'         → none
```

### 3. Deleted (38 tracked files, all `git rm`-staged)

- `client/claw-code/` (7 files) + leftover gitignored `.env`
- `host/litellm/` (10 files) + leftover gitignored `.env`
- `host/llama-server/grammars/claw.gbnf`
- claw plists (5): `launchd/com.mac-llm-lab.llama-server{,-baseline,-qwen14,-qwen35,-qwen36}.plist`
- claw-only serving scripts (6): `host/llama-server/scripts/{install,install-qwen35,start,stop,status,logs}` — *judged inclusion*: not in the ticket's literal list, but each exclusively renders/boots the deleted plists+grammar (the claw production serving layer); `opencode-server` is self-contained
- wizard steps (5): `47-llama-server.sh` (read: claw-only, manages `:11435` — out), `48-build-litellm.sh`, `49-build-clawcode.sh`, `50-bringup.sh`, `60-smoke.sh`
- `wizard/templates/{claw-code,litellm}.env.template` (templates dir now gone)
- `wizard/lib/keys.sh` (`ensure_litellm_key` + `render_template` — zero callers post-gut)
- renamed: `wizard/steps/30-claw-code.sh` → `30-opencode-gate.sh` (gate kept, reworded to OpenCode)

### 4. Wizard edits (staged `M`)

- `wizard/wizard`: install flow = deps → 46 → 51 → 52/53/54 → 61 only; doctor
  lost `.env files` / claw+litellm container rows / `Bridge probe`; `test`
  modes now `docker|ollama` (default docker); keys.sh unsourced
- `wizard/steps/32-topology.sh`: BRIDGE_HOST/PORT + bridge probing removed
  (client-only host is step 52's `OPENCODE_HOST`)
- `wizard/lib/probe.sh`: only `probe_docker`/`probe_ollama` remain
- `wizard/tester/smoke.sh` + compose: modes `docker|ollama`, bridge/key env
  dropped (`HOST_GATEWAY` replaces `BRIDGE_HOST`); tester image rebuilt
- `wizard/tester/run-tests.sh`: claw-step tests removed (47/48/49/50-running,
  ensure_litellm_key, render_template, 60-smoke, bridge staging); new
  assertion: smoke.sh has no legacy bridge/models/deep modes. **Suite 75/75
  green** (was 92/92; net −17 claw tests)
- comment-only: steps 51/61, `lib/ui.sh`
- live `wizard/.state` (gitignored): stale `CLAW_REQUESTED`/`BRIDGE_*`/
  `LITELLM_MASTER_KEY` lines dropped

### 5. READMEs

- root `README.md`: stack paragraph + quickstart now OpenCode/`oc`; migration
  note linking the decision doc and the `claw-stack-final` tag; manual-setup
  list repointed (litellm/claw-code rows gone)
- `wizard/README.md`: rewritten for the opencode-only wizard; retirement note
  with decision-doc + tag pointers
- bonus (dangling-link fixes after the deletions): `host/README.md` one
  paragraph; `host/llama-server/README.md` got a RETIRED-STACK banner (body
  kept as historical reference; `opencode-server`/`models.conf`/templates
  current)

### 6. Post-gut smoke (new stack unaffected)

- resident daemon `:11436` `{"status":"ok"}`, launchd pid **31147 unchanged**
  throughout the gut
- `oc probe` → `probe PASS — agent system prompt contains 'Instructions
  from: /root/.config/opencode/AGENTS.md'`
- fresh `/tmp/gut-008-smoke.*` git repo, via the PATH symlink:
  `oc run "create a file named gutcheck.txt containing exactly
  POST-GUT-OK-008"` → artifact verified (`POST-GUT-OK-008`)
- full `./wizard/wizard install` (defaults): every step `already done`/green,
  step-61 smoke passed end-to-end (probe + `WIZARD-OC-SMOKE-46279` artifact)

### Intentionally REMAINING claw surface (#010 + noted follow-ups)

- `host/test/**` untouched: `lib/claw.js`, harness claw branches, drivers,
  `run-tier-eval.sh` (references the now-deleted `scripts/install`),
  `Dockerfile` (COPYs from the kept `claw-code:local` image), docs/registries
- `host/scripts/mac-llm-lab-hostctl` + `host/scripts/README.md` + chat-stack
  docs (`client/mac-llm-lab` `claw` profile, `host/ollama/Modelfiles/claw.Modelfile`,
  MANIFESTO/spec/research mentions) — chat-stack/hostctl claw profile is now
  dead but was not in this ticket's scope; flagged for #010 or a docs pass
- `host/llama-server/scripts/opencode-{grammar-active,toolcall}-probe.py`
  (grammar-ablation probes; reference the deleted `claw.gbnf` only as the
  optional `OPENCODE_USE_GRAMMAR` arm input)
