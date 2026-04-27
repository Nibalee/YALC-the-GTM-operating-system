# Alacient Agentic Core System — Getting Started (Renna)

> Step-by-step setup guide for operating the Alacient Agentic Core System.
> Work through these phases in order. Each phase builds on the previous one.
> Estimated total time: **2–3 hours** (most of it waiting for account approvals).

---

## Phase 1 — Create Your Accounts First

Do this before anything else. Some accounts take hours to approve. Start them now so they're ready when you need them.

### 1.1 Crustdata — Lead Search & Enrichment

**What it does:** Finds companies and people matching Alacient's ICP. This is how the system discovers leads.

- Sign up at: https://crustdata.com/dashboard/api
- Go to your dashboard → API Keys → create a key
- Copy and save it somewhere safe: `CRUSTDATA_API_KEY=...`

---

### 1.2 Unipile — LinkedIn Outreach

**What it does:** Sends LinkedIn connection requests and DMs on behalf of Alacient. You connect your LinkedIn account through their platform.

- Sign up at: https://www.unipile.com
- Connect a LinkedIn account through the Unipile dashboard
- Go to Settings → API → copy both values:
  - `UNIPILE_API_KEY=...`
  - `UNIPILE_DSN=...` (looks like `https://api3.unipile.com:13XXX`)

> **Important:** The LinkedIn account you connect here is the one that will send connection requests and DMs. It should be an Alacient employee's real account — not a throwaway.

---

### 1.3 FullEnrich — Email & Phone Finder

**What it does:** Finds work email addresses and phone numbers for each lead.

- Sign up at: https://fullenrich.com
- Go to API → create a key
- Copy and save: `FULLENRICH_API_KEY=...`

---

### 1.4 Instantly — Cold Email

**What it does:** Sends and tracks cold email sequences.

- Sign up at: https://instantly.ai
- Connect at least one sending email account in their dashboard (they have guides for this)
- Go to Settings → API → copy: `INSTANTLY_API_KEY=...`

> **Before this works for email:** You need to warm up the sending email account in Instantly first. This takes 2–4 weeks if starting from scratch. If you already have a warmed account, you can use it immediately.

---

### 1.5 Notion — CRM Sync (Optional)

**What it does:** Syncs leads and campaign results to a Notion database. Skip this if you don't use Notion yet.

- Go to: https://www.notion.so/my-integrations
- Create a new integration → give it a name → copy the key: `NOTION_API_KEY=...`
- Share your Notion databases with this integration (Notion has a guide for this)

---

## Phase 2 — Install the System

### 2.1 Prerequisites

Make sure you have Node.js installed. Check by running in your terminal:

```bash
node --version
```

Should show v18 or higher. If not, download from https://nodejs.org.

---

### 2.2 Clone the Repository

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
npm install
```

---

### 2.3 Create Your Environment File

Create the file `~/.gtm-os/.env` (this is in your home folder, not the project folder):

```bash
mkdir -p ~/.gtm-os
```

Then create the file with your API keys:

```
# ~/.gtm-os/.env
# Paste in the keys you collected in Phase 1

CRUSTDATA_API_KEY=your-key-here
UNIPILE_API_KEY=your-key-here
UNIPILE_DSN=https://api3.unipile.com:13XXX
FULLENRICH_API_KEY=your-key-here
INSTANTLY_API_KEY=your-key-here
NOTION_API_KEY=your-key-here        # only if using Notion

# Generate this yourself (random security token for the server):
GTM_OS_API_TOKEN=paste-a-random-string-here
```

To generate a random token for `GTM_OS_API_TOKEN`, run:
```bash
openssl rand -hex 32
```

---

### 2.4 Set Up the Alacient Tenant

```bash
npx tsx src/cli/index.ts -t alacient start
```

This will walk you through a short setup wizard. When it asks about company context, answer with Alacient's details:
- Company: Alacient
- Website: https://alacient.com
- Service: Agile methodology and transformation consulting
- ICP: CTOs and VPs Engineering at scaling SaaS companies (100–1000 employees)
- Channels: LinkedIn + email

When the wizard finishes, it creates `~/.gtm-os/tenants/alacient/` with generated config files.

---

### 2.5 Replace the Generated Files with the Alacient Templates

The templates in this repository have Alacient's ICP, signals, and copy rules pre-configured. Replace the generated files with these:

```bash
# Copy the pre-configured templates
cp templates/framework.yaml ~/.gtm-os/tenants/alacient/framework.yaml
cp templates/icp-config.yaml ~/.gtm-os/tenants/alacient/icp-config.yaml
cp templates/qualification-rules.md ~/.gtm-os/tenants/alacient/qualification-rules.md
cp templates/adapters.yaml ~/.gtm-os/tenants/alacient/adapters.yaml
```

---

### 2.6 Check Everything Works

```bash
npx tsx src/cli/index.ts -t alacient doctor
```

You should see green checkmarks for every provider key you added. Any orange circles mean that provider isn't configured — that's fine, just means those features aren't active yet.

---

## Phase 3 — Set Up Obsidian

### 3.1 Create the Vault Structure

Copy the starter vault from the repository into your Obsidian vault:

```bash
cp -r templates/obsidian-vault/* /path/to/your/ObsidianVault/
```

Replace `/path/to/your/ObsidianVault/` with the actual path to your Obsidian vault folder. If you don't have one yet, create a folder anywhere and open it as a vault in the Obsidian app.

---

### 3.2 Point the Adapter at Your Vault

Open `~/.gtm-os/tenants/alacient/adapters.yaml` and update the `base_dir` line:

```yaml
base_dir: "/Users/yourname/ObsidianVault"   # ← change this to your actual vault path
```

---

### 3.3 Fill In the Vault Content

The templates have placeholder content. Before the first run, fill these in with real Alacient information:

**Must fill in before first run:**

| File | What to add |
|---|---|
| `01_Company/Brand_Voice.md` | Alacient's actual tone, language preferences, proof points with real numbers |
| `01_Company/Value_Propositions.md` | Real value props for each ICP segment — use actual client quotes or results |
| `01_Company/Objection_Handling.md` | Review the pre-filled responses — adjust to match how Alacient actually talks |
| `02_Clients/Alacient/ICP.md` | Review the ICP definition — add any specific target accounts or exclusions |

**Can fill in later (system will start populating these as campaigns run):**

- `03_Intelligence/Channel_Insights.md` — the Learning Agent writes here daily
- `02_Clients/Alacient/Winning_Messages.md` — populated from real replies

---

### 3.4 Sync the Vault into the Memory Store

```bash
npx tsx src/cli/index.ts -t alacient context:sync
```

This reads all the markdown files, chunks them, embeds them, and makes them searchable. Run this again any time you add new content to the vault.

After this, the vault is live-watched — saves in Obsidian are picked up automatically within 30 seconds.

---

## Phase 4 — Set Up Slack (or Discord)

Every agent posts to Slack when something happens — pipeline complete, reply received, meeting booked, review needed. You'll always know what the system is doing without opening a dashboard.

### Option A — Slack

1. Go to `https://api.slack.com/apps` → **Create New App** → **From scratch**
2. Name it `Alacient Core` → pick your workspace → Create
3. Left sidebar → **Incoming Webhooks** → toggle **Activate** → **Add New Webhook to Workspace**
4. Choose the channel (e.g. `#alacient-pipeline`) → Allow → copy the webhook URL
5. Repeat for `#alacient-replies` and `#alacient-wins` if you want separate channels
6. Add to `~/.gtm-os/.env`:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```

### Option B — Discord

1. In Discord: open the channel you want → **Settings** → **Integrations** → **Webhooks** → **New Webhook**
2. Name it `Alacient Core` → copy the webhook URL
3. Add to `~/.gtm-os/.env`:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
   ```

### Add Webhook to Tenant Config

Open `~/.gtm-os/tenants/alacient/config.yaml` and add:

```yaml
slack:
  webhook_url: "https://hooks.slack.com/services/..."   # or your Discord URL
  notify_on:
    - reply
    - demo_booked
    - campaign_completed
    - winner_declared
```

---

## Phase 5 — Start the Always-On Server

The server handles inbound replies 24/7. It needs to run as a background process that survives machine restarts.

### 4.1 Install PM2

PM2 is a process manager that keeps the server running:

```bash
npm install -g pm2
```

### 4.2 Start the Server

```bash
pm2 start "npx tsx src/lib/server/index.ts" --name gtm-os-server
pm2 save
pm2 startup   # follow the printed instructions to make it survive restarts
```

Check it's running:
```bash
pm2 status
```

You should see `gtm-os-server` with status `online`.

---

### 4.3 Register Webhooks

**In Unipile dashboard:**
- Go to Settings → Webhooks
- Add webhook URL: `http://your-server-ip:3847/api/inbound/unipile`
- Event: `message.received`

**In Instantly dashboard:**
- Go to Settings → Integrations → Webhooks
- Add webhook URL: `http://your-server-ip:3847/api/inbound/instantly`
- Event: `reply.received`

> **Note:** If running locally, the server is only reachable from your machine. For 24/7 reply handling, the server needs to be on a machine that's always on and reachable from the internet — a cheap VPS (DigitalOcean, Hetzner) works. Alternatively, use ngrok during testing: `ngrok http 3847`.

---

## Phase 6 — Schedule the Daily Agents

This is how the system runs every day without anyone pressing a button.

Open Claude Code and type:

```
/schedule
```

**Schedule 1 — Daily Pipeline (09:00 weekdays):**
- Cron: `0 9 * * 1-5`
- Prompt: `"Run the Alacient daily lead gen pipeline for tenant alacient: prospect 60 leads matching the ICP in icp-config.yaml, enrich, research each lead's signals, write personalised copy, create campaign and dispatch. Post summary to Slack when done."`

**Schedule 2 — Learning Agent (18:00 weekdays):**
- Cron: `0 18 * * 1-5`
- Prompt: `"Run the Alacient learning cycle for tenant alacient: read today's campaign results, extract intelligence patterns, update the intelligence store, write learnings to the Obsidian vault, post daily digest to Slack."`

After setting these up, the pipeline fires every weekday morning automatically. You don't need to do anything.

---

## Phase 7 — Test Before the First Real Run

Run a dry-run that doesn't actually send anything:

### 5.1 Test Lead Search

```bash
npx tsx src/cli/index.ts -t alacient orchestrate "find 5 CTOs at UK SaaS companies with 100-500 employees" --dry-run
```

This should return 5 sample leads without saving them. If it errors, check your Crustdata key.

### 5.2 Test the Provider Chain

```bash
npx tsx src/cli/index.ts -t alacient provider:list
```

Shows all configured providers and their status. Should show Crustdata, FullEnrich, Unipile, and Instantly as active.

### 5.3 Test the Vault Retrieval

Ask Claude Code (this session) to query the vault:

> "Query the GTM-OS memory store for alacient with the query 'Series B CTO agile pain LinkedIn' and show me the top 3 results"

If you get back relevant chunks from the vault files you filled in, the context system is working.

---

## Phase 8 — First Real Pipeline Run

When Phases 1–5 are complete, tell me in Claude Code:

> "Run the first lead gen pipeline for Alacient. Target 20 leads to start — Engineering leaders at UK SaaS companies with 100-500 employees. Use the hiring signal focus (companies hiring Scrum Masters or Engineering Managers)."

I will:
1. Check the provider status
2. Run the Prospector → Enricher → Intelligence Collector → Copywriter chain
3. Show you the leads and copy before dispatching anything
4. Wait for your approval on the first batch before sending any connects or emails

**Start with 20 leads, not 60.** Review the first batch manually — make sure the targeting is right and the copy sounds like Alacient before scaling up.

---

## Phase 9 — Daily Operations (After First Run)

Once the first run is approved and live:

### What Runs Automatically (nothing required from you)

| What | When | How it runs |
|---|---|---|
| Daily lead gen pipeline | 09:00 weekdays | `/schedule` RemoteTrigger → Claude Code |
| Learning + intel update | 18:00 weekdays | `/schedule` RemoteTrigger → Claude Code |
| Campaign sequence tracker | Every 6 hours | launchd cron → CLI |
| Inbound reply routing | Instant on webhook | PM2 server → intent classifier |
| OOO / unsub / bounce handling | Instant | PM2 server inline |
| Negotiator (interested replies) | Within 30 sec of reply | PM2 server → RemoteTrigger → Claude Code |
| Slack/Discord notifications | Every event | Agents + server |

### What Needs You

| What | When | How |
|---|---|---|
| High-value reply approval | When Slack flags it | Open `http://your-server:3847/review` |
| Updating ICP or signals | When targeting changes | Edit `icp-config.yaml` or Obsidian vault → `context:sync` |
| Adding case studies / winning copy | After good campaigns | Add note to Obsidian vault → auto-syncs |
| Weekly strategy check | Weekly | Ask Claude Code: "How is the Alacient pipeline performing this week?" |

### The Review Dashboard

Open in your browser: `http://localhost:3847/review`

This shows leads and replies flagged for human review before action is taken. Check it daily when campaigns are active.

---

## Quick Reference — Commands to Know

```bash
# Check system health
npx tsx src/cli/index.ts -t alacient doctor

# Re-sync Obsidian vault after edits
npx tsx src/cli/index.ts -t alacient context:sync

# Check active campaigns
npx tsx src/cli/index.ts -t alacient campaign:status

# Manually run the campaign tracker
npx tsx src/cli/index.ts -t alacient campaign:track --dry-run

# List all qualified leads
npx tsx src/cli/index.ts -t alacient leads:list

# Check server is running
pm2 status

# View server logs (if something looks wrong)
pm2 logs gtm-os-server
```

---

## If Something Doesn't Work

1. Run `npx tsx src/cli/index.ts -t alacient doctor` — it tells you exactly what's wrong
2. Check `pm2 logs gtm-os-server` for server errors
3. Check the API key is correct in `~/.gtm-os/.env` (no extra spaces, no quotes around the value)
4. Check docs at `docs/troubleshooting.md`
5. Ask Claude Code: "The [command] is failing with [error] — help me debug it"

---

## What You'll Need Ready Before Starting

Gather these before Phase 1:

- [ ] A LinkedIn account for outreach (real Alacient account — not personal)
- [ ] A warmed sending email address for cold email (or plan to warm one via Instantly)
- [ ] Alacient's real proof points with numbers (for `Brand_Voice.md` and `Value_Propositions.md`)
- [ ] 2–3 real case study examples with outcomes (for `01_Company/Case_Studies/`)
- [ ] A machine that can run the server 24/7 (your main laptop works for testing, a VPS for production)
- [ ] Credit card for API providers (Crustdata, Unipile, FullEnrich, Instantly all have paid plans)

---

*Alacient Agentic Core System — April 2026 | For questions, ask in the Claude Code session.*
