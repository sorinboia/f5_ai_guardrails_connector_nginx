import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, vi, expect } from 'vitest'

import PatternRulesPage from '@/routes/config/pattern-rules'

const samplePatterns = Array.from({ length: 7 }).map((_, idx) => ({
  id: `p-${idx + 1}`,
  name: `rule-${idx + 1}`,
  context: idx % 2 === 0 ? 'request' : 'response',
  apiKeyName: 'default',
  paths: [`/v1/${idx + 1}`],
  matchers: [{ path: 'body.data', equals: `value-${idx + 1}`, contains: '', exists: false }],
  notes: idx === 6 ? 'final rule note' : '',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
}))

vi.mock('@/lib/hooks/use-resources', () => {
  const baseMutations = { mutateAsync: vi.fn(), isPending: false }
  return {
    usePatterns: () => ({ data: samplePatterns, isLoading: false }),
    useApiKeys: () => ({ data: [{ id: '1', name: 'default', key: 'secret', blockingResponse: { status: 200, contentType: 'json', body: '' }, created_at: '', updated_at: '' }], isLoading: false }),
    useCreatePattern: () => baseMutations,
    useUpdatePattern: () => baseMutations,
    useDeletePattern: () => baseMutations,
  }
})

vi.mock('@/components/ui/toaster', () => ({ toast: vi.fn() }))

describe('PatternRulesPage', () => {
  it('filters and paginates rules', async () => {
    const user = userEvent.setup()
    render(<PatternRulesPage />)

    expect(screen.getByText('rule-1')).toBeInTheDocument()
    expect(screen.queryByText('rule-7')).not.toBeInTheDocument()

    await user.click(screen.getByText('Next'))
    expect(screen.getByText('rule-7')).toBeInTheDocument()

    const search = screen.getByPlaceholderText('Search name, note, or path')
    await user.clear(search)
    await user.type(search, 'note')

    expect(screen.getByText('rule-7')).toBeInTheDocument()
    expect(screen.queryByText('rule-1')).not.toBeInTheDocument()
  })
})
