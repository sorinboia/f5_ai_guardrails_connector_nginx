import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HostConfigPage from '@/routes/config/host-config'
import { ActiveHostProvider } from '@/lib/hooks/use-active-host'

const defaults = {
  inspectMode: 'both',
  redactMode: 'both',
  logLevel: 'info',
  requestForwardMode: 'sequential',
  backendOrigin: 'https://api.openai.com',
  requestExtractors: ['pii'],
  responseExtractors: [],
  extractorParallel: false,
  responseStreamEnabled: true,
  responseStreamChunkSize: 2048,
  responseStreamChunkOverlap: 128,
  responseStreamFinalEnabled: true,
  responseStreamCollectFullEnabled: false,
  responseStreamBufferingMode: 'buffer',
  responseStreamChunkGatingEnabled: false,
}

const overrides = {
  ...defaults,
  backendOrigin: 'https://api.demo',
  responseStreamChunkSize: 4096,
  responseStreamCollectFullEnabled: true,
}

const options = {
  inspectMode: ['off', 'request', 'response', 'both'],
  redactMode: ['off', 'request', 'response', 'both'],
  logLevel: ['debug', 'info', 'warn', 'err'],
  requestForwardMode: ['sequential', 'parallel'],
  responseStreamBufferingMode: ['buffer', 'passthrough'],
}

const mutationMock = { mutateAsync: vi.fn(), isPending: false, isSuccess: false }

vi.mock('@/lib/hooks/use-config', () => ({
  useHostConfig: () => ({
    data: {
      config: overrides,
      defaults,
      hosts: ['__default__', 'beta'],
      host: 'beta',
      options,
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCreateHost: () => mutationMock,
  useUpdateHost: () => mutationMock,
  useDeleteHost: () => mutationMock,
}))

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <ActiveHostProvider>
        <HostConfigPage />
      </ActiveHostProvider>
    </QueryClientProvider>
  )
}

describe.skip('HostConfigPage diff view', () => {
  it('highlights overrides and shows inherited defaults', async () => {
    renderPage()

    expect(screen.getByText('Backend origin: https://api.demo')).toBeInTheDocument()
    expect(screen.getByText('Chunk size: 4096')).toBeInTheDocument()

    expect(screen.getByText(/default: https:\/\/api\.openai\.com/)).toBeInTheDocument()
    expect(screen.getByText(/default: 2048/)).toBeInTheDocument()

    const overrideBadges = screen.getAllByText('override')
    expect(overrideBadges.length).toBeGreaterThanOrEqual(2)
  })
})
