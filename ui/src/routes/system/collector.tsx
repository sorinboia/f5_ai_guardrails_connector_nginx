import { useState } from 'react'
import { Gauge, RefreshCcw, Trash } from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useClearCollector, useCollector, useSetCollector } from '@/lib/hooks/use-resources'
import { toast } from '@/components/ui/toaster'

export default function CollectorPage() {
  const { data, isLoading, refetch } = useCollector()
  const setCollector = useSetCollector()
  const clearCollector = useClearCollector()
  const [count, setCount] = useState(5)

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error')

  const handleSet = async () => {
    try {
      await setCollector.mutateAsync(count)
      toast({ title: 'Collector updated', description: `${count} captures scheduled` })
      refetch()
    } catch (err: unknown) {
      toast({ title: 'Update failed', description: errMsg(err) })
    }
  }

  const handleClear = async () => {
    try {
      await clearCollector.mutateAsync()
      toast({ title: 'Collector cleared' })
      refetch()
    } catch (err: unknown) {
      toast({ title: 'Clear failed', description: errMsg(err) })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collector"
        description="Control capture counters (total/remaining) from /collector/api."
        action={<Badge variant="muted">50 entry cap</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Counters"
          description="Adjust remaining captures or clear entries."
          actions={<Button size="sm" onClick={() => refetch()} disabled={isLoading}>Refresh</Button>}
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-subtle">
              <Gauge className="h-5 w-5 text-accent" />
              <div className="space-y-0.5">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold text-foreground">{data?.remaining ?? '--'}</p>
                <p className="text-xs text-muted-foreground">Total collected: {data?.total ?? '--'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-28"
              />
              <Button variant="outline" size="sm" className="gap-2" onClick={handleSet} disabled={setCollector.isPending}>
                <RefreshCcw className="h-4 w-4" />
                Set remaining
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleClear} disabled={clearCollector.isPending}>
                <Trash className="h-4 w-4" />
                Clear captures
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The backend clamps count at 50 and returns updated totals.</p>
          </div>
        </SectionCard>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Reflects values returned by /collector/api.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Remaining captures decrement per request/response pair while collector is enabled.</p>
            <p>Entries array is capped at 50; UI keeps the messaging aligned.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
