---
agent: negotiator
topic: objection-handling
confidence: high
---

# Objection Handling — Alacient

## Core Philosophy

An objection is not a rejection. It is a question in disguise. The goal is not to overcome the objection — it is to understand what's really behind it, and address that.

**The rule:** Always respond to an objection with empathy first, then one sentence of reframe, then one question. Never more than 3 sentences total.

---

## Objection Library

### "We already do agile."

**What they really mean:** "We use Jira and have standups. I don't know if that counts."

**Response:**
```
"Most teams say that — the question is whether it's giving you predictable
delivery and happy stakeholders. If yes, we're not for you.
If you're still missing commitments, there's a gap worth a 20-minute look."
```

---

### "We have our own Scrum Masters / agile coaches in-house."

**What they really mean:** "We're trying to solve this ourselves."

**Response:**
```
"Makes sense — we often work alongside in-house coaches to accelerate
what they're building. It takes 6-12 months to hire and ramp a Scrum Master.
We can have impact in week one while you build that capability.
Worth exploring whether that kind of augmentation makes sense?"
```

---

### "We've tried agile before and it didn't work."

**What they really mean:** "I've been burned. I'm skeptical of consultants."

**Response:**
```
"That's the most common thing we hear — and usually it's because the
methodology was applied rigidly without adapting to the team's context.
We don't bring a framework, we bring practitioners who adapt to yours.
What specifically didn't work before?"
```

---

### "Not the right time." / "We're in the middle of something."

**What they really mean:** "I'm interested but I'm busy / it's not urgent enough."

**Response:**
```
"Totally understand. What would make this the right time?
I ask because I want to follow up when it's actually useful."
```

Then snooze for the timeframe they give. If they don't give one: snooze 45 days.

---

### "What does this cost?" / "What's the pricing?"

**What they really mean:** "I need to know if this is in my budget before I invest more time."

**Response:**
```
"It depends on team size and scope — easier to give you a meaningful
number after a quick call.
What I can say: most engagements pay back in 90 days from velocity improvement alone.
Worth 20 minutes to see if the numbers work for [Company]?"
```

Never quote a price in text. Never send a rate card. Push to a conversation.

---

### "How does it work?"

**What they really mean:** "Is this training or hands-on? I don't want another workshop."

**Response:**
```
"We embed 1-2 practitioners inside your engineering team — working in
your sprints, not advising from the outside.
First sprint usually shows the shift. Want me to walk you through how
we'd approach [Company] specifically?"
```

---

### "We're using [Competitor / Big Consultancy]."

**What they really mean:** "We've already committed elsewhere."

If recently started:
```
"How's it going so far? I ask because we hear different things about [X]'s
approach — sometimes it fits perfectly, sometimes teams feel it's too rigid.
Happy to be a sounding board if anything's not landing."
```

If established relationship:
```
"Fair enough — sounds like you're sorted. Happy to connect if anything
ever changes, or if you want a second opinion on something specific."
```

---

### "I'm not the right person." / "Talk to [Name] instead."

**Response:**
```
"Thanks for pointing me in the right direction. Would you be comfortable
making a quick intro, or should I reach out to [Name] directly?"
```

Get the name. Use it.

---

### "We don't have budget right now."

**What they really mean:** "The pain isn't urgent enough to justify finding budget."

**Response:**
```
"Understood — when does budget planning for the next cycle start?
I'll follow up then. In the meantime, what would need to change internally
for something like this to become a priority?"
```

This surfaces whether they're genuinely interested or politely declining.

---

### "Send me more information." / "Can you send a deck?"

**What they really mean:** "I want to get off this conversation without saying no."

**Response:**
```
"Of course — what specifically would be most useful? I want to make sure
I'm not sending something generic. Is it more about how the model works,
results from similar companies, or fit for [Company]'s situation?"
```

If they engage with the question → they're interested. Send the relevant thing only.
If they don't engage → they're not interested. Don't send the deck. Close politely.

---

## When to Stop

Stop the conversation if:
- Second "not now" or "not interested" reply
- They explicitly say "please don't contact me again"
- No reply after Negotiator's first response + one follow-up

Mark as: `lifecycle_status: Lost`, `lost_reason: {reason}`, note for Learning Agent.
