import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { PageHeader } from '@/components/shared/page-header'
import { SectionCard } from '@/components/shared/section-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveHost } from '@/lib/hooks/use-active-host'
import { useCreateHost, useDeleteHost, useHostConfig, useUpdateHost } from '@/lib/hooks/use-config'
import { usePatterns } from '@/lib/hooks/use-resources'
import { toast } from '@/components/ui/toaster'
import type { HostConfig } from '@/lib/types'
import { hostFormSchema } from '@/lib/validation'
import type { z } from 'zod'

type HostFormValues = z.infer<typeof hostFormSchema>

function formToConfig(values: HostFormValues): HostConfig {
  const normalize = (list?: string[]) => (Array.isArray(list) ? list.map((v) => v.trim()).filter(Boolean) : [])
  const requestExtractors = normalize(values.requestExtractors)
  const responseExtractors = normalize(values.responseExtractors)
  return {
    inspectMode: values.inspectMode,
    redactMode: values.redactMode,
    logLevel: values.logLevel,
    requestForwardMode: values.requestForwardMode,
    backendOrigin: values.backendOrigin,
    requestExtractor: requestExtractors[0] || '',
    responseExtractor: responseExtractors[0] || '',
    requestExtractors,
    responseExtractors,
    extractorParallel: values.extractorParallel,
    responseStreamEnabled: values.responseStreamEnabled,
    responseStreamChunkSize: values.responseStreamChunkSize,
    responseStreamChunkOverlap: values.responseStreamChunkOverlap,
    responseStreamFinalEnabled: values.responseStreamFinalEnabled,
    responseStreamCollectFullEnabled: values.responseStreamCollectFullEnabled,
    responseStreamBufferingMode: values.responseStreamBufferingMode,
    responseStreamChunkGatingEnabled: values.responseStreamChunkGatingEnabled,
  }
}

export default function HostConfigPage() {
  const { host, setHost } = useActiveHost()
  const [newHost, setNewHost] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data, isLoading, isFetching, refetch } = useHostConfig(host)
  const updateHost = useUpdateHost(host, data?.config)
  const createHost = useCreateHost()
  const deleteHost = useDeleteHost()
  const { data: patternsData, isLoading: patternsLoading } = usePatterns()

  const hosts = data?.hosts || ['__default__']

  const form = useForm<HostFormValues>({
    resolver: zodResolver(hostFormSchema) as Resolver<HostFormValues>,
    mode: 'onChange',
    values: undefined,
  })

  useEffect(() => {
    if (data) {
      form.reset({
        inspectMode: data.config.inspectMode,
        redactMode: data.config.redactMode,
        logLevel: data.config.logLevel,
        requestForwardMode: data.config.requestForwardMode,
        backendOrigin: data.config.backendOrigin,
        responseStreamEnabled: data.config.responseStreamEnabled,
        responseStreamChunkSize: data.config.responseStreamChunkSize,
        responseStreamChunkOverlap: data.config.responseStreamChunkOverlap,
        responseStreamFinalEnabled: data.config.responseStreamFinalEnabled,
        responseStreamCollectFullEnabled: data.config.responseStreamCollectFullEnabled,
        responseStreamBufferingMode: data.config.responseStreamBufferingMode,
        responseStreamChunkGatingEnabled: data.config.responseStreamChunkGatingEnabled,
        extractorParallel: Boolean(data.config.extractorParallel ?? data.config.extractorParallelEnabled),
        requestExtractors: data.config.requestExtractors || [],
        responseExtractors: data.config.responseExtractors || [],
      })
    }
  }, [data, form])

  useEffect(() => {
    if (data?.host && host !== data.host) setHost(data.host)
  }, [data?.host, host, setHost])

  const requestExtractors = form.watch('requestExtractors')
  const responseExtractors = form.watch('responseExtractors')
  const extractorLabels = useMemo(() => {
    const map: Record<string, string> = {}
    ;(patternsData || []).forEach((p) => {
      const contextLabel = p.context === 'response_stream' ? 'response stream' : p.context
      map[p.id] = `${p.name} · ${contextLabel}`
    })
    return map
  }, [patternsData])

  const requestOptions = useMemo(
    () => (patternsData || []).filter((p) => p.context === 'request').map((p) => ({ value: p.id, label: p.name })),
    [patternsData]
  )

  const responseOptions = useMemo(
    () => (patternsData || []).filter((p) => p.context === 'response' || p.context === 'response_stream').map((p) => ({ value: p.id, label: p.name })),
    [patternsData]
  )

  const [requestSelection, setRequestSelection] = useState('')
  const [responseSelection, setResponseSelection] = useState('')

  useEffect(() => {
    setRequestSelection('')
    setResponseSelection('')
  }, [data?.host])

  const addExtractor = (field: 'requestExtractors' | 'responseExtractors', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const current = form.getValues(field) || []
    if (current.includes(trimmed)) return
    form.setValue(field, [...current, trimmed], { shouldDirty: true, shouldValidate: true })
  }

  const removeExtractor = (field: 'requestExtractors' | 'responseExtractors', value: string) => {
    const current = form.getValues(field) || []
    form.setValue(
      field,
      current.filter((item) => item !== value),
      { shouldDirty: true, shouldValidate: true }
    )
  }

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error')

  const onSubmit = async (values: HostFormValues) => {
    if (!data?.config) return
    const payload = formToConfig(values)
    try {
      setSubmitError(null)
      await updateHost.mutateAsync(payload)
      toast({ title: `Saved ${host}`, description: 'Config patch applied.' })
      refetch()
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Update failed', description: message })
    }
  }

  const handleCreate = async () => {
    const name = newHost.trim() || '__default__'
    try {
      setSubmitError(null)
      const res = await createHost.mutateAsync(name)
      setHost(res.host)
      setNewHost('')
      toast({ title: 'Host created', description: res.host })
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Create failed', description: message })
    }
  }

  const handleDelete = async () => {
    if (host === '__default__') return
    const confirmed = window.confirm(`Remove host ${host}? Config will fall back to defaults.`)
    if (!confirmed) return
    try {
      setSubmitError(null)
      await deleteHost.mutateAsync(host)
      setHost('__default__')
      toast({ title: 'Host removed', description: host })
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Delete failed', description: message })
    }
  }

  const dirty = useMemo(() => form.formState.isDirty, [form.formState.isDirty])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Host Config"
        description="Manage per-host inspection, forwarding, streaming, and logging controls."
        action={
          <div className="flex gap-2">
            <Input
              placeholder="new host (foo.example)"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              className="w-52"
            />
            <Button size="sm" disabled={!newHost.trim()} onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
        }
      />
      <div className="grid gap-4">
        <SectionCard
          title="Editor"
          description="Select a host, adjust settings, and PATCH only the changed fields."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={host} onChange={(e) => setHost(e.target.value)} className="w-48" aria-label="Host selector">
                {hosts.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
              <Button variant="outline" size="sm" onClick={() => form.reset()} disabled={!dirty}>
                <RefreshCcw className="mr-1 h-4 w-4" /> Reset
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={host === '__default__'}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </div>
          }
        >
          {isLoading ? (
            <HostConfigSkeleton />
          ) : data ? (
            <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
              {submitError ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" aria-live="polite">
                  {submitError}
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Inspect mode</Label>
                  <Select {...form.register('inspectMode')}>
                    {data.options.inspectMode.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Redact mode</Label>
                  <Select {...form.register('redactMode')}>
                    {data.options.redactMode.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Log level</Label>
                  <Select {...form.register('logLevel')}>
                    {data.options.logLevel.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Request forward mode</Label>
                  <Select {...form.register('requestForwardMode')}>
                    {data.options.requestForwardMode.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Backend origin</Label>
                  <Input placeholder="https://api.openai.com" {...form.register('backendOrigin')} />
                  {form.formState.errors.backendOrigin ? (
                    <p className="text-xs text-warning">{form.formState.errors.backendOrigin.message}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Streaming</Label>
                    <Switch {...form.register('responseStreamEnabled')} />
                  </div>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Chunk size</Label>
                      <Input type="number" min={128} max={65536} {...form.register('responseStreamChunkSize', { valueAsNumber: true })} />
                    </div>
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Chunk overlap</Label>
                      <Input type="number" min={0} {...form.register('responseStreamChunkOverlap', { valueAsNumber: true })} />
                      {form.formState.errors.responseStreamChunkOverlap ? (
                        <p className="text-xs text-warning">{form.formState.errors.responseStreamChunkOverlap.message as string}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Final inspection</span>
                      <Switch {...form.register('responseStreamFinalEnabled')} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Collect full response</span>
                      <Switch {...form.register('responseStreamCollectFullEnabled')} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Chunk gating (passthrough)</span>
                      <Switch {...form.register('responseStreamChunkGatingEnabled')} />
                    </div>
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Buffering mode</Label>
                      <Select {...form.register('responseStreamBufferingMode')}>
                        {data.options.responseStreamBufferingMode.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Extractors</Label>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Parallel</span>
                      <Switch {...form.register('extractorParallel')} />
                    </div>
                  </div>
                  <div className="mt-3 space-y-4 text-sm text-muted-foreground">
                    <ExtractorList
                      label="Request extractors"
                      items={requestExtractors || []}
                      options={requestOptions}
                      selection={requestSelection}
                      onSelectionChange={setRequestSelection}
                      onAdd={() => {
                        addExtractor('requestExtractors', requestSelection)
                        setRequestSelection('')
                      }}
                      onRemove={(val) => removeExtractor('requestExtractors', val)}
                      loading={patternsLoading}
                      labelFor={(val) => extractorLabels[val] || val}
                      emptyCopy="No request extractors selected. Choose a request-context pattern to add."
                    />
                    <ExtractorList
                      label="Response extractors"
                      items={responseExtractors || []}
                      options={responseOptions}
                      selection={responseSelection}
                      onSelectionChange={setResponseSelection}
                      onAdd={() => {
                        addExtractor('responseExtractors', responseSelection)
                        setResponseSelection('')
                      }}
                      onRemove={(val) => removeExtractor('responseExtractors', val)}
                      loading={patternsLoading}
                      labelFor={(val) => extractorLabels[val] || val}
                      emptyCopy="No response extractors selected. Add response or response stream patterns."
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={updateHost.isPending || !dirty}>
                  {updateHost.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </Button>
                {updateHost.isSuccess ? (
                  <Badge variant="muted" className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Applied
                  </Badge>
                ) : null}
                {isFetching ? <span className="text-xs text-muted-foreground">Refreshing…</span> : null}
              </div>
            </form>
          ) : (
            <p className="text-muted-foreground">No config loaded.</p>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

type ExtractorOption = { value: string; label: string }

type ExtractorListProps = {
  label: string
  items: string[]
  options: ExtractorOption[]
  selection: string
  onSelectionChange: (value: string) => void
  onAdd: () => void
  onRemove: (value: string) => void
  loading?: boolean
  labelFor: (value: string) => string
  emptyCopy: string
}

function ExtractorList({
  label,
  items,
  options,
  selection,
  onSelectionChange,
  onAdd,
  onRemove,
  loading,
  labelFor,
  emptyCopy,
}: ExtractorListProps) {
  const hasOptions = options.length > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
        {loading ? <span className="text-[11px] text-muted-foreground">Loading patterns…</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={selection}
          onChange={(e) => onSelectionChange(e.target.value)}
          className="h-9 flex-1"
          aria-label={`${label} selector`}
        >
          <option value="" disabled>
            {hasOptions ? 'Select pattern rule' : 'No patterns available'}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Button type="button" size="sm" onClick={onAdd} disabled={!selection}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      {items.length ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-foreground">
              <span>{labelFor(item)}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${labelFor(item)}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyCopy}</p>
      )}
    </div>
  )
}

function HostConfigSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, idx) => (
          <div key={idx} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-10" />
            </div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-52" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  )
}
