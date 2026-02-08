import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Loader2,
  Radio,
  RefreshCcw,
  Shield,
  XCircle,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useActiveHost } from '@/lib/hooks/use-active-host'
import { useHostConfig } from '@/lib/hooks/use-config'
import { useLogs, useClearLogs } from '@/lib/hooks/use-logs'
import { useLogStream } from '@/lib/hooks/use-log-stream'
import { getLogsExportUrl } from '@/lib/api/http'
import type { LogEntry, LogFilters, LogLevel, LogStatus } from '@/lib/types/log'
import { cn } from '@/lib/utils'

const levelOptions = ['all', 'debug', 'info', 'warn', 'error'] as const
const statusOptions = ['all', 'cleared', 'blocked', 'redacted', 'skipped', 'error'] as const

const statusColors: Record<LogStatus, string> = {
  cleared: 'bg-green-500/20 text-green-600 border-green-500/30',
  blocked: 'bg-red-500/20 text-red-600 border-red-500/30',
  redacted: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
  skipped: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
  error: 'bg-red-500/20 text-red-600 border-red-500/30 border-dashed',
}

const statusIcons: Record<LogStatus, React.ReactNode> = {
  cleared: <CheckCircle className="h-3 w-3" />,
  blocked: <XCircle className="h-3 w-3" />,
  redacted: <Shield className="h-3 w-3" />,
  skipped: <ChevronRight className="h-3 w-3" />,
  error: <AlertTriangle className="h-3 w-3" />,
}

const levelColors: Record<LogLevel, string> = {
  debug: 'text-gray-500',
  info: 'text-blue-500',
  warn: 'text-yellow-600',
  error: 'text-red-600',
}

function formatTime(timestamp: string) {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return timestamp
  }
}

function StatusBadge({ status }: { status: LogStatus }) {
  return (
    <Badge variant="outline" className={cn('gap-1 text-xs', statusColors[status])}>
      {statusIcons[status]}
      {status}
    </Badge>
  )
}

function LogRow({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(JSON.stringify(entry, null, 2))
  }, [entry])

  return (
    <div className="border-b last:border-b-0">
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-muted/50"
        onClick={onToggle}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{formatTime(entry.timestamp)}</span>
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{entry.trace_id?.slice(0, 8) || '-'}</span>
        <span className="w-40 shrink-0 truncate text-xs">{entry.host || '__default__'}</span>
        <span className="w-24 shrink-0">
          <Badge variant="muted" className="text-xs">
            {entry.phase}
          </Badge>
        </span>
        <span className="w-24 shrink-0">
          <StatusBadge status={entry.status} />
        </span>
        <span className={cn('flex-1 truncate text-xs', levelColors[entry.level])}>{entry.message}</span>
      </div>
      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 overflow-auto">
              <pre className="rounded bg-card p-3 text-xs text-foreground">
                {JSON.stringify(entry, null, 2)}
              </pre>
            </div>
            <Button variant="ghost" size="sm" onClick={handleCopy} className="shrink-0">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {entry.pattern_name && (
            <div className="mt-2 text-xs text-muted-foreground">
              Pattern: <span className="font-medium text-foreground">{entry.pattern_name}</span>
              {entry.pattern_id && <span className="ml-2 text-xs">({entry.pattern_id})</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function LogsPage() {
  const { host, setHost } = useActiveHost()
  const { data: hostData } = useHostConfig(host)

  const [filters, setFilters] = useState<{
    host: string
    level: string
    status: string
    search: string
  }>({
    host: '',
    level: 'all',
    status: 'all',
    search: '',
  })

  const [streaming, setStreaming] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const hosts = hostData?.hosts || ['__default__']

  // Build API filters
  const apiFilters: LogFilters = useMemo(() => {
    const f: LogFilters = { limit: 100 }
    if (filters.host && filters.host !== 'all') f.host = filters.host
    if (filters.level && filters.level !== 'all') f.level = filters.level
    if (filters.status && filters.status !== 'all') f.status = filters.status
    if (filters.search) f.search = filters.search
    return f
  }, [filters])

  // Fetch initial logs
  const { data: logsData, isLoading, refetch } = useLogs(apiFilters)
  const clearLogsMutation = useClearLogs()

  // SSE streaming
  const { entries: streamEntries, connected, disconnect, clear: clearStream } = useLogStream({
    filters: apiFilters,
    enabled: streaming,
    maxEntries: 500,
  })

  // Merge historical and streamed entries
  const allEntries = useMemo(() => {
    const historical = logsData?.items || []
    if (!streaming) return historical

    // Dedupe by ID, preferring stream entries (newer)
    const seen = new Set<string>()
    const merged: LogEntry[] = []

    for (const entry of streamEntries) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id)
        merged.push(entry)
      }
    }

    for (const entry of historical) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id)
        merged.push(entry)
      }
    }

    return merged
  }, [logsData?.items, streamEntries, streaming])

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleToggleStreaming = useCallback(() => {
    if (streaming) {
      disconnect()
      setStreaming(false)
    } else {
      setStreaming(true)
    }
  }, [streaming, disconnect])

  const handleClear = useCallback(async () => {
    if (window.confirm('Clear all logs? This cannot be undone.')) {
      await clearLogsMutation.mutateAsync()
      clearStream()
      refetch()
    }
  }, [clearLogsMutation, clearStream, refetch])

  const handleExport = useCallback(() => {
    const url = getLogsExportUrl(apiFilters)
    window.open(url, '_blank')
  }, [apiFilters])

  const handleReset = useCallback(() => {
    setFilters({ host: '', level: 'all', status: 'all', search: '' })
  }, [])

  // Sync host filter with active host
  useEffect(() => {
    if (filters.host !== host) {
      setFilters((f) => ({ ...f, host }))
    }
  }, [host])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Real-time guardrail decisions and proxy events"
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Log Stream</CardTitle>
            {streaming && (
              <Badge variant={connected ? 'success' : 'warning'} className="gap-1">
                <Radio className={cn('h-3 w-3', connected && 'animate-pulse')} />
                {connected ? 'Live' : 'Disconnected'}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={filters.host || 'all'}
              onChange={(e) => {
                const val = e.target.value
                setHost(val === 'all' ? '__default__' : val)
                setFilters((f) => ({ ...f, host: val === 'all' ? '' : val }))
              }}
              className="h-9 w-40"
              aria-label="Host filter"
            >
              <option value="all">All hosts</option>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
            <Select
              value={filters.level}
              onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}
              className="h-9 w-28"
              aria-label="Level filter"
            >
              {levelOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            <Select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="h-9 w-28"
              aria-label="Status filter"
            >
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            <Input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search..."
              className="h-9 w-40"
            />
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
              <RefreshCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant={streaming ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleStreaming}
              className="gap-1"
            >
              <Radio className={cn('h-4 w-4', streaming && connected && 'animate-pulse')} />
              {streaming ? 'Stop' : 'Start'} Live
            </Button>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {allEntries.length} entries {logsData?.hasMore && '(more available)'}
            </span>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={clearLogsMutation.isPending}
              className="gap-1"
            >
              {clearLogsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eraser className="h-4 w-4" />
              )}
              Clear
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          {/* Table Header */}
          <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span className="w-4" />
            <span className="w-20 shrink-0">Time</span>
            <span className="w-16 shrink-0">Trace</span>
            <span className="w-40 shrink-0">Host</span>
            <span className="w-24 shrink-0">Phase</span>
            <span className="w-24 shrink-0">Status</span>
            <span className="flex-1">Message</span>
          </div>

          {/* Log Entries */}
          <div className="max-h-[600px] overflow-y-auto">
            {isLoading && allEntries.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : allEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm font-medium text-foreground">No logs yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Guardrail decisions will appear here when requests are processed
                </p>
                <Button variant="outline" size="sm" className="mt-4 gap-1" onClick={handleToggleStreaming}>
                  <Radio className="h-4 w-4" /> Start Live Stream
                </Button>
              </div>
            ) : (
              allEntries.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedIds.has(entry.id)}
                  onToggle={() => handleToggleExpand(entry.id)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
