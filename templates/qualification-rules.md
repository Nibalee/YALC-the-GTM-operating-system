# Qualification Rules — Alacient
<!-- Copy to: ~/.gtm-os/tenants/alacient/qualification-rules.md -->
<!-- These rules govern the 7-gate qualification pipeline. -->
<!-- Edit signals and thresholds here when targeting criteria change. -->

## Pipeline Overview

Leads pass through 7 gates in strict order. Failing any gate stops processing.
Each gate logs: name, leads in, leads out, duration, failure reason.

---

## Gate 1 — Dedup

**Purpose:** Prevent contacting the same person twice.

**Rules:**
- Check against existing leads in DB by: LinkedIn URL, email, (first name + last name + company domain)
- If match found with any lifecycle status except `Dropped` or `Snoozed` → reject
- If match is `Snoozed` → check snooze date. If expired → allow back through
- Log rejection reason: `duplicate_linkedin` | `duplicate_email` | `duplicate_name_company`

---

## Gate 2 — Headline Filter

**Purpose:** Fast title/seniority pre-filter before expensive enrichment.

**Pass criteria (at least ONE must match):**

```
Titles that PASS:
  - CTO | Chief Technology Officer
  - VP Engineering | VP of Engineering
  - Head of Engineering | Director of Engineering
  - CPO | Chief Product Officer | VP Product | Head of Product
  - COO | Chief Operating Officer
  - Chief Digital Officer | CDO
  - Head of Digital Transformation
  - Head of Delivery | VP Delivery
  - Technical Programme Manager (senior)

Title patterns that AUTO-FAIL:
  - Intern | Junior | Associate | Coordinator
  - Sales | Marketing | Finance | Legal | HR | Recruiter
  - Consultant (external — they are not buyers)
  - Student | Graduate
```

**Company size pre-filter (fail if):**
- Fewer than 100 employees AND no funding signal
- More than 10,000 employees

---

## Gate 3 — Exclusion

**Purpose:** Remove competitors, bad-fit companies, and blocklisted contacts.

**Auto-fail if company matches:**
```
Competitor / same space:
  - Domain contains: agilecoach, scrummaster, agile-consulting, agilecentre
  - Company name contains: "Agile Consulting", "Scrum Training", "SAFe Consulting"
  - Listed as: staffing agency, IT recruitment, headhunting

Blocklist:
  - Any domain in do_not_contact_domains list in icp-config.yaml
  - Any lead who previously unsubscribed
  - Any lead who responded negatively in a prior campaign
```

**Auto-fail if contact matches:**
```
  - Email domain is personal (gmail, hotmail, yahoo, outlook personal)
  - LinkedIn profile is incomplete (< 100 connections, no headline)
```

---

## Gate 4 — Company Signal Check

**Purpose:** Confirm company-level signals before spending enrichment credits.

**Pass criteria — company must show at least ONE:**

```
Funding signals (weight 4):
  - Raised Series A, B, or C in the last 24 months
  - PE-backed with active growth mandate
  - IPO in last 3 years (post-IPO scaling)

Growth signals (weight 4):
  - Headcount grew > 30% in the last 12 months (via LinkedIn)
  - Actively hiring 3+ engineering roles simultaneously
  - Hiring Scrum Master, Agile Coach, or Engineering Manager

Event signals (weight 4):
  - Acquisition or merger in the last 18 months
  - New CTO or CPO hired in the last 12 months
  - Digital transformation announcement in press

Tech/process signals (weight 2):
  - Job posting mentions: SAFe, Scrum, agile transformation, sprint
  - Job description requires: Jira, Azure DevOps, Linear experience
  - Engineering blog posts about delivery or process

Industry fit (weight 3 — bonus, not required):
  - SaaS / software product company
  - FinTech with engineering-led product
  - HealthTech with regulatory delivery pressure
```

**Minimum signal score to pass Gate 4:** 4 points

**Auto-fail conditions:**
```
  - Company has > 10 Scrum Masters on staff (mature practice, not a fit)
  - Company description explicitly mentions "agile consulting" as their service
  - Company is in an industry with no tech/digital element
  - Company size < 100 or > 10,000 employees
```

---

## Gate 5 — Enrichment

**Purpose:** Validate that we have a real, reachable contact before scoring.

**Required outputs:**
- Valid work email (not catch-all, not role address)
- LinkedIn URL confirmed
- Company domain confirmed

**Enrichment sources (in order):**
1. FullEnrich → work email + phone
2. Crustdata People API → LinkedIn confirmation

**Fail if:**
- No work email found after both providers
- Email fails MX validation
- Email is a catch-all domain
- LinkedIn URL is broken or leads to wrong person

---

## Gate 6 — AI Score

**Purpose:** Claude scores each lead against ICP framework using all gathered signals.

**Input to scoring:**
- Lead's title, company, seniority
- Company signals found in Gate 4
- Intelligence Collector findings (LinkedIn activity, job posts, news)
- ICP framework from `framework.yaml`
- Top 5 proven + top 3 validated insights from intelligence store

**Scoring dimensions:**

| Dimension | Max points | Notes |
|---|---|---|
| Title seniority | 30 | C-level 30, VP 25, Head 20, Dir 15 |
| Company size fit | 25 | 251-500 optimal (25), others scale |
| Funding stage fit | 20 | Series B optimal (20), others scale |
| Signal strength | 25 | Per signal weight matched × 5 |
| **Total** | **100** | |

**Thresholds:**
- `< 50` → reject (tag: `low_icp_score`)
- `50–69` → `Moderate` fit — enter campaign, lower personalization priority
- `70–84` → `Strong` fit — full personalization, standard flow
- `85+` → `Very Strong` fit — flag for human review before first contact

**IMPORTANT:** Gate 6 uses only validated intelligence (confidence: `validated` or `proven`).
Never inject hypotheses into scoring prompts.

---

## Gate 7 — Threshold

**Purpose:** Final pass/fail based on combined score + any hard disqualifiers.

**Pass if:**
- ICP score ≥ 50
- No hard disqualifiers triggered in any prior gate
- Lead has not been contacted in the last 90 days (any channel)

**Fail if:**
- ICP score < 50
- Lead is in do-not-contact list
- Lead has a `Replied` status with negative outcome in last 180 days

**On pass:** Lead written to Unified Leads DB with:
- `lifecycleStatus: Qualified`
- `icpScore: {score}`
- `icpFitLevel: Strong | Moderate | Poor`
- `qualificationReason: {1-2 sentence explanation}`
- `qualificationSignals: {comma-separated signals}`
- `segment: {segment id}`
- `tenantId: {slug}`

---

## Monitoring

Each gate emits a structured log line:
```
[gate:{name}] in={count} out={count} rejected={count} duration={ms}ms
```

Review gate drop-off ratios weekly. If Gate 4 (Company Signal) drops > 60%, broaden the signal keywords. If Gate 6 (AI Score) drops > 50%, review ICP definition.
