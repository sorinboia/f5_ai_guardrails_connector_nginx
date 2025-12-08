import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, vi, expect } from 'vitest'

import ApiKeysPage from '@/routes/config/api-keys'

const sampleKeys = Array.from({ length: 8 }).map((_, idx) => ({
  id: `id-${idx + 1}`,
  name: `key-${idx + 1}`,
  key: `secret-${idx + 1}`,
  blockingResponse: { status: 200, contentType: 'application/json', body: '{}' },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: `2025-01-0${(idx % 9) + 1}T00:00:00Z`,
}))

vi.mock('@/lib/hooks/use-resources', () => {
  const baseMutations = { mutateAsync: vi.fn(), isPending: false }
  return {
    useApiKeys: () => ({ data: sampleKeys, isLoading: false }),
    useCreateApiKey: () => baseMutations,
    useUpdateApiKey: () => baseMutations,
    useDeleteApiKey: () => baseMutations,
  }
})

vi.mock('@/components/ui/toaster', () => ({ toast: vi.fn() }))

vi.mock('@/lib/api/http', async () => {
  const mod = await vi.importActual<typeof import('@/lib/api/http')>('@/lib/api/http')
  return { ...mod, redactKey: (key: string) => `***${key.slice(-3)}` }
})

describe('ApiKeysPage', () => {
  it('paginates and filters keys', async () => {
    const user = userEvent.setup()
    render(<ApiKeysPage />)

    expect(screen.getByText('key-1')).toBeInTheDocument()
    expect(screen.queryByText('key-7')).not.toBeInTheDocument()

    await user.click(screen.getByText('Next'))
    expect(screen.getByText('key-7')).toBeInTheDocument()

    const search = screen.getByPlaceholderText('Search name or key')
    await user.clear(search)
    await user.type(search, 'key-3')

    expect(screen.getByText('key-3')).toBeInTheDocument()
    expect(screen.queryByText('key-1')).not.toBeInTheDocument()
  })
})
