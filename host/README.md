# LLM Lab Host — Docker Stack & Deployment Runbook

Brings up Open WebUI on the target host and walks through first-time admin setup. Spec ref: [`spec.md` §13](../spec.md), steps 3–4.

> Run on the **64 GB target rig** with hostname `mac-llm-lab`. Assumes [`ollama/README.md`](ollama/README.md) is complete (Ollama running on `0.0.0.0:11434`, all profile models in place) and [`ollama/Modelfiles/README.md`](ollama/Modelfiles/README.md) has been applied (`general`, `fast`, `reasoning`, `digest`, `analyze` all show in `ollama list`).

---

## Read this first: first-signup-admin race

Open WebUI's first user account becomes admin automatically. **You must sign up before sharing `http://mac-llm-lab.local` with anyone.** If a guest hits the URL first, they become admin and see all admin functions.

Bring stack up → sign up immediately → configure groups + access → *then* hand the URL to guests.

---

## Prerequisites

| | |
|---|---|
| Ollama LAN-bound | `curl http://mac-llm-lab.local:11434/api/tags` returns JSON |
| Modelfile aliases applied | `ollama list` shows `general`, `fast`, `reasoning`, `digest`, `analyze` |
| Container runtime | OrbStack (recommended) or Docker Desktop |
| Free disk | ~5 GB for image + room for the named volume |

### Install OrbStack (recommended over Docker Desktop on Apple Silicon)

Download OrbStack from [orbstack.dev](https://orbstack.dev), drag to `/Applications`, launch it once. OrbStack is faster, lighter, and supports `host.docker.internal` natively. Docker Desktop also works — both are drop-in for our compose file.

---

## 1. Configure environment

```sh
cd host
cp .env.example .env
```

Open `.env` and confirm values. Defaults are fine for first boot. Leave `DEFAULT_GROUP_ID` blank — we'll fill it after creating the `Guests` group in step 4.

> `host/.env` is gitignored. It's where any future secrets (`WEBUI_SECRET_KEY` etc.) belong.

---

## 2. Bring up the stack

```sh
cd host
docker compose up -d
```

Wait ~30 seconds for the container to settle. Check health:

```sh
docker compose ps
# Expected: STATUS shows "Up X seconds (healthy)" once start_period elapses

curl -fsS http://localhost/health
# Expected: 200 OK with a JSON body

curl -fsS http://mac-llm-lab.local/health
# Expected: same. If this one fails, mDNS/firewall issue (see Troubleshooting).
```

If the container is stuck "starting" or "unhealthy" after a minute:
```sh
docker compose logs open-webui --tail 100
```

---

## 3. Sign up as admin (you, first)

> Do this **right now**, before sharing the URL.

1. Open `http://mac-llm-lab.local` in your browser.
2. Click **Sign up**.
3. Fill in name + email + password. Use a real email — the admin email is referenced for some flows (password resets, OAuth setup if added later).
4. The first account auto-becomes admin. You'll land in the chat UI.

Verify admin status:
- Top-right user menu → **Admin Panel** is visible.
- Settings → Users shows your account with role `admin`.

If you see "pending" or no admin panel, `DEFAULT_USER_ROLE` didn't take. Check `.env`, then `docker compose up -d --force-recreate`.

---

## 4. Configure groups + model access

### 4a. Create the `Guests` group

Admin Panel → **Groups** → **Create Group**:
- **Name:** `Guests`
- **Description:** `LAN guest accounts. Access general, fast, reasoning, digest, analyze; no admin functions.`

After creating, click into the group. The URL will be something like:
```
http://mac-llm-lab.local/admin/groups/01h...abc
                                  ^^^^^^^^ this is the group ID
```

Copy the ID.

### 4b. Wire `DEFAULT_GROUP_ID` so new signups auto-join

Edit `host/.env`:
```
DEFAULT_GROUP_ID=01h...abc
```

Apply:
```sh
docker compose up -d --force-recreate
```

(Container restart, ~10 seconds. State preserved in the volume.)

### 4c. Grant the Guests group access to all three profiles

Admin Panel → **Models** → for each of `general`, `fast`, `reasoning`, `digest`, `analyze`:
- Edit → **Visibility / Permissions** → add the `Guests` group.

Make sure no admin-only models leak to `Guests` (e.g. if you've pulled other models for testing, restrict them here).

### 4d. Configure each profile model

Admin Panel → **Models** → click `general`:
- **Description:** `Daily driver — chat, coding, debugging, quick answers. Vision-enabled.`
- **System prompt:** stub now, iterate later.
- **Capabilities:** vision **on**.

`fast`:
- **Description:** `Snappy triage — one-liners, quick lookups. MoE, no thinking.`
- **System prompt:** stub now.
- **Capabilities:** vision off; **thinking off** (per OWUI per-model toggle, since Qwen3.6 doesn't honor `/no_think`).

`reasoning`:
- **Description:** `Hard thinking — math, multi-step analysis, planning, evaluating tradeoffs.`
- **System prompt:** stub now.
- **Capabilities:** vision off (text-only model).

`digest`:
- **Description:** `Long-context extract — summarize / pull info from documents and codebases.`
- **System prompt:** stub now.
- **Capabilities:** vision off (text-only model).

`analyze`:
- **Description:** `Long-context reasoning — interpret / synthesize across the same scale of input.`
- **System prompt:** stub now.
- **Capabilities:** vision off (text-only model). Thinking on (default).

---

## 5. Acceptance smoke tests

### 5a. Self-test (you, signed in as admin)
1. Click model picker → select `general` → ask "Write a one-line bash to count files in cwd."
   - Expect: a clean one-liner.
2. Switch to `reasoning` → ask "A farmer has 17 sheep, all but 9 die — how many left? Show your work."
   - Expect: a `<think>...</think>` block, then **9** with reasoning visible.
3. Switch to `digest` → paste a few thousand lines of any text and ask "summarise the main points."
   - Expect: a coherent summary; no OOM or stall.
4. Switch to `analyze` → paste the same text and ask an interpretive question (e.g. "what assumption is this argument resting on?").
   - Expect: a `<think>...</think>` block, then a synthesis-style answer.
5. Switch to `fast` → ask "what's the bash one-liner to count files in cwd?"
   - Expect: instant answer (no `<think>` block, no preamble).
6. Attach a screenshot to a `general` chat → ask "what's wrong here?"
   - Expect: sensible response → spec §4.2 vision gate passes.

### 5b. Guest test (from another LAN device)
1. From your other laptop: `http://mac-llm-lab.local` → Sign up.
2. Confirm: lands in chat, **no** Admin Panel link, all five profiles visible in model picker.
3. Send a test message → response works.
4. Back on the admin device: Admin Panel → Users — confirm the new user is in the `Guests` group, role `user`.

### 5c. Restart survival
```sh
docker compose down
docker compose up -d
```
Sign back in → previous chats are still there. Volume persistence working.

### 5d. Sleep cycle (Mac sleep + wake)
Let the host sleep, wake it, hit `http://mac-llm-lab.local` from a guest → still works.
- If not: macOS Energy → "Wake for network access" should be on.

---

## Operations

### Daily operations
```sh
docker compose ps                # status
docker compose logs -f           # tail logs
docker compose restart           # restart without recreate (config from cache)
docker compose up -d --force-recreate   # apply .env changes
docker compose down              # stop (volume preserved)
docker compose down -v           # stops AND wipes volume — destroys all chats/users
```

### Promoting a second admin
Admin Panel → Users → click user → change role to `admin`. (Just a UI action, not env-config.)

### Adding a new profile
1. Add `host/ollama/Modelfiles/<name>.Modelfile`, run `ollama create <name>`.
2. OWUI Admin Panel → Models → the new alias appears automatically (Ollama autodiscovery).
3. Configure description, capabilities, group access as in step 4d.

### Updating Open WebUI
```sh
# Update the image tag in docker-compose.yml first, then:
docker compose pull
docker compose up -d
```
Bump the spec version reference and verify env-var compatibility before pinning a new tag.

---

## Operational warnings

- **Don't disable the LAN passport / network guard.** It's the only thing between the open internet and your unauthenticated `:11434` Ollama port. If the guard goes down, take the rig off the LAN until it's back.
- **macOS Application Firewall** may prompt on first inbound to `:80`. Approve once.
- **Ollama.app updates** can break chat-template behavior or env-var handling. Don't click "Update" on the menubar prompt while something is mid-flight; verify chat works after each update.
- **Don't run `docker compose down -v`** without intent. The `-v` wipes the named volume — every chat, user, and config gone.

---

## Troubleshooting

**`http://mac-llm-lab.local` works locally but not from another LAN device**
mDNS not propagating. Try:
- `ping mac-llm-lab.local` from the guest device first.
- If `ping` works but HTTP doesn't: macOS App Firewall is dropping `:80`. Approve in System Settings → Network → Firewall → Options.
- If `ping` fails too: LAN guest-isolation, mDNS reflector disabled, or guest on a different SSID. Use the DHCP-reserved IP as fallback.

**Container is "unhealthy"**
```sh
docker compose logs open-webui --tail 200
```
Most common causes: `OLLAMA_BASE_URL` wrong, Ollama not reachable, port :80 already in use by something else (`lsof -nP -iTCP:80 | grep LISTEN`).

**`OLLAMA_BASE_URL` connection refused from inside the container**
- Confirm Ollama is bound to `0.0.0.0:11434` not `127.0.0.1` — `lsof -nP -iTCP:11434 | grep LISTEN` should show `*:11434`.
- Confirm `host.docker.internal` resolves from inside: `docker compose exec open-webui getent hosts host.docker.internal`.

**Models not showing in OWUI picker**
- `ollama list` on the host shows them?
- OWUI Admin Panel → Settings → Models → does the Ollama connection light up?
- Try `docker compose restart open-webui` to retrigger autodiscovery.

**A guest accidentally became admin**
You shared the URL before signing up. Recovery:
- Sign in as that guest (ask for credentials, or inspect the volume), find your way to Admin → Users → demote them and promote yourself.
- Worst case: `docker compose down -v && up -d` wipes everything and you start fresh — disruptive, but absolute.

---

## Next

5. Host control script — [`scripts/mac-llm-lab-hostctl`](scripts/) (`up`, `down`, `status`, `warm`, `openui-url`).
6. Client CLI — [`../client/`](../client/) (`mac-llm-lab chat`, `mac-llm-lab warm`, `mac-llm-lab status`).
7. End-to-end acceptance — spec §13 step 7.

**For coding-stack users:** the OpenCode serving daemon lives in [`llama-server/`](llama-server/) and is installed by the wizard (`./wizard/wizard install`). It is independent of OWUI — you can skip it if you only need the chat UI. (The former claw-code/LiteLLM bridge stack is retired; see the root README's migration note and the `claw-stack-final` tag.)
