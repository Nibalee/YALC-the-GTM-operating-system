import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RocketReachService } from '../rocketreach.js'

/**
 * Validates the RocketReach service's parsing of the API shapes
 * (search / lookup / checkStatus) by mocking global fetch. The response
 * shapes here mirror the documented RocketReach API v2 contracts.
 */

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const svc = new RocketReachService()

beforeEach(() => {
  process.env.ROCKETREACH_API_KEY = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ROCKETREACH_API_KEY
})

describe('RocketReachService.searchPeople', () => {
  it('parses a bare-array search response and sends Api-Key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 123,
          name: 'Jane Doe',
          current_title: 'VP Engineering',
          current_employer: 'Acme',
          current_employer_domain: 'acme.com',
          linkedin_url: 'https://linkedin.com/in/janedoe',
          location: 'London, UK',
        },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const profiles = await svc.searchPeople({ titles: ['VP Engineering'], limit: 10 })

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      rr_id: 123,
      name: 'Jane Doe',
      title: 'VP Engineering',
      company_name: 'Acme',
      company_domain: 'acme.com',
      linkedin_url: 'https://linkedin.com/in/janedoe',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/person/search')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as { headers: Record<string, string> }).headers['Api-Key']).toBe('test-key')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.query.current_title).toEqual(['VP Engineering'])
  })

  it('parses a { profiles: [...] } envelope response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ profiles: [{ id: 1, name: 'Bob', current_employer: 'Beta' }] })),
    )
    const profiles = await svc.searchPeople({ companyNames: ['Beta'], limit: 5 })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('Bob')
  })
})

describe('RocketReachService.lookupPerson', () => {
  it('looks up by rr_id and picks the best (valid + professional) email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 123,
        name: 'Jane Doe',
        status: 'complete',
        current_title: 'VP Engineering',
        current_employer: 'Acme',
        linkedin_url: 'https://linkedin.com/in/janedoe',
        emails: [
          { email: 'jane.personal@gmail.com', smtp_valid: 'valid', type: 'personal', grade: 'B' },
          { email: 'jane@acme.com', smtp_valid: 'valid', type: 'professional', grade: 'A' },
        ],
        phones: [
          { number: '+1 555 111', e164: '+1555111', recommended: false },
          { number: '+1 555 222', e164: '+1555222', recommended: true },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await svc.lookupPerson({ rrId: 123 })

    expect(r.status).toBe('complete')
    expect(r.email).toBe('jane@acme.com') // professional + valid wins
    expect(r.email_grade).toBe('A')
    expect(r.phone).toBe('+1555222') // recommended phone wins
    expect(String(fetchMock.mock.calls[0][0])).toContain('id=123')
  })
})

describe('RocketReachService.enrichBatch', () => {
  it('returns immediate completes and polls checkStatus for in-progress lookups', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes('/person/lookup') && u.includes('id=1')) {
        return Promise.resolve(jsonResponse({ id: 1, status: 'complete', emails: [{ email: 'a@x.com', smtp_valid: 'valid' }] }))
      }
      if (u.includes('/person/lookup') && u.includes('id=2')) {
        return Promise.resolve(jsonResponse({ id: 2, status: 'searching', emails: [] }))
      }
      if (u.includes('/person/checkStatus')) {
        return Promise.resolve(jsonResponse([{ id: 2, status: 'complete', emails: [{ email: 'b@y.com', smtp_valid: 'valid' }] }]))
      }
      return Promise.resolve(jsonResponse({}, false, 404))
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await svc.enrichBatch([
      { key: 'row0', lookup: { rrId: 1 } },
      { key: 'row1', lookup: { rrId: 2 } },
    ])

    expect(results.get('row0')?.email).toBe('a@x.com')
    expect(results.get('row1')?.email).toBe('b@y.com') // resolved via checkStatus poll
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/person/checkStatus'))).toBe(true)
  })
})
