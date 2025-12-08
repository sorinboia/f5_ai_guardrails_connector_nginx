import { useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCcw } from 'lucide-react'

import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useActiveHost } from '@/lib/hooks/use-active-host'
import { useHostConfig } from '@/lib/hooks/use-config'

const curlSnippet = `curl -X GET http://localhost:22100/config/api` as const
const severityOptions = ['any', 'info', 'warn', 'error', 'block'] as const

export default function LogsPage() {
  const { host, setHost } = useActiveHost()
  const { data: hostData } = useHostConfig(host)
  const [filters, setFilters] = useState({ host, severity: 'any', search: '' })

  const hosts = hostData?.hosts || ['__default__']

  useEffect(() => {
    setFilters((prev) => ({ ...prev, host }))
  }, [host])

  const plannedPayload = useMemo(
    () => ({
      host: filters.host || '__default__',
      severity: filters.severity === 'any' ? undefined : filters.severity,
      search: filters.search.trim() || undefined,
    }),
    [filters]
  )

  const handleCopyCurl = () => navigator.clipboard?.writeText(curlSnippet)
  const handleCopyFilters = () => navigator.clipboard?.writeText(JSON.stringify(plannedPayload, null, 2))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Streaming guardrail decisions will appear here once the backend log channel is wired. Filters below mirror the planned log stream payload so we can hook the feed in later without reshaping the UI."
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Log stream scaffold</CardTitle>
            <CardDescription>Filters are local-only for now; data connection will land with the backend feed.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={filters.host}
              onChange={(e) => { setHost(e.target.value); setFilters((f) => ({ ...f, host: e.target.value })) }}
              className="h-9 w-40"
              aria-label="Log host filter"
            >
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
            <Select
              value={filters.severity}
              onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
              className="h-9 w-36"
              aria-label="Log severity filter"
            >
              {severityOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            <Input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search message or path"
              className="h-9 w-48"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({ host, severity: 'any', search: '' })}
              className="gap-2"
            >
              <RefreshCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-6">
          <EmptyState
            title="Live decision stream is disabled"
            description="When the log pipeline is enabled, recent guardrail decisions will scroll here with filters for host, severity, and search."
            actionLabel="Copy curl example"
            onAction={handleCopyCurl}
            secondaryAction={<Button variant="ghost" size="sm" onClick={handleCopyFilters}>Copy planned filter payload</Button>}
          />
          <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
            <Copy className="mt-0.5 h-4 w-4 text-accent" />
            <div>
              <p className="font-medium text-foreground">Tip: configure the management API</p>
              <p className="text-xs text-muted-foreground">Use the management endpoint now to fetch the current config. Streaming logs will reuse the same base URL.</p>
              <code className="mt-2 inline-flex rounded bg-card px-2 py-1 text-[12px] text-foreground shadow-sm">
                {curlSnippet}
              </code>
            </div>
          </div>
          <div className="mt-4 rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
            <p className="text-foreground">Planned stream filters (JSON payload once backend feed is ready):</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/70 p-2 text-[12px] text-foreground">
              {JSON.stringify(plannedPayload, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
