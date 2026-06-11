# Manifesto

## Why this exists

A single LLM is a primitive. It is closer to a brain in a jar than a tool — pattern-matching, hallucinatory, with no memory and no agency. What people actually love — ChatGPT, Claude Code — is not "a model." It is an architecture: many models, retrieval, tools, routers, sidecars, agentic loops. The model is one neuron in a larger nervous system.

The frontier hides this. Consumers see a chat box and infer that "the model" is the product. So when they meet a local 30B Qwen they ask it to behave like a hosted system, are disappointed when it can't, and conclude small LLMs are toys.

**This project is the counter-argument.** On a single Apple Silicon Mac, with one model resident at a time, we build the architecture around the model: task-specific profile swaps, a long-context summarizer, a thinking-mode reasoner, an agentic coding loop on a local model, all behind a shared LAN UI. Small open models, well-orchestrated, are insanely useful — and most of the leverage was always in the orchestration, not the parameter count.

## Three reasons it matters

### 1. Democratization & education

A 64 GB Apple Silicon laptop is not a frontier datacenter, but it can run real, useful models — and a 16 GB MacBook Air is now within striking distance of capability that, a generation ago, lived behind an API key and a credit card. The point is to make that real, not theoretical.

This repo supports **16 GB, 32 GB, and 64 GB** — same architecture, profile sets tuned to each budget. The 64 GB rig (M5 Max Pro) is the development reference because it's the hardware on hand. Anyone with the laptop they already own can stand the rig up and learn by running it.

LLMs are about to be the substrate of how knowledge work happens. They should not be a thing you only get to touch through someone else's billing portal.

### 2. Resilience & sovereignty

Cloud LLMs assume good network, good power, and a friendly relationship with the vendor. Local inference assumes none of those.

A laptop with weights on disk and the Ollama runtime cached works:

- **Offline.** Travel, transit, planes, the field.
- **Grid-down or degraded.** Power outage, ISP outage, cell-tower congestion, disaster scenarios.
- **In hostile or non-permissive environments.** Places where the cloud provider is the threat model: blocked networks, surveilled networks, regulated jurisdictions, journalism, dissent.
- **For home automation and edge compute.** A local box on the LAN can drive smart-home reasoning without round-tripping every event to a third party.

On-edge compute is the only kind of compute you actually own. This rig is built so the LLM goes where you go, runs when the network can't, and answers to no one but the person whose laptop it lives on.

### 3. Architecture, not just inference

The mission isn't "run a model." It's to ship two real **products** built from a team of small specialists, on hardware you already own:

- **`chat`** — 100% local ChatGPT. Ask a question, get a grounded answer, optionally over your own corpus.
- **`code`** — 100% local Claude Code. An agentic coding loop with tools, file edits, and multi-turn work, via [OpenCode](https://github.com/sst/opencode) talking to a local model.

The pattern under both is a **multi-net architecture** — a team of small specialists, not one giant model. A typical `chat` request flows router → optional query rewrite → embedder → vector search → reranker → reasoning LLM → answer; cheap stages do most of the work, and the one expensive stage (the reasoning LLM) is where extra memory pays off. Profiles swap into that reasoning stage by task — `general`, `fast`, `reasoning`, `digest`, `analyze` — each the right model for the job, not a finetune of one base.

The same shape compresses across tiers. At 64 GB the reasoning stage is a 27–49B model behind Open WebUI; at 16 GB it's a ~7 GB sidecar — Qwen2.5-7B Q4 reasoning, nomic embed, bge reranker, sqlite-vec store, ~200 lines of glue. Same architecture, different budget. That stack — multi-net + agent + retrieval — is the same general shape the hosted products use. Doing it locally with small open models is the proof.

## A frontier lab in a box

This project is built by an autonomous agent swarm — research, evals, specs, code — with the human as director rather than coder. The swarm runs on Claude Opus 4.7 today, not on the local rig itself. The artifacts (calibrated tier-stratified evals, sampler sweeps, internal proposals signed under autonomous-research mandate) live in [`host/test/docs/`](host/test/docs/).

That's why `code` matters as a product. A 100% local Claude Code harness is the substrate for an eventually-100%-local research loop. The agents drafting this manifesto are Opus; the goal is the day they're a team of small specialists running on the laptop they're optimizing.

## What this project actually is

A reference build, fully spec'd, fully reproducible:

- **Host:** Ollama native on Apple Silicon for unified-memory throughput; one profile resident at a time.
- **UI:** Open WebUI in Docker, bound to LAN port 80 via mDNS (`mac-llm-lab.local`), with per-user accounts and a `Guests` group.
- **Agentic coding:** OpenCode in Docker, driving a launchd-resident llama-server (OpenAI-compatible) via the `oc` wrapper CLI.
- **Five profiles:** see [`profiles.md`](profiles.md) for the model picks, quants, and `num_ctx` settings; [`spec.md`](spec.md) for the architecture.
- **Phased roadmap:** MVP first, then Wake-on-LAN + Tailscale remote HTTPS, then RAG sidecars and curated corpora, then self-hosted search, then hardening.

You can fork it, rebrand it (see the README's fork checklist), and run it on your own LAN. That's the point.

## What this project is not

- Not a model release. We don't train.
- Not a frontier-capability claim. Nemotron 49B isn't GPT-5. The claim is that 49B + the right architecture is *enough* for an enormous fraction of real work.
- Not closed. MIT-licensed, and meant to be copied, modified, and used.
- Not a cloud product. The whole point is that it isn't.

## The bet

Most of the value people get from frontier AI today comes from architectures that small, local, open models can also be slotted into. The remaining gap closes every quarter. Build the architecture now, on hardware you already own, on a model you can read the weights of, and the next time the network goes down — or the vendor changes the rules — you still have the tools.
