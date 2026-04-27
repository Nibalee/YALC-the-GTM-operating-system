# Alacient Agentic Core System

> A fully autonomous, multi-agent outbound system built for Alacient.
> Finds leads, enriches them, researches buying signals, writes personalised outreach, and handles replies — daily, without manual intervention.

---

## What This Is

The Alacient Agentic Core System is a purpose-built AI agent pipeline that runs Alacient's entire outbound motion. Every day at 09:00 it wakes up, finds companies that need agile transformation, researches each prospect, writes personalised LinkedIn and email messages grounded in their specific signals, dispatches outreach, and handles replies 24/7 through a persistent server layer.

Claude Code is the AI brain. The underlying GTM-OS engine handles all data operations — lead search, enrichment, campaign sequencing, CRM sync. No separate Anthropic API key required for the daily pipeline.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAPERCLIP (Orchestration)                     │
│   Ticket bus · org chart · budgets · approval gates · audit log │
└──────────────────────────┬──────────────────────────────────────┘
                           │ tickets
           ┌───────────────┼───────────────────┐
           ▼               ▼                   ▼
   09:00 DAILY        18:00 LEARN         ON DEMAND
   PIPELINE           CYCLE               NEGOTIATOR
   │
   └── Orchestrator → Prospector → Enricher
                      → Intelligence Collector
                      → Copywriter → Dispatcher
                         │               │
                    LinkedIn           Email
                    (Unipile)        (Instantly)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALWAYS-ON (OpenClaw daemon — Slack, Discord, WhatsApp, Teams)
   │
   ├── Inbound: Unipile + Instantly webhooks → intent classifier
   │   ├── OOO / Unsub / Bounce → auto-handled (no AI)
   │   └── Interested / Question → Negotiator ticket (Paperclip)
   │
   └── Two-way: "pipeline status?" in Slack → live reply from agents
```

Full architecture: [`docs/AGENTIC-SYSTEM.md`](docs/AGENTIC-SYSTEM.md)
OpenClaw + Paperclip integration plan: [`docs/INTEGRATION-PLAN.md`](docs/INTEGRATION-PLAN.md)

---

## Agents

| Agent | Role | Runs |
|---|---|---|
| **Orchestrator** | Daily strategy, delegates to all others | 09:00 daily |
| **Prospector** | Crustdata search, dedup, initial filter | Inside daily pipeline |
| **Enricher** | FullEnrich email/phone, LinkedIn confirm | Inside daily pipeline |
| **Intelligence Collector** | Per-lead research: posts, jobs, news, tech stack | Inside daily pipeline |
| **Copywriter** | Personalised messages from Obsidian vault + lead intel | Inside daily pipeline |
| **Outreach Dispatcher** | Creates campaign, fires connects + email sequences | Inside daily pipeline |
| **Negotiator** | Handles interested/question replies, drafts responses | On-demand, per reply |
| **Learning Agent** | Updates intelligence store + Obsidian vault from outcomes | 18:00 daily |

---

## ICP — Who We Target

**Primary:** CTOs, VPs Engineering, Heads of Engineering at SaaS/tech companies (100–1,000 employees, Series A–C) where engineering growth has outpaced process maturity.

**Secondary:** CPOs, COOs, Digital Transformation leads at traditional companies (500–5,000 employees) going through digital transformation.

**Signals we look for:**
- Hiring Scrum Masters, Agile Coaches, Engineering Managers
- LinkedIn posts about delivery challenges, sprint failures, team scaling
- Series A/B/C funding (scaling pressure)
- New CTO or CPO in post (change agenda)
- Post-acquisition or merger (process alignment need)
- Digital transformation announcements

Full signal definitions: [`templates/icp-config.yaml`](templates/icp-config.yaml)

---

## Outreach Channels & Sequence

**LinkedIn** (primary):
- Day 0: Connection request with personalised note (< 300 chars)
- Day +2: DM 1 after connect accepted (< 80 words)
- Day +5: DM 2 if no reply (new angle, offer content)

**Email** (parallel, same day as LinkedIn connect):
- Day 0: Email 1 (4 sentences, plain text)
- Day +4: Email 2 follow-up (Re: same thread)
- Day +10: Email 3 breakup

Rate limits enforced: 30 LinkedIn connects/day hard cap. All messages pass validation before send.

---

## Knowledge Layer — Obsidian Vault

Every agent queries the Obsidian vault at runtime via semantic search. The vault contains:

```
00_System/Agents/       Agent playbooks (what each agent does, how)
01_Company/             Brand voice, value propositions, objection handling, case studies
02_Clients/Alacient/    ICP definition, campaign history, winning messages
03_Intelligence/        Channel insights, timing patterns, reply examples
```

The vault syncs automatically — save a note in Obsidian, agents pick it up within 30 seconds.

Vault starter: [`templates/obsidian-vault/`](templates/obsidian-vault/)

---

## Notifications — Slack / Discord

Every agent posts to Slack or Discord at every meaningful event. The team always knows what's happening without opening a dashboard.

| Event | Channel |
|---|---|
| Daily pipeline complete (leads found, connects sent) | `#alacient-pipeline` |
| New qualifying reply received | `#alacient-replies` |
| Meeting booked | `#alacient-wins` |
| Reply flagged for human review | `#alacient-review` |
| Daily intelligence digest | `#alacient-pipeline` |
| Provider error or pipeline failure | `#alacient-alerts` |

Set up: create an incoming webhook in Slack or Discord, add the URL to `~/.gtm-os/.env` as `SLACK_WEBHOOK_URL` (or `DISCORD_WEBHOOK_URL`), and add it to `config.yaml`. Full setup in [`docs/RENNA-GETTING-STARTED.md`](docs/RENNA-GETTING-STARTED.md).

---

## Getting Started

**For Renna (system operator):** [`docs/RENNA-GETTING-STARTED.md`](docs/RENNA-GETTING-STARTED.md)

**API keys needed:**

| Provider | What it does | Required? |
|---|---|---|
| Crustdata | Lead search + company enrichment | Yes |
| Unipile | LinkedIn connects + DMs | Yes |
| FullEnrich | Email + phone finder | Yes |
| Instantly | Cold email sequences | Yes |
| Notion | CRM sync | Optional |

No Anthropic API key needed for the daily pipeline — Claude Code is the AI layer.

---

## Configuration Files

| File | What it controls |
|---|---|
| `templates/icp-config.yaml` | ICP definition, signals, scoring, sequence timing, copy rules |
| `templates/framework.yaml` | Full GTM framework — positioning, segments, voice, signals |
| `templates/qualification-rules.md` | 7-gate lead qualification pipeline rules |
| `templates/adapters.yaml` | Obsidian vault sync configuration |

Copy these to `~/.gtm-os/tenants/alacient/` and fill in before first run.

---

## CLI Reference

The system is operated through Claude Code conversations. The CLI handles data operations:

```bash
# Check system health
npx tsx src/cli/index.ts -t alacient doctor

# Sync Obsidian vault after edits
npx tsx src/cli/index.ts -t alacient context:sync

# Check active campaigns
npx tsx src/cli/index.ts -t alacient campaign:status

# Run campaign tracker manually
npx tsx src/cli/index.ts -t alacient campaign:track --dry-run

# List qualified leads
npx tsx src/cli/index.ts -t alacient leads:list

# Check provider status
npx tsx src/cli/index.ts -t alacient provider:list
```

All commands that send or write support `--dry-run`. Full command reference: [`docs/commands.md`](docs/commands.md)

---

## Running the Always-On Server

The Hono server handles inbound replies 24/7 via webhooks from Unipile and Instantly.

```bash
# Install PM2
npm install -g pm2

# Start the server
pm2 start "npx tsx src/lib/server/index.ts" --name alacient-core
pm2 save
pm2 startup

# View the review dashboard
open http://localhost:3847/review
```

Register webhooks:
- Unipile → `POST http://your-server:3847/api/inbound/unipile`
- Instantly → `POST http://your-server:3847/api/inbound/instantly`

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/AGENTIC-SYSTEM.md`](docs/AGENTIC-SYSTEM.md) | Full architecture with Mermaid diagrams — all agents, data flow, context flow, lead lifecycle |
| [`docs/INTEGRATION-PLAN.md`](docs/INTEGRATION-PLAN.md) | OpenClaw + Paperclip integration — multi-agent communication, org chart, ticket schemas, 6-phase rollout |
| [`docs/RENNA-GETTING-STARTED.md`](docs/RENNA-GETTING-STARTED.md) | Step-by-step operator setup guide |
| [`templates/icp-config.yaml`](templates/icp-config.yaml) | ICP and signal definitions — edit when targeting changes |
| [`templates/obsidian-vault/README.md`](templates/obsidian-vault/README.md) | Vault structure and setup instructions |
| [`docs/providers.md`](docs/providers.md) | Provider API key setup |
| [`docs/commands.md`](docs/commands.md) | Full CLI command reference |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common errors and fixes |

---

## Key Guardrails

- **30 LinkedIn connects/day** — hard cap enforced by rate limiter, never exceeded
- **All messages validated** before send — outbound validator blocks rule violations
- **Never contact replied leads** — sequence engine checks reply status before every action
- **Human review gate** — leads with ICP score > 85 held for approval before first contact
- **Intent classifier first** — simple replies (OOO, unsubscribe, bounce) handled without AI, never reaching the Negotiator

---

*Alacient Agentic Core System — Built on GTM-OS*
