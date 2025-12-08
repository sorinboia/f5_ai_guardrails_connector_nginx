import { Copy } from 'lucide-react'

import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const curlSnippet = `curl -X GET http://localhost:22100/config/api` as const

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Streaming guardrail decisions will appear here once the backend log channel is wired. Filters and empty states are ready for when we turn it on."
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Log stream scaffold</CardTitle>
            <CardDescription>Filters are local-only for now; data connection will land with the backend feed.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm">Host: __default__</Button>
            <Button variant="outline" size="sm">Severity: any</Button>
            <Button variant="outline" size="sm">Search</Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-6">
          <EmptyState
            title="Live decision stream is disabled"
            description="When the log pipeline is enabled, recent guardrail decisions will scroll here with filters for host, severity, and search."
            actionLabel="Copy curl example"
            onAction={() => navigator.clipboard?.writeText(curlSnippet)}
            secondaryAction={<Button variant="ghost" size="sm">Set up backend feed</Button>}
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
        </CardContent>
      </Card>
    </div>
  )
}
