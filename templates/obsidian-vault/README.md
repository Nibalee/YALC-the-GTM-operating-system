# GTM-OS Obsidian Vault — Starter Template

This folder contains the starter structure for your GTM-OS Obsidian vault.
Copy the entire folder into your Obsidian vault and fill in the blanks.

## Folder Map

```
ObsidianVault/
├── 00_System/
│   └── Agents/
│       ├── Orchestrator.md          Daily strategy logic — READ ONLY (agent reference)
│       ├── Prospector.md            Lead finding playbook — READ ONLY
│       ├── Intelligence_Collector.md  Research playbook — READ ONLY
│       ├── Copywriter.md            Message writing rules — EDIT TO TUNE COPY
│       └── Negotiator.md            Reply handling flows — EDIT TO TUNE RESPONSES
│
├── 01_Company/
│   ├── Brand_Voice.md               EDIT — your tone, language rules, proof points
│   ├── Value_Propositions.md        EDIT — your value props by audience
│   ├── Pain_Points/                 ADD — one file per pain point you solve
│   │   └── [Pain_Type].md
│   ├── Case_Studies/                ADD — one file per client case study
│   │   └── [Client_Name].md
│   └── Objection_Handling.md        EDIT — your objection responses
│
├── 02_Clients/
│   └── Alacient/                    RENAME this folder per client
│       ├── ICP.md                   EDIT — who to target, signals, exclusions
│       ├── Campaign_History.md      Updated by Learning Agent
│       └── Winning_Messages.md      Populated as campaigns run
│
└── 03_Intelligence/
    ├── Channel_Insights.md          Updated daily by Learning Agent
    ├── Timing_Insights.md           Updated weekly
    └── Reply_Patterns/              Add real reply examples here
        ├── Positive_Examples.md
        └── Negotiation_Flows.md
```

## What to Edit Before First Run

1. **`01_Company/Brand_Voice.md`** — Fill in your actual tone, language rules, and proof points
2. **`01_Company/Value_Propositions.md`** — Fill in value props for each target audience
3. **`01_Company/Objection_Handling.md`** — Fill in your objection responses
4. **`02_Clients/{Client}/ICP.md`** — Fill in who you're targeting and the signals
5. **`00_System/Agents/Copywriter.md`** — Review and adjust copy rules to match your voice

## What the System Fills In

- `03_Intelligence/Channel_Insights.md` — updated daily as campaigns run
- `02_Clients/{Client}/Campaign_History.md` — updated by Learning Agent
- `02_Clients/{Client}/Winning_Messages.md` — populated from successful campaigns

## Frontmatter Convention

Every note should have:

```yaml
---
agent: orchestrator | prospector | intelligence-collector | copywriter | negotiator
segment: engineering-leader-scaling | product-digital-transformation | all
topic: brief-topic-slug
confidence: hypothesis | validated | high
---
```

This dramatically improves retrieval precision — each agent gets the right chunks.
