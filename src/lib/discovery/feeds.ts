/**
 * P&C People-Moves Feed Discovery
 *
 * The fix for the redundancy/quality problem: instead of re-ranking the same
 * 60-day pool with relevance-sorted keyword searches every morning (which
 * structurally re-surfaces the same people for weeks), we ingest dedicated,
 * chronological "people on the move" RSS feeds NEWEST-FIRST and advance a
 * per-feed date watermark — so each run yields only what published since the
 * last run. Net-new by construction, near-zero redundancy, zero search budget.
 *
 * Discovery here ≠ enrichment: this finds WHO moved. Email/phone come later via
 * the RocketReach→Apollo waterfall.
 */

import { XMLParser } from 'fast-xml-parser'
import { isNewerThanWatermark, hashUrl } from '@/lib/mining/ledger'

// ─── Feed registry ────────────────────────────────────────────────────────────
// Curated, verified P&C "people on the move" feeds (research-validated, free).
// `pcPurity` guides downstream filtering effort: 'pure' feeds are almost all
// on-target P&C exec moves; 'medium' feeds need a tighter P&C/title filter.

export type PCPurity = 'pure' | 'high' | 'medium'

export interface PCFeed {
  sourceKey: string // stable key for the watermark (do not change once live)
  name: string // human label / source_label on stored leads
  url: string
  pcPurity: PCPurity
  notes?: string
}

export const PC_PEOPLE_MOVE_FEEDS: PCFeed[] = [
  {
    sourceKey: 'carrier_management_execs',
    name: 'Carrier Management — Executives on the Move',
    url: 'https://www.carriermanagement.com/executive-profiles/executive-moves/feed/',
    pcPurity: 'pure',
    notes: 'Purest P&C carrier C-suite / underwriting-leader move feed.',
  },
  {
    sourceKey: 'insurance_journal_people',
    name: 'Insurance Journal — People Moves',
    url: 'https://www.insurancejournal.com/topics/people-moves/feed/',
    pcPurity: 'high',
  },
  {
    sourceKey: 'risk_and_insurance_people',
    name: 'Risk & Insurance — People on the Move',
    url: 'https://riskandinsurance.com/category/profession/people-on-the-move/feed/',
    pcPurity: 'high',
  },
  {
    sourceKey: 'reinsurance_news_people',
    name: 'Reinsurance News — People Moves',
    url: 'https://www.reinsurancene.ws/tag/people-moves/feed/',
    pcPurity: 'medium',
    notes: 'Reinsurance/specialty — filter to US + target titles.',
  },
  {
    sourceKey: 'insurance_business_america',
    name: 'Insurance Business America',
    url: 'https://www.insurancebusinessmag.com/us/rss/',
    pcPurity: 'medium',
    notes: 'Consolidated US feed — filter to people-move items.',
  },
  {
    sourceKey: 'propertycasualty360',
    name: 'PropertyCasualty360',
    url: 'https://www.propertycasualty360.com/rss/',
    pcPurity: 'medium',
    notes: 'Site feed — topic feed 404s; filter to the weekly people-move series.',
  },
]

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FeedItem {
  sourceKey: string
  sourceLabel: string
  title: string
  link: string
  guid: string
  /** ISO string, or null if the feed item carried no parseable date. */
  publishedAt: string | null
  summary: string
}

export interface FeedPollResult {
  sourceKey: string
  sourceLabel: string
  totalFetched: number
  newItems: FeedItem[]
  newestDate: string | null
  error?: string
}

/** Narrow ledger surface this module needs (MiningLedger implements it). */
export interface FeedLedger {
  getWatermark(tenantId: string, sourceKey: string): Promise<string | null>
  setWatermark(tenantId: string, sourceKey: string, isoDate: string, label?: string): Promise<void>
  loadSeenUrls(tenantId: string): Promise<Set<string>>
  recordUrls(tenantId: string, entries: { url: string; sourceLabel?: string }[]): Promise<void>
}

export type FetchFn = (url: string) => Promise<string>

// ─── Parsing (pure, unit-tested) ───────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Keep CDATA text inline; tolerate HTML entities.
  processEntities: true,
})

function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('#text' in o) return asText(o['#text'])
  }
  return ''
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function toIso(dateStr: string): string | null {
  if (!dateStr) return null
  const t = Date.parse(dateStr)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Pick the alternate/first href from an Atom <link> (string or array of objects). */
function atomLink(link: unknown): string {
  for (const l of toArray(link as unknown[])) {
    if (typeof l === 'string') return l
    const o = l as Record<string, unknown>
    const rel = String(o['@_rel'] ?? 'alternate')
    if (rel === 'alternate' && o['@_href']) return String(o['@_href'])
  }
  // fall back to first href
  for (const l of toArray(link as unknown[])) {
    const o = l as Record<string, unknown>
    if (o && o['@_href']) return String(o['@_href'])
  }
  return ''
}

/**
 * Parse an RSS 2.0 or Atom feed document into normalized FeedItems.
 * Tolerant of the field-shape variation fast-xml-parser produces.
 */
export function parseFeed(xml: string, sourceKey: string, sourceLabel = sourceKey): FeedItem[] {
  let doc: Record<string, unknown>
  try {
    doc = xmlParser.parse(xml) as Record<string, unknown>
  } catch {
    return []
  }

  // RSS 2.0
  const rss = doc.rss as Record<string, unknown> | undefined
  const channel = rss?.channel as Record<string, unknown> | undefined
  if (channel) {
    return toArray(channel.item as Record<string, unknown>[]).map(it => {
      const guidRaw = it.guid
      const guid = asText(guidRaw) || asText(it.link)
      return {
        sourceKey,
        sourceLabel,
        title: asText(it.title),
        link: asText(it.link),
        guid,
        publishedAt: toIso(asText(it.pubDate) || asText((it as Record<string, unknown>)['dc:date'])),
        summary: asText(it.description),
      }
    })
  }

  // Atom
  const feed = doc.feed as Record<string, unknown> | undefined
  if (feed) {
    return toArray(feed.entry as Record<string, unknown>[]).map(en => ({
      sourceKey,
      sourceLabel,
      title: asText(en.title),
      link: atomLink(en.link),
      guid: asText(en.id) || atomLink(en.link),
      publishedAt: toIso(asText(en.published) || asText(en.updated)),
      summary: asText(en.summary) || asText(en.content),
    }))
  }

  return []
}

/** An item is fresh if we haven't seen its URL and it's newer than the watermark. */
export function isFreshItem(
  item: FeedItem,
  watermark: string | null,
  seenUrls: Set<string>,
): boolean {
  if (item.link && seenUrls.has(hashUrl(item.link))) return false
  // Undated items can't be watermark-compared — rely on the seen-URL net.
  if (!item.publishedAt) return true
  return isNewerThanWatermark(item.publishedAt, watermark)
}

/** The newest publish date among items (to advance the watermark past everything seen). */
export function newestDate(items: FeedItem[]): string | null {
  let newest: string | null = null
  for (const it of items) {
    if (it.publishedAt && (!newest || it.publishedAt > newest)) newest = it.publishedAt
  }
  return newest
}

// ─── Fetch ─────────────────────────────────────────────────────────────────────

export const defaultFetch: FetchFn = async (url: string) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; EmmaResearchBot/1.0; +https://mindlink.tech)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`feed fetch failed (${res.status})`)
  return res.text()
}

// ─── Poll (the discovery engine) ────────────────────────────────────────────────

/**
 * Poll one feed and return only items NEW since the last run. Advances the
 * watermark to the newest item and records the new URLs as seen. Never throws —
 * a broken feed returns an error in the result so one bad source can't sink the run.
 */
export async function pollFeed(
  tenantId: string,
  feed: PCFeed,
  ledger: FeedLedger,
  seenUrls: Set<string>,
  fetchFn: FetchFn = defaultFetch,
): Promise<FeedPollResult> {
  try {
    const xml = await fetchFn(feed.url)
    const items = parseFeed(xml, feed.sourceKey, feed.name)
    const watermark = await ledger.getWatermark(tenantId, feed.sourceKey)

    const newItems = items.filter(it => isFreshItem(it, watermark, seenUrls))
    const newest = newestDate(items)

    if (newest) await ledger.setWatermark(tenantId, feed.sourceKey, newest, feed.name)
    if (newItems.length > 0) {
      await ledger.recordUrls(
        tenantId,
        newItems.filter(i => i.link).map(i => ({ url: i.link, sourceLabel: feed.name })),
      )
      for (const i of newItems) if (i.link) seenUrls.add(hashUrl(i.link))
    }

    return {
      sourceKey: feed.sourceKey,
      sourceLabel: feed.name,
      totalFetched: items.length,
      newItems,
      newestDate: newest,
    }
  } catch (err) {
    return {
      sourceKey: feed.sourceKey,
      sourceLabel: feed.name,
      totalFetched: 0,
      newItems: [],
      newestDate: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Poll all configured feeds (loads the seen-URL set once for the whole run).
 * Returns per-feed results; the caller hands the new items to extraction →
 * dedup → enrichment.
 */
export async function pollAllFeeds(
  tenantId: string,
  ledger: FeedLedger,
  feeds: PCFeed[] = PC_PEOPLE_MOVE_FEEDS,
  fetchFn: FetchFn = defaultFetch,
): Promise<{ results: FeedPollResult[]; newItems: FeedItem[] }> {
  const seenUrls = await ledger.loadSeenUrls(tenantId)
  const results: FeedPollResult[] = []
  for (const feed of feeds) {
    results.push(await pollFeed(tenantId, feed, ledger, seenUrls, fetchFn))
  }
  return { results, newItems: results.flatMap(r => r.newItems) }
}
