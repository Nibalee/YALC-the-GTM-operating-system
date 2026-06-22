/**
 * Mining Ledger
 *
 * The source of truth that makes weekly lead lists non-repeating. Two jobs:
 *
 *   1. DEDUP (safety net) — exact-key matching against everyone we've ever
 *      surfaced for this tenant (rr_id / normalized linkedin_url / email), so a
 *      person is never enriched (1 credit) or delivered twice.
 *   2. CURSORS (freshness engine) — a per-query pagination bookmark so each
 *      weekly run RESUMES where it left off instead of re-fetching page 1.
 *
 * Correctness-critical logic (dedup, cursor advance, exhaustion) is exported as
 * pure functions and unit-tested without a DB. The MiningLedger class wires
 * those to Drizzle for persistence.
 */

import { createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { minedPeople, searchCursors, minedCompanies, seenUrls, sourceWatermarks } from '@/lib/db/schema'
import { normalizeLinkedInUrl } from '@/lib/dedup/engine'

// ─── Types ───────────────────────────────────────────────────────────────────

/** A saved ICP search. The cursor is keyed by a stable hash of these fields. */
export interface MiningQuery {
  label?: string
  titles?: string[]
  companyNames?: string[]
  companyIndustry?: string[]
  location?: string[]
  keywords?: string[]
}

/** A candidate profile from search (pre-enrichment). */
export interface MinedProfile {
  rr_id: number | null
  name: string
  title: string
  company_name: string
  company_domain: string
  linkedin_url: string
  location: string
}

/** The in-memory "seen set" loaded once per run for O(1) dedup checks. */
export interface SeenSet {
  rrIds: Set<number>
  linkedinUrls: Set<string>
  emails: Set<string>
  /** sha1(normalized name + normalized company) — discovery-time identity. */
  identityKeys: Set<string>
}

export interface CursorState {
  queryHash: string
  nextStart: number
  lowYieldStreak: number
  status: 'active' | 'exhausted'
  totalMatches: number | null
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/** A run that nets fewer than this many new leads for a query is "low yield". */
export const LOW_YIELD_THRESHOLD = 5
/** Consecutive low-yield runs before a query is considered exhausted (soft). */
export const LOW_YIELD_STREAK_LIMIT = 3

// ─── Pure helpers (unit-tested without a DB) ─────────────────────────────────

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/** Lowercase, strip punctuation, collapse whitespace. For name matching. */
export function normalizeName(input: string | null | undefined): string {
  return (input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Like normalizeName but also drops common legal suffixes so "Acme Inc." ≈ "Acme". */
const LEGAL_SUFFIXES = new Set(['inc', 'llc', 'corp', 'co', 'company', 'group', 'ltd', 'plc', 'holdings', 'the'])
export function normalizeCompanyName(input: string | null | undefined): string {
  const tokens = normalizeName(input).split(' ').filter(Boolean)
  const kept = tokens.filter(t => !LEGAL_SUFFIXES.has(t))
  return (kept.length > 0 ? kept : tokens).join(' ')
}

/**
 * Discovery-time identity key for a person. Tuned for job-changers: keyed on
 * name + NEW company (not domain/email, which don't exist when scraped from a
 * trade article). Lets us dedup BEFORE spending the scrape/enrich budget.
 */
export function personIdentityKey(name: string, company: string): string {
  const n = normalizeName(name)
  const c = normalizeCompanyName(company)
  if (!n) return ''
  return createHash('sha1').update(`${n}|${c}`).digest('hex')
}

/** Normalize a URL for dedup: drop protocol/www/query/hash/trailing slash, lowercase. */
export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url.trim())
    const host = u.host.replace(/^www\./, '').toLowerCase()
    const path = u.pathname.replace(/\/+$/, '').toLowerCase()
    return `${host}${path}`
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

export function hashUrl(url: string | null | undefined): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex')
}

/** True if `entryDate` is strictly newer than the stored watermark (or no watermark yet). */
export function isNewerThanWatermark(entryDate: string | null | undefined, watermark: string | null | undefined): boolean {
  if (!entryDate) return false
  if (!watermark) return true
  const e = Date.parse(entryDate)
  const w = Date.parse(watermark)
  if (Number.isNaN(e)) return false
  if (Number.isNaN(w)) return true
  return e > w
}

/** Stable hash of a query so the same ICP cell always maps to the same cursor. */
export function hashQuery(query: MiningQuery): string {
  const norm = {
    titles: [...(query.titles ?? [])].map(s => s.toLowerCase().trim()).sort(),
    companyNames: [...(query.companyNames ?? [])].map(s => s.toLowerCase().trim()).sort(),
    companyIndustry: [...(query.companyIndustry ?? [])].map(s => s.toLowerCase().trim()).sort(),
    location: [...(query.location ?? [])].map(s => s.toLowerCase().trim()).sort(),
    keywords: [...(query.keywords ?? [])].map(s => s.toLowerCase().trim()).sort(),
  }
  return createHash('sha1').update(JSON.stringify(norm)).digest('hex')
}

/**
 * Exact-key dedup. Splits a page of candidates into genuinely-new vs already
 * seen, using rr_id > linkedin_url > email. Mutates `seen` so duplicates WITHIN
 * the same run (e.g. one person surfacing in two queries) are also caught.
 *
 * NOTE: deliberately exact/indexed — NOT the fuzzy O(N×M) dedup engine, which
 * can false-positive and silently drop genuinely-new leads in an unattended run.
 */
export function filterNewProfiles(
  profiles: MinedProfile[],
  seen: SeenSet,
): { fresh: MinedProfile[]; duplicates: MinedProfile[] } {
  const fresh: MinedProfile[] = []
  const duplicates: MinedProfile[] = []

  for (const p of profiles) {
    const li = normalizeLinkedInUrl(p.linkedin_url ?? '')
    const idKey = personIdentityKey(p.name ?? '', p.company_name ?? '')
    const isDup =
      (p.rr_id != null && seen.rrIds.has(p.rr_id)) ||
      (li !== '' && seen.linkedinUrls.has(li)) ||
      (idKey !== '' && seen.identityKeys.has(idKey))

    if (isDup) {
      duplicates.push(p)
      continue
    }

    fresh.push(p)
    if (p.rr_id != null) seen.rrIds.add(p.rr_id)
    if (li !== '') seen.linkedinUrls.add(li)
    if (idKey !== '') seen.identityKeys.add(idKey)
  }

  return { fresh, duplicates }
}

/**
 * Decide the next cursor state after fetching a page.
 *
 *   - emptyPage / shortPage (fewer than requested) → hard exhaustion (end of
 *     results OR deep-pagination cap — both mean "stop pulling this query").
 *   - low fresh yield for N consecutive runs → soft exhaustion (pool saturated;
 *     the run will alert the operator to widen the ICP).
 */
export function decideCursorAdvance(params: {
  prev: CursorState
  fetchedThisRun: number
  freshThisRun: number
  hitEndOfResults: boolean
  totalMatches: number | null
}): CursorState {
  const { prev, fetchedThisRun, freshThisRun, hitEndOfResults, totalMatches } = params

  const lowYieldStreak =
    freshThisRun < LOW_YIELD_THRESHOLD ? prev.lowYieldStreak + 1 : 0

  const exhausted = hitEndOfResults || lowYieldStreak >= LOW_YIELD_STREAK_LIMIT

  return {
    queryHash: prev.queryHash,
    nextStart: prev.nextStart + fetchedThisRun,
    lowYieldStreak,
    status: exhausted ? 'exhausted' : 'active',
    totalMatches: totalMatches ?? prev.totalMatches,
  }
}

// ─── Ledger interface (so the runner can be tested with an in-memory fake) ────

export interface MiningLedgerLike {
  loadSeen(tenantId: string): Promise<SeenSet>
  /** Load hashes of already-processed source URLs (discovery-layer dedup). */
  loadSeenUrls(tenantId: string): Promise<Set<string>>
  /** Record processed URLs (insert new, bump times_seen on repeats). */
  recordUrls(tenantId: string, entries: { url: string; sourceLabel?: string }[]): Promise<void>
  /** Get the last-processed publish date for a recurring feed, or null. */
  getWatermark(tenantId: string, sourceKey: string): Promise<string | null>
  /** Advance a feed's watermark to the newest entry processed. */
  setWatermark(tenantId: string, sourceKey: string, isoDate: string, label?: string): Promise<void>
  /** How many people are discovered-but-not-yet-delivered (status='seen'). */
  countBacklog(tenantId: string): Promise<number>
  /** Take up to `limit` undelivered people, oldest-first (FIFO), to deliver. */
  takeBacklog(tenantId: string, limit: number): Promise<MinedProfile[]>
  recordSeen(tenantId: string, profiles: MinedProfile[], queryHash: string): Promise<void>
  getCursor(tenantId: string, query: MiningQuery): Promise<CursorState>
  saveCursor(tenantId: string, query: MiningQuery, next: CursorState): Promise<void>
  markEnriched(
    tenantId: string,
    contact: { rr_id: number | null; linkedin_url: string; email?: string; phone?: string },
  ): Promise<void>
  markDelivered(tenantId: string, rrIds: number[]): Promise<void>
  recordCompanies(tenantId: string, profiles: MinedProfile[]): Promise<number>
}

// ─── DB-backed implementation ────────────────────────────────────────────────

export class MiningLedger implements MiningLedgerLike {
  async loadSeen(tenantId: string): Promise<SeenSet> {
    const rows = await db
      .select({
        rrId: minedPeople.rrId,
        linkedinUrl: minedPeople.linkedinUrl,
        email: minedPeople.email,
        identityKey: minedPeople.identityKey,
      })
      .from(minedPeople)
      .where(eq(minedPeople.tenantId, tenantId))

    const seen: SeenSet = {
      rrIds: new Set(),
      linkedinUrls: new Set(),
      emails: new Set(),
      identityKeys: new Set(),
    }
    for (const r of rows) {
      if (r.rrId != null) seen.rrIds.add(r.rrId)
      const li = normalizeLinkedInUrl(r.linkedinUrl ?? '')
      if (li) seen.linkedinUrls.add(li)
      const em = normalizeEmail(r.email)
      if (em) seen.emails.add(em)
      if (r.identityKey) seen.identityKeys.add(r.identityKey)
    }
    return seen
  }

  async loadSeenUrls(tenantId: string): Promise<Set<string>> {
    const rows = await db
      .select({ urlHash: seenUrls.urlHash })
      .from(seenUrls)
      .where(eq(seenUrls.tenantId, tenantId))
    return new Set(rows.map(r => r.urlHash))
  }

  async recordUrls(tenantId: string, entries: { url: string; sourceLabel?: string }[]): Promise<void> {
    if (entries.length === 0) return
    const existing = await this.loadSeenUrls(tenantId)
    const now = new Date().toISOString()
    const fresh = new Map<string, { url: string; sourceLabel?: string }>()
    const repeats: string[] = []
    for (const e of entries) {
      const h = hashUrl(e.url)
      if (existing.has(h) || fresh.has(h)) {
        if (existing.has(h)) repeats.push(h)
      } else {
        fresh.set(h, e)
      }
    }
    if (fresh.size > 0) {
      await db.insert(seenUrls).values(
        [...fresh].map(([h, e]) => ({
          tenantId,
          urlHash: h,
          url: e.url,
          sourceLabel: e.sourceLabel,
        })),
      )
    }
    for (const h of repeats) {
      await db
        .update(seenUrls)
        .set({ lastSeenAt: now, timesSeen: sql`${seenUrls.timesSeen} + 1` })
        .where(and(eq(seenUrls.tenantId, tenantId), eq(seenUrls.urlHash, h)))
    }
  }

  async getWatermark(tenantId: string, sourceKey: string): Promise<string | null> {
    const [row] = await db
      .select({ d: sourceWatermarks.lastPublishedDate })
      .from(sourceWatermarks)
      .where(and(eq(sourceWatermarks.tenantId, tenantId), eq(sourceWatermarks.sourceKey, sourceKey)))
      .limit(1)
    return row?.d ?? null
  }

  async setWatermark(tenantId: string, sourceKey: string, isoDate: string, label?: string): Promise<void> {
    const [existing] = await db
      .select({ id: sourceWatermarks.id })
      .from(sourceWatermarks)
      .where(and(eq(sourceWatermarks.tenantId, tenantId), eq(sourceWatermarks.sourceKey, sourceKey)))
      .limit(1)
    const now = new Date().toISOString()
    if (existing) {
      await db
        .update(sourceWatermarks)
        .set({ lastPublishedDate: isoDate, lastRunAt: now, label })
        .where(eq(sourceWatermarks.id, existing.id))
    } else {
      await db.insert(sourceWatermarks).values({
        tenantId,
        sourceKey,
        label,
        lastPublishedDate: isoDate,
        lastRunAt: now,
      })
    }
  }

  async countBacklog(tenantId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(minedPeople)
      .where(and(eq(minedPeople.tenantId, tenantId), eq(minedPeople.status, 'seen')))
    return row?.n ?? 0
  }

  async takeBacklog(tenantId: string, limit: number): Promise<MinedProfile[]> {
    const rows = await db
      .select()
      .from(minedPeople)
      .where(and(eq(minedPeople.tenantId, tenantId), eq(minedPeople.status, 'seen')))
      .orderBy(minedPeople.firstSeenAt) // oldest first (FIFO)
      .limit(limit)

    return rows.map(r => ({
      rr_id: r.rrId ?? null,
      name: r.name ?? '',
      title: r.title ?? '',
      company_name: r.company ?? '',
      company_domain: r.companyDomain ?? '',
      linkedin_url: r.linkedinUrl ?? '',
      location: r.location ?? '',
    }))
  }

  async recordSeen(tenantId: string, profiles: MinedProfile[], queryHash: string): Promise<void> {
    if (profiles.length === 0) return
    await db.insert(minedPeople).values(
      profiles.map(p => ({
        tenantId,
        rrId: p.rr_id ?? undefined,
        linkedinUrl: normalizeLinkedInUrl(p.linkedin_url ?? '') || undefined,
        identityKey: personIdentityKey(p.name ?? '', p.company_name ?? '') || undefined,
        companyDomain: normalizeDomain(p.company_domain) || undefined,
        name: p.name || undefined,
        title: p.title || undefined,
        company: p.company_name || undefined,
        location: p.location || undefined,
        status: 'seen',
        source: 'rocketreach',
        queryHash,
      })),
    )
  }

  async getCursor(tenantId: string, query: MiningQuery): Promise<CursorState> {
    const queryHash = hashQuery(query)
    const [row] = await db
      .select()
      .from(searchCursors)
      .where(and(eq(searchCursors.tenantId, tenantId), eq(searchCursors.queryHash, queryHash)))
      .limit(1)

    if (!row) {
      return { queryHash, nextStart: 1, lowYieldStreak: 0, status: 'active', totalMatches: null }
    }
    return {
      queryHash,
      nextStart: row.nextStart,
      lowYieldStreak: row.lowYieldStreak,
      status: row.status as 'active' | 'exhausted',
      totalMatches: row.totalMatches ?? null,
    }
  }

  async saveCursor(tenantId: string, query: MiningQuery, next: CursorState): Promise<void> {
    const queryHash = hashQuery(query)
    const [existing] = await db
      .select({ id: searchCursors.id })
      .from(searchCursors)
      .where(and(eq(searchCursors.tenantId, tenantId), eq(searchCursors.queryHash, queryHash)))
      .limit(1)

    const fields = {
      nextStart: next.nextStart,
      lowYieldStreak: next.lowYieldStreak,
      status: next.status,
      totalMatches: next.totalMatches ?? undefined,
      lastRunAt: new Date().toISOString(),
    }

    if (existing) {
      await db.update(searchCursors).set(fields).where(eq(searchCursors.id, existing.id))
    } else {
      await db.insert(searchCursors).values({
        tenantId,
        queryHash,
        queryJson: query,
        label: query.label,
        ...fields,
      })
    }
  }

  async markEnriched(
    tenantId: string,
    contact: { rr_id: number | null; linkedin_url: string; email?: string; phone?: string },
  ): Promise<void> {
    const li = normalizeLinkedInUrl(contact.linkedin_url ?? '')
    const where =
      contact.rr_id != null
        ? and(eq(minedPeople.tenantId, tenantId), eq(minedPeople.rrId, contact.rr_id))
        : and(eq(minedPeople.tenantId, tenantId), eq(minedPeople.linkedinUrl, li))

    await db
      .update(minedPeople)
      .set({
        email: contact.email ? normalizeEmail(contact.email) : undefined,
        phone: contact.phone,
        status: 'enriched',
        enrichedAt: new Date().toISOString(),
      })
      .where(where)
  }

  async markDelivered(tenantId: string, rrIds: number[]): Promise<void> {
    if (rrIds.length === 0) return
    await db
      .update(minedPeople)
      .set({ status: 'delivered', deliveredAt: new Date().toISOString() })
      .where(and(eq(minedPeople.tenantId, tenantId), inArray(minedPeople.rrId, rrIds)))
  }

  /** Upsert companies derived from people. Returns the count of NEW companies. */
  async recordCompanies(tenantId: string, profiles: MinedProfile[]): Promise<number> {
    const domains = new Map<string, MinedProfile>()
    for (const p of profiles) {
      const d = normalizeDomain(p.company_domain)
      if (d && !domains.has(d)) domains.set(d, p)
    }
    if (domains.size === 0) return 0

    const existing = await db
      .select({ domain: minedCompanies.domain })
      .from(minedCompanies)
      .where(
        and(eq(minedCompanies.tenantId, tenantId), inArray(minedCompanies.domain, [...domains.keys()])),
      )
    const existingSet = new Set(existing.map(e => e.domain))

    let newCount = 0
    const now = new Date().toISOString()
    for (const [domain, p] of domains) {
      if (existingSet.has(domain)) {
        await db
          .update(minedCompanies)
          .set({ lastMinedAt: now })
          .where(and(eq(minedCompanies.tenantId, tenantId), eq(minedCompanies.domain, domain)))
      } else {
        await db.insert(minedCompanies).values({
          tenantId,
          domain,
          name: p.company_name || undefined,
          peopleCount: 1,
          lastMinedAt: now,
        })
        newCount++
      }
    }
    return newCount
  }
}
