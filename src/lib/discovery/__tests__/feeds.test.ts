import { describe, it, expect } from 'vitest'
import {
  parseFeed,
  isFreshItem,
  newestDate,
  pollFeed,
  pollAllFeeds,
  PC_PEOPLE_MOVE_FEEDS,
  type FeedItem,
  type FeedLedger,
  type PCFeed,
} from '../feeds'
import { hashUrl } from '@/lib/mining/ledger'

// Real-shape RSS 2.0 (WordPress, like Carrier Management / Insurance Journal)
const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Executives on the Move - Carrier Management</title>
  <link>https://www.carriermanagement.com/executive-profiles/executive-moves/</link>
  <item>
    <title>RSUI Names Jane Smith as Chief Development Officer</title>
    <link>https://www.carriermanagement.com/news/2026/06/18/289203.htm</link>
    <pubDate>Thu, 18 Jun 2026 12:09:33 +0000</pubDate>
    <guid isPermaLink="false">https://www.carriermanagement.com/?p=289203</guid>
    <description><![CDATA[RSUI announced that Jane Smith has joined as CDO.]]></description>
  </item>
  <item>
    <title>Acme Re Appoints Bob Lee VP, Business Development</title>
    <link>https://www.carriermanagement.com/news/2026/06/15/289100.htm</link>
    <pubDate>Mon, 15 Jun 2026 09:00:00 +0000</pubDate>
    <guid isPermaLink="false">https://www.carriermanagement.com/?p=289100</guid>
    <description>Bob Lee named VP.</description>
  </item>
</channel>
</rss>`

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>People Moves</title>
  <entry>
    <title>Carrier X Promotes Dana Fox to Regional Director</title>
    <link rel="alternate" href="https://example.com/a/dana-fox"/>
    <id>tag:example.com,2026:/a/dana-fox</id>
    <published>2026-06-17T10:00:00Z</published>
    <summary>Dana Fox promoted.</summary>
  </entry>
</feed>`

describe('parseFeed', () => {
  it('parses RSS 2.0 items with title/link/pubDate/guid/description', () => {
    const items = parseFeed(RSS_SAMPLE, 'carrier_management_execs', 'Carrier Management')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sourceKey: 'carrier_management_execs',
      sourceLabel: 'Carrier Management',
      title: 'RSUI Names Jane Smith as Chief Development Officer',
      link: 'https://www.carriermanagement.com/news/2026/06/18/289203.htm',
    })
    expect(items[0].publishedAt).toBe('2026-06-18T12:09:33.000Z')
    expect(items[0].summary).toContain('joined as CDO')
  })

  it('parses Atom entries (link@href, published, id)', () => {
    const items = parseFeed(ATOM_SAMPLE, 'x')
    expect(items).toHaveLength(1)
    expect(items[0].link).toBe('https://example.com/a/dana-fox')
    expect(items[0].publishedAt).toBe('2026-06-17T10:00:00.000Z')
    expect(items[0].title).toContain('Regional Director')
  })

  it('returns [] on malformed XML rather than throwing', () => {
    expect(parseFeed('<not xml', 'x')).toEqual([])
  })
})

describe('isFreshItem / newestDate', () => {
  const item = (link: string, date: string | null): FeedItem => ({
    sourceKey: 's', sourceLabel: 'S', title: 't', link, guid: link, publishedAt: date, summary: '',
  })

  it('is fresh only when newer than watermark and URL unseen', () => {
    const seen = new Set<string>()
    expect(isFreshItem(item('u1', '2026-06-18'), '2026-06-15', seen)).toBe(true)
    expect(isFreshItem(item('u1', '2026-06-10'), '2026-06-15', seen)).toBe(false) // older than watermark
  })
  it('drops items whose URL is already seen even if newer', () => {
    const seen = new Set<string>([hashUrl('u1')])
    expect(isFreshItem(item('u1', '2026-06-18'), '2026-06-15', seen)).toBe(false)
  })
  it('undated items pass on first sight (rely on seen-URL net)', () => {
    const seen = new Set<string>()
    expect(isFreshItem(item('u9', null), '2026-06-15', seen)).toBe(true)
  })
  it('newestDate picks the max publish date', () => {
    expect(newestDate([item('a', '2026-06-10'), item('b', '2026-06-18'), item('c', null)])).toBe('2026-06-18')
  })
})

// In-memory ledger for poll tests
class FakeFeedLedger implements FeedLedger {
  watermarks = new Map<string, string>()
  urls = new Set<string>()
  async getWatermark(_t: string, k: string) { return this.watermarks.get(k) ?? null }
  async setWatermark(_t: string, k: string, iso: string) { this.watermarks.set(k, iso) }
  async loadSeenUrls(_t: string) { return new Set(this.urls) }
  async recordUrls(_t: string, entries: { url: string }[]) { for (const e of entries) this.urls.add(hashUrl(e.url)) }
}

const feed: PCFeed = {
  sourceKey: 'carrier_management_execs',
  name: 'Carrier Management',
  url: 'https://example.com/feed',
  pcPurity: 'pure',
}

describe('pollFeed — only NEW since last run (the redundancy fix)', () => {
  it('first run returns all; second run (same feed) returns nothing', async () => {
    const ledger = new FakeFeedLedger()
    const fetchFn = async () => RSS_SAMPLE

    const seen1 = await ledger.loadSeenUrls('daryl')
    const run1 = await pollFeed('daryl', feed, ledger, seen1, fetchFn)
    expect(run1.newItems).toHaveLength(2) // both moves are new
    expect(run1.newestDate).toBe('2026-06-18T12:09:33.000Z')
    expect(ledger.watermarks.get('carrier_management_execs')).toBe('2026-06-18T12:09:33.000Z')

    // Same feed, unchanged — must NOT re-surface the same people.
    const seen2 = await ledger.loadSeenUrls('daryl')
    const run2 = await pollFeed('daryl', feed, ledger, seen2, fetchFn)
    expect(run2.newItems).toHaveLength(0) // watermark + seen-URLs short-circuit
  })

  it('second run surfaces only the genuinely newer item', async () => {
    const ledger = new FakeFeedLedger()
    const seenA = await ledger.loadSeenUrls('daryl')
    await pollFeed('daryl', feed, ledger, seenA, async () => RSS_SAMPLE)

    // A newer item appears at the top of the feed.
    const updated = RSS_SAMPLE.replace(
      '<item>',
      `<item>
        <title>New Carrier Hires Pat Ray as AVP Underwriting</title>
        <link>https://www.carriermanagement.com/news/2026/06/20/289300.htm</link>
        <pubDate>Sat, 20 Jun 2026 08:00:00 +0000</pubDate>
        <guid>https://www.carriermanagement.com/?p=289300</guid>
        <description>Pat Ray joins.</description>
      </item><item>`,
    )
    const seenB = await ledger.loadSeenUrls('daryl')
    const run2 = await pollFeed('daryl', feed, ledger, seenB, async () => updated)
    expect(run2.newItems.map(i => i.title)).toEqual(['New Carrier Hires Pat Ray as AVP Underwriting'])
  })

  it('a broken feed yields an error result, never throws', async () => {
    const ledger = new FakeFeedLedger()
    const seen = await ledger.loadSeenUrls('daryl')
    const res = await pollFeed('daryl', feed, ledger, seen, async () => { throw new Error('502') })
    expect(res.error).toContain('502')
    expect(res.newItems).toHaveLength(0)
  })
})

describe('pollAllFeeds + registry', () => {
  it('aggregates new items across feeds and dedupes a cross-posted URL', async () => {
    const ledger = new FakeFeedLedger()
    const feeds: PCFeed[] = [
      { sourceKey: 'f1', name: 'F1', url: 'u1', pcPurity: 'pure' },
      { sourceKey: 'f2', name: 'F2', url: 'u2', pcPurity: 'high' },
    ]
    // Both feeds carry the SAME article URL — should count once.
    const shared = RSS_SAMPLE
    const { newItems } = await pollAllFeeds('daryl', ledger, feeds, async () => shared)
    const links = new Set(newItems.map(i => i.link))
    // 2 unique URLs in the sample; cross-posting across f1/f2 must not double them.
    expect(links.size).toBe(2)
    expect(newItems.length).toBe(2)
  })

  it('ships a non-empty curated P&C feed registry', () => {
    expect(PC_PEOPLE_MOVE_FEEDS.length).toBeGreaterThanOrEqual(5)
    expect(PC_PEOPLE_MOVE_FEEDS.some(f => f.pcPurity === 'pure')).toBe(true)
  })
})
