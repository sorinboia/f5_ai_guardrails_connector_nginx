import { useEffect, useMemo, useState } from 'react'
import { Filter, Loader2, Plus, Trash2 } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { PageHeader } from '@/components/shared/page-header'
import { Pagination } from '@/components/shared/pagination'
import { SectionCard } from '@/components/shared/section-card'
import { TableSkeleton } from '@/components/shared/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { useApiKeys, useCreatePattern, useDeletePattern, usePatterns, useUpdatePattern } from '@/lib/hooks/use-resources'
import type { PatternRule } from '@/lib/types/pattern'
import { patternRuleFormSchema } from '@/lib/validation'

type FormValues = z.infer<typeof patternRuleFormSchema>

type ApiError = {
  status?: number
  message?: string
  error?: string
  errors?: string[]
}

function toLines(list?: string[]) {
  return (list || []).join('\n')
}

function parseLines(value?: string) {
  if (!value) return []
  return value
    .split(/\n|,/)
    .map((v) => v.trim())
    .filter(Boolean)
}

const defaultFormValues: FormValues = {
  name: '',
  context: 'request',
  apiKeyName: '',
  paths: '',
  matchers: [{ path: '', equals: '', contains: '', exists: false }],
  notes: '',
}

export default function PatternRulesPage() {
  const { data: patterns, isLoading } = usePatterns()
  const { data: apiKeys } = useApiKeys()
  const createPattern = useCreatePattern()
  const updatePattern = useUpdatePattern()
  const deletePattern = useDeletePattern()

  const [contextFilter, setContextFilter] = useState<'all' | PatternRule['context']>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const pageSize = 6

  const editingItem = useMemo(() => patterns?.find((p) => p.id === editingId), [patterns, editingId])

  const form = useForm<FormValues>({
    resolver: zodResolver(patternRuleFormSchema),
    defaultValues: defaultFormValues,
  })

  const matcherArray = useFieldArray({ control: form.control, name: 'matchers' })

  // eslint-disable-next-line react-hooks/incompatible-library
  const context = form.watch('context')
  const liveMatchers = form.watch('matchers')

  const errMsg = (err: unknown) => {
    if (typeof err === 'object' && err) {
      const apiErr = err as ApiError
      if (apiErr.errors?.length) return apiErr.errors.join('; ')
      if (apiErr.message) return apiErr.message
      if (apiErr.error) return apiErr.error
      if (apiErr.status) return `Request failed (${apiErr.status})`
    }
    if (err instanceof Error) return err.message
    return 'Unexpected error'
  }

  useEffect(() => {
    if (editingItem) {
      form.reset({
        id: editingItem.id,
        name: editingItem.name,
        context: editingItem.context,
        apiKeyName: editingItem.apiKeyName,
        paths: toLines(editingItem.paths),
        matchers:
          editingItem.matchers.length > 0
            ? editingItem.matchers
            : [{ path: '', equals: '', contains: '', exists: false }],
        notes: editingItem.notes || '',
      })
      matcherArray.replace(
        editingItem.matchers.length > 0
          ? editingItem.matchers
          : defaultFormValues.matchers
      )
    }
  }, [editingItem, form, matcherArray])

  const resetToDefaults = () => {
    form.reset(defaultFormValues)
    matcherArray.replace(defaultFormValues.matchers)
  }

  const openCreate = () => {
    setEditingId(null)
    setSubmitError(null)
    resetToDefaults()
    setIsFormOpen(true)
  }

  const openEdit = (id: string) => {
    setEditingId(id)
    setSubmitError(null)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    resetToDefaults()
    setIsFormOpen(false)
    setEditingId(null)
    setSubmitError(null)
  }

  const filtered = useMemo(() => {
    if (!patterns) return []
    const narrowed = contextFilter === 'all' ? patterns : patterns.filter((p) => p.context === contextFilter)
    const term = search.toLowerCase().trim()
    if (!term) return narrowed
    return narrowed.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.notes || '').toLowerCase().includes(term) ||
        p.paths.some((path) => path.toLowerCase().includes(term)),
    )
  }, [patterns, contextFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [search, contextFilter])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleSubmit = async (values: FormValues) => {
    const payload: Omit<PatternRule, 'id' | 'created_at' | 'updated_at'> = {
      name: values.name,
      context: values.context,
      apiKeyName: values.apiKeyName,
      paths: values.context === 'response_stream' ? [] : parseLines(values.paths),
      matchers: values.context === 'response_stream' ? [] : values.matchers,
      notes: values.notes || '',
    }

    try {
      setSubmitError(null)
      if (values.id) {
        await updatePattern.mutateAsync({ id: values.id, ...payload })
        toast({ title: 'Pattern updated', description: values.name })
      } else {
        if (patterns?.some((p) => p.name === values.name && p.context === values.context)) {
          const msg = 'Choose a unique name within the context.'
          setSubmitError(msg)
          toast({ title: 'Name exists for context', description: msg })
          return
        }
        await createPattern.mutateAsync(payload)
        toast({ title: 'Pattern created', description: values.name })
      }
      closeForm()
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Save failed', description: message })
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const confirmed = window.confirm(`Delete pattern ${name}?`)
    if (!confirmed) return
    try {
      setSubmitError(null)
      await deletePattern.mutateAsync(id)
      toast({ title: 'Pattern deleted', description: name })
      if (editingId === id) closeForm()
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Delete failed', description: message })
    }
  }

  useEffect(() => {
    setSubmitError(null)
  }, [editingId, context])

  const matcherPreview = useMemo(() => {
    const previewSource = (liveMatchers && liveMatchers.length ? liveMatchers : editingItem?.matchers) || []
    const list = previewSource
    const filtered = list.filter((m) => (m.path && m.path.trim()) || (m.equals && m.equals.trim()) || (m.contains && m.contains.trim()) || m.exists)
    if (!filtered.length) return null
    return (
      <div className="flex flex-wrap gap-1">
        {filtered.map((m, idx) => (
          <Badge key={`preview-${idx}`} variant="outline">
            {(m.path || 'path')}
            {m.equals ? ` = ${m.equals}` : m.contains ? ` ~ ${m.contains}` : m.exists ? ' exists' : ''}
          </Badge>
        ))}
      </div>
    )
  }, [editingItem, liveMatchers])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pattern Rules"
        description="Build matchers per context and tie them to API keys."
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New rule
          </Button>
        }
      />

      <SectionCard
        title="Rules"
        description="Listing from /config/api/patterns"
        actions={
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Input
              placeholder="Search name, note, or path"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-48"
            />
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <Select
                value={contextFilter}
                onChange={(e) => setContextFilter(e.target.value as 'all' | PatternRule['context'])}
                className="w-44"
              >
                <option value="all">All contexts</option>
                <option value="request">request</option>
                <option value="response">response</option>
                <option value="response_stream">response_stream</option>
              </Select>
            </div>
          </div>
        }
      >
        {isLoading ? (
          <TableSkeleton columns={5} rows={4} />
        ) : filtered.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Context</TH>
                <TH>API key</TH>
                <TH>Paths</TH>
                <TH>Matchers</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {pageItems.map((item) => (
                <TR key={item.id}>
                  <TD className="font-semibold">{item.name}</TD>
                  <TD>
                    <Badge variant="muted">{item.context}</Badge>
                  </TD>
                  <TD>{item.apiKeyName}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {item.paths.length ? (
                      <div className="flex flex-wrap gap-1">
                        {item.paths.map((path) => (
                          <Badge key={path} variant="outline">
                            {path}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD className="text-xs text-muted-foreground">
                    {item.matchers.length ? (
                      <div className="flex flex-wrap gap-1">
                        {item.matchers.map((m, idx) => (
                          <Badge key={`${item.id}-${idx}`} variant="muted">
                            {m.path || 'path'} {m.equals ? `= ${m.equals}` : m.contains ? `~ ${m.contains}` : m.exists ? 'exists' : ''}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD className="space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id, item.name)}>
                      <Trash2 className="mr-1 h-4 w-4 text-warning" />
                      Delete
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : search ? (
          <p className="text-sm text-muted-foreground">No rules match “{search}”.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No rules defined.</p>
        )}
        {filtered.length ? <div className="mt-4"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div> : null}
      </SectionCard>

      <Modal
        open={isFormOpen}
        onClose={closeForm}
        title={editingId ? 'Edit rule' : 'Create rule'}
        description="Validates context-specific requirements."
      >
        {submitError ? (
          <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {submitError}
          </div>
        ) : null}
        <form className="space-y-3" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="response-guard" {...form.register('name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Context</Label>
              <Select
                {...form.register('context')}
                onChange={(e) => form.setValue('context', e.target.value as FormValues['context'])}
              >
                <option value="request">request</option>
                <option value="response">response</option>
                <option value="response_stream">response_stream</option>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>API key</Label>
              <Select {...form.register('apiKeyName')}>
                <option value="">Select key</option>
                {apiKeys?.map((k) => (
                  <option key={k.id} value={k.name}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {context !== 'response_stream' ? (
            <div className="space-y-2">
              <Label>JSON path</Label>
              <Textarea rows={3} placeholder=".something.example" {...form.register('paths')} />
              {form.formState.errors.paths ? (
                <p className="text-xs text-warning">{form.formState.errors.paths.message as string}</p>
              ) : null}
            </div>
          ) : null}

          {context !== 'response_stream' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Matchers</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => matcherArray.append({ path: '', equals: '', contains: '', exists: false })}
                >
                  <Plus className="mr-1 h-4 w-4" /> Add matcher
                </Button>
              </div>
              {matcherPreview ? (
                <div className="text-xs text-muted-foreground">
                  <p className="mb-1">Saved matchers preview</p>
                  {matcherPreview}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Add at least one matcher with equals/contains/exists.</p>
              )}
              <div className="space-y-3">
                {matcherArray.fields.map((field, index) => {
                  const matcherErrors = form.formState.errors.matchers?.[index]
                  return (
                    <div key={field.id} className="rounded-lg border p-3">
                      <div className="flex justify-between gap-2">
                        <Label className="text-xs uppercase">Path</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => matcherArray.remove(index)}
                          disabled={matcherArray.fields.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-warning" />
                        </Button>
                      </div>
                      <Input
                        {...form.register(`matchers.${index}.path` as const)}
                        placeholder="body.choices[].message"
                        className="mt-2"
                      />
                      {matcherErrors?.path ? (
                        <p className="mt-1 text-xs text-warning">{matcherErrors.path.message as string}</p>
                      ) : null}
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        <Input placeholder="equals" {...form.register(`matchers.${index}.equals` as const)} />
                        <Input placeholder="contains" {...form.register(`matchers.${index}.contains` as const)} />
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input type="checkbox" {...form.register(`matchers.${index}.exists` as const)} /> exists
                        </label>
                      </div>
                      {matcherErrors?.equals ? (
                        <p className="mt-1 text-xs text-warning">{matcherErrors.equals.message as string}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">Provide path + at least one of equals/contains/exists.</p>
                    </div>
                  )
                })}
              </div>
              {form.formState.errors.matchers ? (
                <p className="text-xs text-warning">Matchers need a path plus equals/contains/exists.</p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <p className="text-sm font-medium text-foreground">response_stream context</p>
              <p className="mt-1">
                Paths and matchers are ignored by the backend for streaming responses. They remain stored here only for
                documentation so you can keep notes on observed fields.
              </p>
              {matcherPreview ? (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-muted-foreground">Saved matchers (ignored during stream inspection):</p>
                  {matcherPreview}
                </div>
              ) : (
                <p className="mt-2">No saved matchers.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={2} placeholder="Optional context" {...form.register('notes')} />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={createPattern.isPending || updatePattern.isPending}>
              {(createPattern.isPending || updatePattern.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? 'Save changes' : 'Create rule'}
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
