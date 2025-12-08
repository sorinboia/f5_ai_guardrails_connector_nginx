import { Filter, ListChecks } from 'lucide-react'

import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function PatternRulesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pattern Rules"
        description="Attach matchers to contexts (request/response/response_stream) and route them to API keys."
        action={<Button size="sm">New rule</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SectionCard
          title="Rules table"
          description="Filters for context, API key, and search will refine the list."
          actions={<Badge variant="muted">Response-stream alias supported</Badge>}
        >
          <EmptyState
            title="No rules have been added"
            description="Import will hydrate this table from /config/api/patterns. Filters are wired locally today."
            actionLabel="Add rule"
            onAction={() => null}
            icon={<Filter className="h-5 w-5" />}
          />
        </SectionCard>

        <Card>
          <CardHeader>
            <CardTitle>Context requirements</CardTitle>
            <CardDescription>Ensure the form enforces SPEC constraints.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <ListChecks className="mt-0.5 h-4 w-4 text-accent" />
              <p>Paths required unless context is response_stream.</p>
            </div>
            <div className="flex items-start gap-2">
              <ListChecks className="mt-0.5 h-4 w-4 text-accent" />
              <p>At least one matcher unless response_stream; apiKeyName must exist.</p>
            </div>
            <div className="flex items-start gap-2">
              <ListChecks className="mt-0.5 h-4 w-4 text-accent" />
              <p>Name unique per context; accept response-stream alias.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
