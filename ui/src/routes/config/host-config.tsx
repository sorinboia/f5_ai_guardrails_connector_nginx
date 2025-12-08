import { Plus, Sparkles } from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const checklist = [
  'Fetch host list from /config/api and show __default__ by default.',
  'Add drawer to create hosts (optionally clone default).',
  'Disable deleting __default__; confirm before deleting other hosts.',
  'Form should diff against defaults and PATCH only overrides.',
  'Expose resolved defaults panel to explain inherited values.',
]

export default function HostConfigPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Host Config"
        description="Manage per-host inspection, forwarding, streaming, and logging controls. Data hooks are scaffolded; connect them to /config/api in the next iteration."
        action={<Button size="sm">New host</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SectionCard
          title="Editor workspace"
          description="Host selector, config form, and diffed PATCH payloads will live here."
          actions={
            <Badge variant="muted" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Next up: wire data
            </Badge>
          }
        >
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              The form will mirror SPEC defaults (inspectMode, redactMode, stream toggles, extractor arrays). Save should only send
              dirty fields back to /config/api?host=name.
            </p>
            <p className="text-xs text-muted-foreground">
              Placeholder inputs will be swapped for react-hook-form + zod once the DTOs are connected.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm">Select host</Button>
              <Button variant="outline" size="sm">Duplicate defaults</Button>
              <Button variant="outline" size="sm">Reset changes</Button>
            </div>
          </div>
        </SectionCard>

        <Card>
          <CardHeader>
            <CardTitle>v1 checklist</CardTitle>
            <CardDescription>Aligns with NEW_UI_PLAN Host Config requirements.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm text-foreground">
              {checklist.map((item) => (
                <li key={item} className="flex items-start gap-2 text-muted-foreground">
                  <Plus className="mt-0.5 h-4 w-4 text-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
