import { Gauge, RefreshCcw, Trash } from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CollectorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Collector"
        description="Control capture counters (total/remaining) from /collector/api. Actions are stubbed until hooks are wired."
        action={<Badge variant="muted">50 entry cap</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Counters"
          description="Display remaining and total values; include quick actions to clear or set."
          actions={<Button size="sm">Refresh</Button>}
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-subtle">
              <Gauge className="h-5 w-5 text-accent" />
              <div className="space-y-0.5">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold text-foreground">--</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <RefreshCcw className="h-4 w-4" />
                Set remaining
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Trash className="h-4 w-4" />
                Clear captures
              </Button>
            </div>
          </div>
        </SectionCard>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>Connect to /collector/api and show last capture hints.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Respect the 50-entry ceiling in UI messaging and button states.</p>
            <p>Link to pipeline docs for how captures are used in guardrail decisions.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
