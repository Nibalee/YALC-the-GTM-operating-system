/**
 * Weekly Mining Runner
 *
 * Orchestrates one weekly run for a tenant:
 *
 *   for each ICP query → resume at its cursor → fetch (FREE search) →
 *     drop already-seen via the ledger → stop once we have `target` new →
 *     enrich ONLY the new (1 credit each) → record/deliver → advance cursors →
 *     report exhaustion / below-target so the caller can alert.
 *
 * The runner takes `search` and `lookup` as injected deps and a ledger
 * implementing MiningLedgerLike, so the full algorithm is unit-tested with
 * in-memory fakes. Real wiring passes RocketReach + the DB-backed MiningLedger.
 */

import {
  filterNewProfiles,
  decideCursorAdvance,
  type MiningQuery,
  type MinedProfile,
  type MiningLedgerLike,
} from './ledger'
import { normalizeLinkedInUrl } from '@/lib/dedup/engine'

export interface EnrichedContact {
  rr_id: number | null
  linkedin_url: string
  email?: string
  email_status?: string
  phone?: string
}

export interface MiningLead extends MinedProfile {
  email?: string
  email_status?: string
  phone?: string
}

export interface SearchDep {
  (
    query: MiningQuery,
    start: number,
    pageSize: number,
  ): Promise<{ profiles: MinedProfile[]; totalMatches: number | null }>
}

export interface LookupDep {
  (profiles: MinedProfile[]): Promise<EnrichedContact[]>
}

export interface RunWeeklyMiningOptions {
  tenantId: string
  queries: MiningQuery[]
  ledger: MiningLedgerLike
  search: SearchDep
  lookup: LookupDep
  target?: number
  pageSize?: number
  /** Max rows to fetch from a single query in one run (deep-pagination guard). */
  pageBudgetPerQuery?: number
}

export interface QueryReport {
  label: string
  fresh: number
  fetched: number
  nextStart: number
  status: 'active' | 'exhausted' | 'skipped'
}

export interface MiningRunReport {
  tenantId: string
  delivered: number
  target: number
  newCompanies: number
  creditsSpent: number
  belowTarget: boolean
  exhaustedQueries: string[]
  perQuery: QueryReport[]
  /** Human-readable alerts the caller should surface (Slack) — never auto-acted. */
  alerts: string[]
  leads: MiningLead[]
}

function enrichKey(p: { rr_id: number | null; linkedin_url: string }): string {
  if (p.rr_id != null) return `rr:${p.rr_id}`
  const li = normalizeLinkedInUrl(p.linkedin_url ?? '')
  return li ? `li:${li}` : `none:${Math.random()}`
}

export async function runWeeklyMining(opts: RunWeeklyMiningOptions): Promise<MiningRunReport> {
  const {
    tenantId,
    queries,
    ledger,
    search,
    lookup,
    target = 75,
    pageSize = 100,
    pageBudgetPerQuery = 500,
  } = opts

  const seen = await ledger.loadSeen(tenantId)
  const perQuery: QueryReport[] = []
  const exhaustedQueries: string[] = []

  // ── Phase A: discovery ──────────────────────────────────────────────────
  // Mine only as much as needed to have `target` undelivered people waiting in
  // the ledger. Everything found is durably recorded (status='seen') so surplus
  // is never lost — it's delivered in a later run. This makes the run robust to
  // RocketReach's unstable sort: once recorded, a person stays found.
  const backlogStart = await ledger.countBacklog(tenantId)
  let recorded = 0

  for (const query of queries) {
    if (backlogStart + recorded >= target) break // enough waiting — no need to mine more
    const label = query.label ?? '(unlabeled query)'
    const cursor = await ledger.getCursor(tenantId, query)

    if (cursor.status === 'exhausted') {
      perQuery.push({ label, fresh: 0, fetched: 0, nextStart: cursor.nextStart, status: 'skipped' })
      exhaustedQueries.push(label)
      continue
    }

    let freshThisQuery = 0
    let fetchedThisRun = 0
    let hitEnd = false
    let totalMatches = cursor.totalMatches

    while (backlogStart + recorded < target && fetchedThisRun < pageBudgetPerQuery) {
      const start = cursor.nextStart + fetchedThisRun
      const { profiles, totalMatches: tm } = await search(query, start, pageSize)
      if (tm != null) totalMatches = tm

      if (profiles.length === 0) {
        hitEnd = true
        break
      }

      const { fresh } = filterNewProfiles(profiles, seen)
      if (fresh.length > 0) await ledger.recordSeen(tenantId, fresh, cursor.queryHash)
      recorded += fresh.length
      freshThisQuery += fresh.length
      fetchedThisRun += profiles.length

      // Short page = end of results (or deep-pagination cap). Either way, stop.
      if (profiles.length < pageSize) {
        hitEnd = true
        break
      }
    }

    const next = decideCursorAdvance({
      prev: cursor,
      fetchedThisRun,
      freshThisRun: freshThisQuery,
      hitEndOfResults: hitEnd,
      totalMatches,
    })
    await ledger.saveCursor(tenantId, query, next)

    perQuery.push({
      label,
      fresh: freshThisQuery,
      fetched: fetchedThisRun,
      nextStart: next.nextStart,
      status: next.status,
    })
    if (next.status === 'exhausted') exhaustedQueries.push(label)
  }

  // ── Phase B: delivery ───────────────────────────────────────────────────
  // Enrich + deliver `target` from the backlog (oldest-first). This is the only
  // step that spends credits, and only on people who are actually delivered.
  const toDeliver = await ledger.takeBacklog(tenantId, target)
  const contacts = toDeliver.length > 0 ? await lookup(toDeliver) : []
  const byKey = new Map(contacts.map(c => [enrichKey(c), c]))

  const leads: MiningLead[] = []
  let creditsSpent = 0
  for (const p of toDeliver) {
    const c = byKey.get(enrichKey(p))
    if (c && (c.email || c.phone)) creditsSpent++
    await ledger.markEnriched(tenantId, {
      rr_id: p.rr_id,
      linkedin_url: p.linkedin_url,
      email: c?.email,
      phone: c?.phone,
    })
    leads.push({ ...p, email: c?.email, email_status: c?.email_status, phone: c?.phone })
  }

  const newCompanies = await ledger.recordCompanies(tenantId, toDeliver)
  await ledger.markDelivered(
    tenantId,
    toDeliver.map(p => p.rr_id).filter((n): n is number => n != null),
  )

  const belowTarget = leads.length < target
  const alerts: string[] = []
  if (belowTarget) {
    alerts.push(
      `⚠️ Mined ${leads.length}/${target} new leads for ${tenantId} this run — ICP pool may be running dry. Consider widening titles, industries, or geos.`,
    )
  }
  if (exhaustedQueries.length > 0) {
    alerts.push(`🔚 Exhausted queries: ${exhaustedQueries.join(', ')}`)
  }

  return {
    tenantId,
    delivered: leads.length,
    target,
    newCompanies,
    creditsSpent,
    belowTarget,
    exhaustedQueries,
    perQuery,
    alerts,
    leads,
  }
}
