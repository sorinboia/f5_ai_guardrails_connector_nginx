import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { navSections, findNavItem } from '@/lib/constants/navigation'
import { cn } from '@/lib/utils'
import { useActiveHost } from '@/lib/hooks/use-active-host'
import { useHostConfig } from '@/lib/hooks/use-config'

function SidebarLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6">
      {navSections.map((section) => (
        <div key={section.label} className="space-y-2">
          <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {section.label}
          </p>
          <div className="space-y-1.5">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'group flex gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-all',
                    isActive
                      ? 'border-accent/30 bg-accent/10 shadow-subtle backdrop-blur'
                      : 'hover:border-border hover:bg-muted/70'
                  )
                }
                onClick={onNavigate}
              >
                <item.icon className="h-4 w-4 text-accent" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{item.label}</span>
                  </div>
                </div>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-card">
        <span className="text-lg font-bold">f5</span>
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-foreground">AI Guardrails</p>
        <p className="text-xs text-muted-foreground">Connector Console</p>
      </div>
    </div>
  )
}

export function AppShell() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { host, setHost } = useActiveHost()
  const { data: hostData, isFetching } = useHostConfig(host)

  const basePath = (import.meta.env.BASE_URL || '').replace(/\/$/, '')
  const relativePath = basePath && location.pathname.startsWith(basePath)
    ? location.pathname.slice(basePath.length) || '/'
    : location.pathname

  const activePage = useMemo(() => findNavItem(relativePath), [relativePath])

  return (
    <div className="min-h-screen bg-background/70 text-foreground">
      <div className="grid md:grid-cols-[260px_1fr]">
        <aside className="relative hidden min-h-screen border-r bg-card/70 pb-10 pt-8 backdrop-blur md:flex md:flex-col">
          <div className="flex items-center justify-between px-5 pb-6">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto px-5">
            <SidebarLinks />
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/90 px-4 py-3 backdrop-blur md:px-6">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
                onClick={() => setMobileOpen((open) => !open)}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Config UI</p>
                <h1 className="font-heading text-xl font-semibold leading-6">
                  {activePage?.label || 'Management Console'}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="h-9 w-44 border-dashed text-sm"
                aria-label="Active host"
              >
                {(hostData?.hosts || ['__default__']).map((h) => (
                  <option key={h} value={h}>
                    {h}{isFetching && h === host ? ' •' : ''}
                  </option>
                ))}
              </Select>
            </div>
          </header>

          <main className="flex-1 px-4 pb-10 pt-6 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden onClick={() => setMobileOpen(false)} />
      ) : null}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[82%] max-w-xs border-r bg-card/95 p-5 backdrop-blur transition-transform md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between pb-4">
          <Brand />
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <SidebarLinks onNavigate={() => setMobileOpen(false)} />
      </div>
    </div>
  )
}
