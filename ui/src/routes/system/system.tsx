import { ArrowDownToLine, Download, ShieldCheck, Upload } from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const downloadTiles = [
  {
    title: 'MITM CA (PEM)',
    href: '/config/mitm/ca.pem',
    description: 'Download the PEM certificate for client trust stores.',
    icon: ShieldCheck,
  },
  {
    title: 'MITM CA (CER)',
    href: '/config/mitm/ca.cer',
    description: 'DER encoded variant for Windows clients.',
    icon: ArrowDownToLine,
  },
]

export default function SystemPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="System"
        description="Certificate downloads plus config export/import. Hooks will call /config/mitm/* and /config/api/store."
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Certificates</CardTitle>
              <CardDescription>Links map to existing MITM certificate endpoints; no backend change required.</CardDescription>
            </div>
            <Badge variant="muted">No-store cache headers preserved</Badge>
          </CardHeader>
          <Separator />
          <CardContent className="grid gap-3 md:grid-cols-2">
            {downloadTiles.map((tile) => (
              <div key={tile.href} className="surface flex items-start gap-3 rounded-xl border p-4 shadow-subtle">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <tile.icon className="h-5 w-5" />
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-foreground">{tile.title}</p>
                  <p className="text-muted-foreground">{tile.description}</p>
                  <Button asChild variant="outline" size="sm" className="mt-1">
                    <a href={tile.href}>Download</a>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <SectionCard
          title="Export configuration"
          description="GET /config/api/store will be wired here to stream the JSON snapshot."
          actions={
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Download JSON
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">
            We will show last modified time and size once the fetch hook is connected. A copy-to-clipboard curl helper will also live
            here.
          </p>
        </SectionCard>

        <SectionCard
          title="Import configuration"
          description="Dropzone + preview before PUT /config/api/store. Confirmation dialog required."
          actions={
            <Button variant="default" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload JSON
            </Button>
          }
        >
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Accepts the same shape returned by export. Invalid JSON will surface inline errors with toasts.</p>
            <p className="text-xs">Pending: integrate file drop + text editor preview.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
