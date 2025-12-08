import { KeyRound, Shield } from 'lucide-react'

import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="List, create, and edit connector API keys. CRUD hooks will call /config/api/keys when connected."
        action={<Button size="sm">New key</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <SectionCard
          title="Table scaffold"
          description="React Query + DataTable will render key rows with masked values and blockingResponse preview."
          actions={<Badge variant="muted">Client validation ready</Badge>}
        >
          <EmptyState
            title="No keys loaded yet"
            description="When data hooks land, keys from /config/api/keys will display here with edit/delete actions."
            actionLabel="Seed with sample"
            onAction={() => null}
            icon={<KeyRound className="h-5 w-5" />}
          />
        </SectionCard>

        <Card>
          <CardHeader>
            <CardTitle>Validation map</CardTitle>
            <CardDescription>Rules to mirror SPEC defaults.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 text-accent" />
              <p>Status 100–999, content-type required when body is present.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 text-accent" />
              <p>Name must be unique (client-side check against cached list).</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 text-accent" />
              <p>Blocking response defaults to 200 JSON if empty.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
