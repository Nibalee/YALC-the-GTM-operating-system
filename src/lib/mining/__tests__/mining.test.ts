import { describe, it, expect } from 'vitest'
import {
  filterNewProfiles,
  decideCursorAdvance,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizeCompanyName,
  personIdentityKey,
  normalizeUrl,
  hashUrl,
  isNewerThanWatermark,
  hashQuery,
  LOW_YIELD_STREAK_LIMIT,
  type SeenSet,
  type MiningQuery,
  type MinedProfile,
  type CursorState,
  type MiningLedgerLike,
} from '../ledger'
import { runWeeklyMining, type EnrichedContact } from '../runner'

// ─── Pure-logic unit tests ────────────────────────────────────────────────────

function emptySeen(): SeenSet {
  return { rrIds: new Set(), linkedinUrls: new Set(), emails: new Set(), identityKeys: new Set() }
}
function profile(rr: number, over: Partial<MinedProfile> = {}): MinedProfile {
  return {
    rr_id: rr,
    name: `P${rr}`,
    title: 'VP Eng',
    company_name: 'Acme',
    company_domain: 'acme.com',
    linkedin_url: `https://linkedin.com/in/p${rr}`,
    location: 'London',
    ...over,
  }
}

describe('normalizers + hashQuery', () => {
  it('normalizeDomain strips protocol/www/path', () => {
    expect(normalizeDomain('https://www.Acme.com/careers')).toBe('acme.com')
    expect(normalizeDomain('ACME.com')).toBe('acme.com')
  })
  it('normalizeEmail lowercases+trims', () => {
    expect(normalizeEmail('  Jane@Acme.COM ')).toBe('jane@acme.com')
  })
  it('hashQuery is order-independent and stable', () => {
    expect(hashQuery({ titles: ['A', 'B'] })).toBe(hashQuery({ titles: ['B', 'A'] }))
    expect(hashQuery({ titles: ['A'] })).not.toBe(hashQuery({ titles: ['B'] }))
  })
})

describe('filterNewProfiles (exact-key dedup)', () => {
  it('drops people already in the seen set (by rr_id and by linkedin url)', () => {
    const seen = emptySeen()
    seen.rrIds.add(1)
    seen.linkedinUrls.add('https://www.linkedin.com/in/p2')
    const { fresh, duplicates } = filterNewProfiles([profile(1), profile(2), profile(3)], seen)
    expect(fresh.map(p => p.rr_id)).toEqual([3])
    expect(duplicates.map(p => p.rr_id)).toEqual([1, 2])
  })
  it('dedups within the same run (same rr_id twice in one page)', () => {
    const seen = emptySeen()
    const { fresh } = filterNewProfiles([profile(5), profile(5), profile(6)], seen)
    expect(fresh.map(p => p.rr_id)).toEqual([5, 6])
  })
  it('dedups by name+company identity when no rr_id/linkedin (scraped leads)', () => {
    const seen = emptySeen()
    // A person scraped from a trade article — no rr_id, no linkedin yet.
    const scraped = (name: string, company: string): MinedProfile => ({
      rr_id: null,
      name,
      title: 'AVP',
      company_name: company,
      company_domain: '',
      linkedin_url: '',
      location: 'US',
    })
    seen.identityKeys.add(personIdentityKey('Jane Q. Smith', 'Acme Insurance Inc.'))
    const { fresh, duplicates } = filterNewProfiles(
      [scraped('Jane Q Smith', 'Acme Insurance'), scraped('Bob Lee', 'Beta Re')],
      seen,
    )
    expect(duplicates.map(p => p.name)).toEqual(['Jane Q Smith']) // matched despite punctuation/suffix
    expect(fresh.map(p => p.name)).toEqual(['Bob Lee'])
  })
})

describe('discovery helpers (scraping dedup)', () => {
  it('personIdentityKey: job-changer with a NEW company is a different person', () => {
    const atOldCo = personIdentityKey('Jane Smith', 'Old Carrier')
    const atNewCo = personIdentityKey('Jane Smith', 'New Carrier')
    expect(atOldCo).not.toBe(atNewCo) // the whole point — new role = new lead
  })
  it('personIdentityKey: stable across punctuation/legal-suffix noise', () => {
    expect(personIdentityKey('Jane Q. Smith', 'Acme, Inc.')).toBe(personIdentityKey('jane q smith', 'Acme'))
  })
  it('normalizeName / normalizeCompanyName', () => {
    expect(normalizeName('  Jane  Q. Smith ')).toBe('jane q smith')
    expect(normalizeCompanyName('The Hartford Group LLC')).toBe('hartford')
  })
  it('hashUrl: same article via tracking params / trailing slash collapses to one', () => {
    expect(hashUrl('https://www.businessinsurance.com/article/123?utm=x')).toBe(
      hashUrl('http://businessinsurance.com/article/123/'),
    )
    expect(normalizeUrl('https://WWW.Example.com/A/B/?q=1#f')).toBe('example.com/a/b')
  })
  it('isNewerThanWatermark: only entries after the watermark pass', () => {
    expect(isNewerThanWatermark('2026-06-20', '2026-06-18')).toBe(true)
    expect(isNewerThanWatermark('2026-06-17', '2026-06-18')).toBe(false)
    expect(isNewerThanWatermark('2026-06-17', null)).toBe(true) // no watermark yet → process
  })
})

describe('decideCursorAdvance', () => {
  const base: CursorState = {
    queryHash: 'h',
    nextStart: 101,
    lowYieldStreak: 0,
    status: 'active',
    totalMatches: 500,
  }
  it('advances nextStart and stays active on a healthy run', () => {
    const next = decideCursorAdvance({
      prev: base,
      fetchedThisRun: 100,
      freshThisRun: 90,
      hitEndOfResults: false,
      totalMatches: 500,
    })
    expect(next.nextStart).toBe(201)
    expect(next.status).toBe('active')
    expect(next.lowYieldStreak).toBe(0)
  })
  it('hard-exhausts on end of results (short/empty page)', () => {
    const next = decideCursorAdvance({
      prev: base,
      fetchedThisRun: 12,
      freshThisRun: 12,
      hitEndOfResults: true,
      totalMatches: 500,
    })
    expect(next.status).toBe('exhausted')
  })
  it('soft-exhausts after consecutive low-yield runs', () => {
    let cur: CursorState = { ...base, lowYieldStreak: LOW_YIELD_STREAK_LIMIT - 1 }
    const next = decideCursorAdvance({
      prev: cur,
      fetchedThisRun: 100,
      freshThisRun: 1, // below LOW_YIELD_THRESHOLD
      hitEndOfResults: false,
      totalMatches: 500,
    })
    expect(next.lowYieldStreak).toBe(LOW_YIELD_STREAK_LIMIT)
    expect(next.status).toBe('exhausted')
  })
})

// ─── In-memory fake ledger (mirrors the DB-backed semantics) ──────────────────

interface Row extends MinedProfile {
  status: 'seen' | 'enriched' | 'delivered'
  order: number
  email?: string
  phone?: string
}

class FakeLedger implements MiningLedgerLike {
  people: Row[] = []
  cursors = new Map<string, CursorState>()
  urls = new Set<string>()
  watermarks = new Map<string, string>()
  private seq = 0

  async loadSeen(): Promise<SeenSet> {
    const seen = emptySeen()
    for (const r of this.people) {
      if (r.rr_id != null) seen.rrIds.add(r.rr_id)
      if (r.linkedin_url) seen.linkedinUrls.add(normLi(r.linkedin_url))
      if (r.email) seen.emails.add(normalizeEmail(r.email))
      const idKey = personIdentityKey(r.name ?? '', r.company_name ?? '')
      if (idKey) seen.identityKeys.add(idKey)
    }
    return seen
  }

  async loadSeenUrls(): Promise<Set<string>> {
    return new Set(this.urls)
  }
  async recordUrls(_t: string, entries: { url: string; sourceLabel?: string }[]): Promise<void> {
    for (const e of entries) this.urls.add(hashUrl(e.url))
  }
  async getWatermark(_t: string, sourceKey: string): Promise<string | null> {
    return this.watermarks.get(sourceKey) ?? null
  }
  async setWatermark(_t: string, sourceKey: string, isoDate: string): Promise<void> {
    this.watermarks.set(sourceKey, isoDate)
  }
  async countBacklog(): Promise<number> {
    return this.people.filter(p => p.status === 'seen').length
  }
  async takeBacklog(_t: string, limit: number): Promise<MinedProfile[]> {
    return this.people
      .filter(p => p.status === 'seen')
      .sort((a, b) => a.order - b.order)
      .slice(0, limit)
      .map(p => ({ ...p }))
  }
  async recordSeen(_t: string, profiles: MinedProfile[]): Promise<void> {
    for (const p of profiles) this.people.push({ ...p, status: 'seen', order: this.seq++ })
  }
  async getCursor(_t: string, query: MiningQuery): Promise<CursorState> {
    return (
      this.cursors.get(hashQuery(query)) ?? {
        queryHash: hashQuery(query),
        nextStart: 1,
        lowYieldStreak: 0,
        status: 'active',
        totalMatches: null,
      }
    )
  }
  async saveCursor(_t: string, query: MiningQuery, next: CursorState): Promise<void> {
    this.cursors.set(hashQuery(query), next)
  }
  async markEnriched(
    _t: string,
    c: { rr_id: number | null; linkedin_url: string; email?: string; phone?: string },
  ): Promise<void> {
    const row = this.people.find(p => p.rr_id === c.rr_id)
    if (row) {
      row.email = c.email
      row.phone = c.phone
      row.status = 'enriched'
    }
  }
  async markDelivered(_t: string, rrIds: number[]): Promise<void> {
    for (const r of this.people) if (r.rr_id != null && rrIds.includes(r.rr_id)) r.status = 'delivered'
  }
  async recordCompanies(_t: string, profiles: MinedProfile[]): Promise<number> {
    return new Set(profiles.map(p => normalizeDomain(p.company_domain))).size
  }
}

// minimal linkedin normalizer matching dedup engine for the fake
function normLi(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, 'https://www.').toLowerCase().replace(/\/+$/, '')
}

// Paginated fake source: 1-based `start`, slices the backing list.
function makeSource(all: MinedProfile[]) {
  return async (_q: MiningQuery, start: number, pageSize: number) => ({
    profiles: all.slice(start - 1, start - 1 + pageSize),
    totalMatches: all.length,
  })
}
// Fake enrichment: every profile resolves to a synthesized professional email.
const fakeLookup = async (profiles: MinedProfile[]): Promise<EnrichedContact[]> =>
  profiles.map(p => ({
    rr_id: p.rr_id,
    linkedin_url: p.linkedin_url,
    email: `p${p.rr_id}@acme.com`,
    email_status: 'valid',
    phone: '+15555550000',
  }))

// ─── The crucial behavioral test: freshness + no loss across weeks ────────────

describe('runWeeklyMining — non-repeating weekly lists', () => {
  const query: MiningQuery = { label: 'VP Eng · fintech · London', titles: ['VP Eng'] }
  const source = makeSource(Array.from({ length: 130 }, (_, i) => profile(i + 1)))

  it('delivers fresh leads each week, never repeats, and never loses surplus', async () => {
    const ledger = new FakeLedger()
    const opts = {
      tenantId: 'daryl',
      queries: [query],
      ledger,
      search: source,
      lookup: fakeLookup,
      target: 75,
      pageSize: 100,
      pageBudgetPerQuery: 500,
    }

    // WEEK 1
    const w1 = await runWeeklyMining(opts)
    const w1ids = w1.leads.map(l => l.rr_id)
    expect(w1.delivered).toBe(75)
    expect(w1ids).toEqual(Array.from({ length: 75 }, (_, i) => i + 1)) // rr 1..75
    expect(w1.belowTarget).toBe(false)
    expect(w1.creditsSpent).toBe(75)
    expect(w1.leads.every(l => l.email)).toBe(true)

    // WEEK 2 — same query, same source. Must NOT dedup to zero.
    const w2 = await runWeeklyMining(opts)
    const w2ids = w2.leads.map(l => l.rr_id)
    // 25 surplus from wk1 (76..100) + 30 newly mined (101..130) = 55, none repeating wk1
    expect(w2ids).toEqual(Array.from({ length: 55 }, (_, i) => i + 76)) // rr 76..130
    expect(w2ids.some(id => w1ids.includes(id!))).toBe(false) // zero overlap
    expect(w2.belowTarget).toBe(true) // 55 < 75
    expect(w2.alerts.length).toBeGreaterThan(0) // "widen the ICP" alert
    expect(w2.exhaustedQueries).toContain(query.label)

    // WEEK 3 — pool fully drained → delivers nothing, query stays skipped.
    const w3 = await runWeeklyMining(opts)
    expect(w3.delivered).toBe(0)
    expect(w3.creditsSpent).toBe(0)
    expect(w3.belowTarget).toBe(true)
  })

  it('skips an exhausted query without re-fetching it', async () => {
    const ledger = new FakeLedger()
    ledger.cursors.set(hashQuery(query), {
      queryHash: hashQuery(query),
      nextStart: 999,
      lowYieldStreak: 0,
      status: 'exhausted',
      totalMatches: 130,
    })
    let searchCalls = 0
    const countingSource = async (q: MiningQuery, s: number, ps: number) => {
      searchCalls++
      return source(q, s, ps)
    }
    const report = await runWeeklyMining({
      tenantId: 'daryl',
      queries: [query],
      ledger,
      search: countingSource,
      lookup: fakeLookup,
      target: 75,
    })
    expect(searchCalls).toBe(0) // never hit the API for an exhausted query
    expect(report.perQuery[0].status).toBe('skipped')
  })
})
