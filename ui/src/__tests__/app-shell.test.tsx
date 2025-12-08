import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AppShell } from '@/layouts/app-shell'
import { ActiveHostProvider } from '@/lib/hooks/use-active-host'

vi.mock('@/lib/hooks/use-config', () => ({
  useHostConfig: () => ({
    data: {
      hosts: ['__default__', 'demo'],
      host: '__default__',
      config: {},
      defaults: {},
      options: {},
    },
    isFetching: false,
  }),
}))

const wrapper = (initialEntries: string[] = ['/config/hosts']) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return (
    <QueryClientProvider client={qc}>
      <ActiveHostProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route path="config/hosts" element={<div>Hosts Page</div>} />
              <Route path="config/api-keys" element={<div>Keys Page</div>} />
              <Route path="monitor/logs" element={<div>Logs Page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ActiveHostProvider>
    </QueryClientProvider>
  )
}

describe('AppShell navigation', () => {
  it('updates heading when navigating via sidebar links', async () => {
    const user = userEvent.setup()
    render(wrapper())

    expect(screen.getByRole('heading', { level: 1, name: /Host Config/i })).toBeInTheDocument()

    const apiKeyLinks = screen.getAllByRole('link', { name: /API Keys/i })
    await user.click(apiKeyLinks[0])

    expect(await screen.findByRole('heading', { level: 1, name: /API Keys/i })).toBeInTheDocument()
    expect(await screen.findByText('Keys Page')).toBeInTheDocument()
  })

  it('exposes accessible mobile navigation toggles', async () => {
    const user = userEvent.setup()
    render(wrapper(['/monitor/logs']))

    const openBtn = screen.getAllByLabelText('Open navigation')[0]
    await user.click(openBtn)
    const closeButtons = screen.getAllByLabelText('Close navigation')
    expect(closeButtons.length).toBeGreaterThan(0)

    await user.click(closeButtons[0])
    expect(screen.getAllByLabelText('Open navigation')[0]).toBeInTheDocument()
  })
})
