import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RocketReachProvider } from '../rocketreach-provider.js'
import type { ExecutionContext, WorkflowStepInput } from '../../types.js'

/**
 * RocketReach provider — validates that search results map to rows and that
 * enrichment merges contact data back onto the right rows, with the lookup key
 * chosen as rr_id > linkedin_url > name+company.
 */

vi.mock('@/lib/services/rocketreach', () => ({
  rocketreachService: {
    isAvailable: () => true,
    searchPeople: vi.fn(),
    enrichBatch: vi.fn(),
    checkCredits: vi.fn(),
  },
}))

const { rocketreachService } = await import('@/lib/services/rocketreach')

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return { frameworkContext: '', batchSize: 25, totalRequested: 100, ...over }
}

async function collect(gen: AsyncIterable<{ rows: Record<string, unknown>[] }>) {
  const rows: Record<string, unknown>[] = []
  for await (const b of gen) rows.push(...b.rows)
  return rows
}

const provider = new RocketReachProvider()

beforeEach(() => vi.clearAllMocks())

describe('RocketReachProvider search', () => {
  it('maps profiles to rows', async () => {
    ;(rocketreachService.searchPeople as ReturnType<typeof vi.fn>).mockResolvedValue([
      { rr_id: 1, name: 'A', title: 'CTO', company_name: 'Acme', company_domain: 'acme.com', linkedin_url: 'li/a', location: 'NYC' },
    ])
    const step: WorkflowStepInput = { stepIndex: 0, title: '', stepType: 'search', provider: 'rocketreach', description: 'people', config: { titles: ['CTO'] } }
    const rows = await collect(provider.execute(step, ctx()))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rr_id: 1, name: 'A', linkedin_url: 'li/a', company_domain: 'acme.com' })
  })
})

describe('RocketReachProvider enrich', () => {
  it('merges email/phone onto the right rows and prefers rr_id as lookup key', async () => {
    const enrichMock = rocketreachService.enrichBatch as ReturnType<typeof vi.fn>
    enrichMock.mockResolvedValue(
      new Map([
        ['0', { rr_id: 1, status: 'complete', email: 'a@acme.com', email_status: 'valid', email_grade: 'A', phone: '+1555', linkedin_url: 'li/a', emails: [], phones: [] }],
      ]),
    )

    const step: WorkflowStepInput = { stepIndex: 0, title: '', stepType: 'enrich', provider: 'rocketreach', description: 'enrich contact' }
    const previousStepRows = [
      { rr_id: 1, name: 'A', company_name: 'Acme', linkedin_url: 'li/a' },
      { name: 'B', company_name: 'Beta' }, // no rr_id/linkedin → name+company fallback, no result returned
    ]
    const rows = await collect(provider.execute(step, ctx({ previousStepRows })))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ email: 'a@acme.com', email_status: 'valid', phone: '+1555' })
    expect(rows[1].email).toBeUndefined() // unmatched row passes through unchanged

    // Verify the lookup-key selection: row0 -> rrId, row1 -> name+company
    const calledWith = enrichMock.mock.calls[0][0]
    expect(calledWith).toEqual([
      { key: '0', lookup: { rrId: 1 } },
      { key: '1', lookup: { name: 'B', companyName: 'Beta' } },
    ])
  })
})

describe('RocketReachProvider misc', () => {
  it('claims rocketreach steps and exposes enrich columns', () => {
    expect(provider.canExecute({ stepIndex: 0, title: '', stepType: 'search', provider: 'rocketreach', description: '' })).toBe(true)
    const cols = provider.getColumnDefinitions({ stepIndex: 0, title: '', stepType: 'enrich', provider: 'rocketreach', description: '' })
    expect(cols.map(c => c.key)).toContain('email')
    expect(cols.map(c => c.key)).toContain('phone')
  })
})
