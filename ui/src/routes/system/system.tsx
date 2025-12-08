import { useRef, useState } from 'react'
import { ArrowDownToLine, Download, ShieldCheck, Upload } from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useImportStore, useStoreDownload } from '@/lib/hooks/use-resources'
import { toast } from '@/components/ui/toaster'

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
  const { data, isFetching, refetch } = useStoreDownload()
  const importStore = useImportStore()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importPreview, setImportPreview] = useState('')

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error')

  const handleDownload = async () => {
    const latest = data || (await refetch()).data
    if (!latest) return
    const blob = new Blob([JSON.stringify(latest.snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = latest.filename || 'guardrails-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importPreview)
      await importStore.mutateAsync(parsed)
      toast({ title: 'Config imported', description: 'Store replaced successfully.' })
      setImportPreview('')
      refetch()
    } catch (err: unknown) {
      toast({ title: 'Import failed', description: errMsg(err) })
    }
  }

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setImportPreview(text)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System"
        description="Certificates plus config export/import wired to live endpoints."
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Certificates</CardTitle>
              <CardDescription>Links map to existing MITM certificate endpoints; cache-control no-store preserved.</CardDescription>
            </div>
            <Badge variant="muted">Live</Badge>
          </CardHeader>
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
          description="GET /config/api/store streams the persisted store as JSON."
          actions={
            <Button variant="outline" size="sm" className="gap-2" onClick={handleDownload} disabled={isFetching}>
              <Download className="h-4 w-4" />
              Download JSON
            </Button>
          }
        >
          {data ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Last fetched: {new Date().toLocaleTimeString()}</p>
              <p>Filename: {data.filename || 'guardrails-config.json'}</p>
              <p>Size: {(data.bytes / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No download yet. Press download to fetch current store.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Import configuration"
          description="PUT /config/api/store replaces the store after validation. Paste JSON or drop a file."
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                Choose file
              </Button>
              <Button variant="default" size="sm" className="gap-2" onClick={handleImport} disabled={!importPreview}>
                <Upload className="h-4 w-4" />
                Apply JSON
              </Button>
            </div>
          }
        >
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFilePick} />
          <Textarea
            className="font-mono text-xs"
            rows={8}
            placeholder="Paste store JSON here"
            value={importPreview}
            onChange={(e) => setImportPreview(e.target.value)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            JSON shape validated by backend; __default__ host is enforced automatically.
          </p>
        </SectionCard>
      </div>
    </div>
  )
}
