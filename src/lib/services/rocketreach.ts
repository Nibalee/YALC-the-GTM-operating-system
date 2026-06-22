// Singleton service wrapping the RocketReach API v2.
// Auth: header `Api-Key: ${ROCKETREACH_API_KEY}`
//
// COST MODEL (the reason RocketReach is a great fit for the dedup-first agent):
//   - /person/search is FREE — returns profiles + LinkedIn URL, NO contact info,
//     and does NOT deduct lookup/export credits.
//   - /person/lookup consumes 1 export credit per verified contact retrieved.
//   - Lookups are ASYNC: a lookup returns a `status`
//     (complete | progress | searching | waiting). When not yet complete, poll
//     /person/checkStatus (or use a webhook) until the contact data lands.
//
// Best practice for the lead-mining pipeline:
//   search (free) -> dedup against the mined ledger -> lookup ONLY new people.
// That way a credit is never spent twice on the same person.

const BASE_URL = 'https://api.rocketreach.co/api/v2'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RocketReachProfile {
  /** RocketReach internal profile id — cheapest, most reliable lookup key. */
  rr_id: number | null
  name: string
  title: string
  company_name: string
  company_domain: string
  linkedin_url: string
  location: string
}

export interface RocketReachEmail {
  email: string
  smtp_valid?: string // valid | invalid | accept-all | unknown
  type?: string // personal | professional | disposable | role-based
  grade?: string // A | A- | B | ...
}

export interface RocketReachLookupResult {
  rr_id: number | null
  name: string
  status: string
  title: string
  company_name: string
  linkedin_url: string
  /** Best email picked from the emails array (verified + professional first). */
  email?: string
  email_status?: string // smtp_valid of the chosen email
  email_grade?: string // grade of the chosen email
  phone?: string // recommended/first phone
  emails: RocketReachEmail[]
  phones: string[]
}

export interface SearchPeopleFilters {
  titles?: string[]
  companyNames?: string[]
  companyIndustry?: string[]
  location?: string[]
  keywords?: string[]
  limit?: number
}

/** Identify a person to look up. Prefer rrId (exact) > linkedinUrl > name+company. */
export interface LookupInput {
  rrId?: number | null
  linkedinUrl?: string
  name?: string
  companyName?: string
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function getHeaders(): Record<string, string> {
  const apiKey = process.env.ROCKETREACH_API_KEY
  if (!apiKey) throw new Error('ROCKETREACH_API_KEY must be set')
  return {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
  }
}

const PAGE_SIZE = 100 // RocketReach max page size
const LOOKUP_POLL_MAX_WAIT = 180_000 // 3 minutes
const LOOKUP_POLL_START_INTERVAL = 2000

export class RocketReachService {
  isAvailable(): boolean {
    return !!process.env.ROCKETREACH_API_KEY
  }

  /**
   * Best-effort export-credit balance. Returns -1 if it can't be read so
   * callers can degrade gracefully rather than crash.
   */
  async checkCredits(): Promise<number> {
    try {
      const res = await fetch(`${BASE_URL}/account/`, { headers: getHeaders() })
      if (!res.ok) return -1
      const data = (await res.json()) as {
        lookup_credit_balance?: number
        export_credit_balance?: number
      }
      return data.lookup_credit_balance ?? data.export_credit_balance ?? -1
    } catch {
      return -1
    }
  }

  /**
   * People search (FREE). Returns profiles with LinkedIn URLs but no contact
   * info. Paginates up to `limit` (default 100).
   */
  async searchPeople(filters: SearchPeopleFilters): Promise<RocketReachProfile[]> {
    const limit = filters.limit ?? 100
    const query: Record<string, string[]> = {}
    if (filters.titles?.length) query.current_title = filters.titles
    if (filters.companyNames?.length) query.current_employer = filters.companyNames
    if (filters.companyIndustry?.length) query.company_industry = filters.companyIndustry
    if (filters.location?.length) query.location = filters.location
    if (filters.keywords?.length) query.keyword = filters.keywords

    const profiles: RocketReachProfile[] = []
    let start = 1

    while (profiles.length < limit) {
      const pageSize = Math.min(PAGE_SIZE, limit - profiles.length)
      const res = await fetch(`${BASE_URL}/person/search`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ start, page_size: pageSize, order_by: 'relevance', query }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`RocketReach searchPeople failed (${res.status}): ${text}`)
      }

      // The API may return a bare array or { profiles: [...] }.
      const data = (await res.json()) as
        | Record<string, unknown>[]
        | { profiles?: Record<string, unknown>[] }
      const page = Array.isArray(data) ? data : (data.profiles ?? [])
      if (page.length === 0) break

      for (const raw of page) profiles.push(normalizeProfile(raw))
      if (page.length < pageSize) break
      start += pageSize
    }

    return profiles.slice(0, limit)
  }

  /**
   * Initiate a single lookup. Returns whatever the API gives back immediately —
   * which may already be `complete`, or may be `searching`/`progress` (in which
   * case the caller should poll checkStatus on the returned rr_id).
   */
  async lookupPerson(input: LookupInput): Promise<RocketReachLookupResult> {
    const params = new URLSearchParams()
    if (input.rrId != null) {
      params.set('id', String(input.rrId))
    } else if (input.linkedinUrl) {
      params.set('linkedin_url', input.linkedinUrl)
    } else if (input.name && input.companyName) {
      params.set('name', input.name)
      params.set('current_employer', input.companyName)
    } else {
      throw new Error('RocketReach lookupPerson requires rrId, linkedinUrl, or name+companyName')
    }

    const res = await fetch(`${BASE_URL}/person/lookup?${params.toString()}`, {
      headers: getHeaders(),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`RocketReach lookupPerson failed (${res.status}): ${text}`)
    }
    return normalizeLookup((await res.json()) as Record<string, unknown>)
  }

  /** Poll checkStatus for a batch of ids until complete/failed or timeout. */
  async pollStatus(ids: number[]): Promise<Map<number, RocketReachLookupResult>> {
    const out = new Map<number, RocketReachLookupResult>()
    if (ids.length === 0) return out

    let pending = new Set(ids)
    let interval = LOOKUP_POLL_START_INTERVAL
    const start = Date.now()

    while (pending.size > 0 && Date.now() - start < LOOKUP_POLL_MAX_WAIT) {
      const qs = Array.from(pending)
        .map(id => `ids=${id}`)
        .join('&')
      const res = await fetch(`${BASE_URL}/person/checkStatus?${qs}`, { headers: getHeaders() })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`RocketReach checkStatus failed (${res.status}): ${text}`)
      }

      const data = (await res.json()) as Record<string, unknown>[]
      for (const raw of data ?? []) {
        const result = normalizeLookup(raw)
        if (result.rr_id == null) continue
        if (result.status === 'complete' || result.status === 'failed') {
          out.set(result.rr_id, result)
          pending.delete(result.rr_id)
        }
      }

      if (pending.size === 0) break
      await new Promise(resolve => setTimeout(resolve, interval))
      interval = Math.min(interval * 2, 30_000)
    }

    return out
  }

  /**
   * Enrich a batch of people: initiate lookups, then poll any that aren't
   * immediately complete. Returns results keyed by the caller-supplied key so
   * the provider can merge contact data back onto the right rows.
   */
  async enrichBatch(
    inputs: Array<{ key: string; lookup: LookupInput }>,
  ): Promise<Map<string, RocketReachLookupResult>> {
    const results = new Map<string, RocketReachLookupResult>()
    const pendingByRrId = new Map<number, string>() // rr_id -> caller key

    for (const { key, lookup } of inputs) {
      try {
        const res = await this.lookupPerson(lookup)
        if (res.status === 'complete' || res.status === 'failed') {
          results.set(key, res)
        } else if (res.rr_id != null) {
          pendingByRrId.set(res.rr_id, key)
        } else {
          results.set(key, res) // no id to poll — return partial
        }
      } catch (err) {
        // Per-person failure must never crash the batch.
        // eslint-disable-next-line no-console
        console.error(`[rocketreach] lookup failed for ${key}:`, err)
      }
    }

    if (pendingByRrId.size > 0) {
      const polled = await this.pollStatus(Array.from(pendingByRrId.keys()))
      for (const [rrId, key] of pendingByRrId) {
        const result = polled.get(rrId)
        if (result) results.set(key, result)
      }
    }

    return results
  }
}

// ---------------------------------------------------------------------------
// Normalizers (tolerant of field-name variation, mirroring crustdata.ts)
// ---------------------------------------------------------------------------

function normalizeProfile(raw: Record<string, unknown>): RocketReachProfile {
  return {
    rr_id: raw.id != null ? Number(raw.id) : null,
    name: String(raw.name ?? ''),
    title: String(raw.current_title ?? ''),
    company_name: String(raw.current_employer ?? ''),
    company_domain: String(raw.current_employer_domain ?? raw.current_employer_website ?? ''),
    linkedin_url: String(raw.linkedin_url ?? ''),
    location: String(raw.location ?? ''),
  }
}

function pickBestEmail(emails: RocketReachEmail[]): RocketReachEmail | undefined {
  if (emails.length === 0) return undefined
  // Prefer SMTP-valid professional emails, then any valid, then the first.
  return (
    emails.find(e => e.smtp_valid === 'valid' && e.type === 'professional') ??
    emails.find(e => e.smtp_valid === 'valid') ??
    emails[0]
  )
}

function normalizeLookup(raw: Record<string, unknown>): RocketReachLookupResult {
  const rawEmails = (raw.emails as Record<string, unknown>[] | undefined) ?? []
  const emails: RocketReachEmail[] = rawEmails.map(e => ({
    email: String(e.email ?? ''),
    smtp_valid: e.smtp_valid ? String(e.smtp_valid) : undefined,
    type: e.type ? String(e.type) : undefined,
    grade: e.grade ? String(e.grade) : undefined,
  }))

  const rawPhones = (raw.phones as Record<string, unknown>[] | undefined) ?? []
  const phones: string[] = rawPhones
    .map(p => String(p.e164 ?? p.number ?? ''))
    .filter(Boolean)
  const recommendedPhone = rawPhones.find(p => p.recommended === true)
  const phone = recommendedPhone
    ? String(recommendedPhone.e164 ?? recommendedPhone.number ?? '')
    : phones[0]

  const best = pickBestEmail(emails)

  return {
    rr_id: raw.id != null ? Number(raw.id) : null,
    name: String(raw.name ?? ''),
    status: String(raw.status ?? 'unknown'),
    title: String(raw.current_title ?? ''),
    company_name: String(raw.current_employer ?? ''),
    linkedin_url: String(raw.linkedin_url ?? ''),
    email: best?.email,
    email_status: best?.smtp_valid,
    email_grade: best?.grade,
    phone: phone || undefined,
    emails,
    phones,
  }
}

export const rocketreachService = new RocketReachService()
