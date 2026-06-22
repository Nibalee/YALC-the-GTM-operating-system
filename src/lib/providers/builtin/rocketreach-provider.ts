import type { StepExecutor, RowBatch, ExecutionContext, WorkflowStepInput, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { rocketreachService } from '@/lib/services/rocketreach'
import type { LookupInput } from '@/lib/services/rocketreach'

// RocketReach is the owned enrichment provider for the lead-mining pipeline.
//  - search (FREE): find people by title/company/industry/location, returns
//    LinkedIn URLs but no contact info.
//  - enrich (1 credit/contact): look up email + phone for the rows handed in by
//    the previous step. Runs AFTER dedup so a credit is never spent twice on the
//    same person.

const PEOPLE_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'company_domain', label: 'Company Domain', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'rr_id', label: 'RocketReach ID', type: 'number' },
]

const ENRICH_COLUMNS: ColumnDef[] = [
  ...PEOPLE_COLUMNS,
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'email_status', label: 'Email Status', type: 'badge' },
  { key: 'email_grade', label: 'Email Grade', type: 'badge' },
  { key: 'phone', label: 'Phone', type: 'text' },
]

export class RocketReachProvider implements StepExecutor {
  id = 'rocketreach'
  name = 'RocketReach'
  description = 'People search (free) and email/phone enrichment via RocketReach API'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return rocketreachService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'rocketreach') return true
    const desc = (step.description ?? '').toLowerCase()
    const isPeople = desc.includes('people') || desc.includes('person') || desc.includes('contact')
    if (step.stepType === 'enrich') return true
    return step.stepType === 'search' && isPeople
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    if (step.stepType === 'enrich') {
      yield* this.executeEnrich(step, context)
    } else {
      yield* this.executePeopleSearch(step, context)
    }
  }

  private async *executePeopleSearch(
    step: WorkflowStepInput,
    context: ExecutionContext,
  ): AsyncIterable<RowBatch> {
    const config = step.config ?? {}
    const limit = context.totalRequested || (config.limit as number | undefined) || 100

    // Search is free — no credit preflight needed.
    const profiles = await rocketreachService.searchPeople({
      titles: (config.titles as string[] | undefined) ?? undefined,
      companyNames: (config.companies as string[] | undefined) ?? (config.companyNames as string[] | undefined),
      companyIndustry: config.companyIndustry as string[] | undefined,
      location: config.location as string[] | undefined,
      keywords: config.keywords as string[] | undefined,
      limit,
    })

    const rows = profiles.map(p => ({
      name: p.name,
      title: p.title,
      company_name: p.company_name,
      company_domain: p.company_domain,
      linkedin_url: p.linkedin_url,
      location: p.location,
      rr_id: p.rr_id,
    }))

    yield* this.batch(rows, context)
  }

  private async *executeEnrich(
    step: WorkflowStepInput,
    context: ExecutionContext,
  ): AsyncIterable<RowBatch> {
    void step
    const inputRows = context.previousStepRows ?? []
    if (inputRows.length === 0) return

    // Build lookups keyed by row index so we can merge results back exactly.
    const lookups: Array<{ key: string; lookup: LookupInput }> = []
    inputRows.forEach((row, i) => {
      const lookup = toLookupInput(row)
      if (lookup) lookups.push({ key: String(i), lookup })
    })

    const results = await rocketreachService.enrichBatch(lookups)

    const enrichedRows = inputRows.map((row, i) => {
      const r = results.get(String(i))
      if (!r) return row
      return {
        ...row,
        email: r.email ?? row.email,
        email_status: r.email_status,
        email_grade: r.email_grade,
        phone: r.phone ?? row.phone,
        linkedin_url: r.linkedin_url || row.linkedin_url,
        rr_id: r.rr_id ?? row.rr_id,
      }
    })

    yield* this.batch(enrichedRows, context)
  }

  private async *batch(
    rows: Record<string, unknown>[],
    context: ExecutionContext,
  ): AsyncIterable<RowBatch> {
    const batchSize = context.batchSize || 25
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize)
      yield {
        rows: slice,
        batchIndex: Math.floor(i / batchSize),
        totalSoFar: Math.min(i + batchSize, rows.length),
      }
    }
  }

  getColumnDefinitions(step: WorkflowStepInput): ColumnDef[] {
    return step.stepType === 'enrich' ? ENRICH_COLUMNS : PEOPLE_COLUMNS
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isAvailable()) {
      return { ok: false, message: 'ROCKETREACH_API_KEY is not set' }
    }
    const balance = await rocketreachService.checkCredits()
    return balance >= 0
      ? { ok: true, message: `RocketReach reachable — ${balance} lookup credits` }
      : { ok: true, message: 'RocketReach key set (credit balance unavailable)' }
  }
}

/** Pick the cheapest reliable lookup key from a row: rr_id > linkedin_url > name+company. */
function toLookupInput(row: Record<string, unknown>): LookupInput | null {
  const rrId = row.rr_id != null ? Number(row.rr_id) : undefined
  if (rrId != null && !Number.isNaN(rrId)) return { rrId }

  const linkedinUrl = typeof row.linkedin_url === 'string' ? row.linkedin_url : ''
  if (linkedinUrl) return { linkedinUrl }

  const name = typeof row.name === 'string' ? row.name : ''
  const companyName =
    (typeof row.company_name === 'string' && row.company_name) ||
    (typeof row.company === 'string' && row.company) ||
    ''
  if (name && companyName) return { name, companyName: String(companyName) }

  return null
}
