import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { PageHeader } from '@/components/shared/page-header'
import { Pagination } from '@/components/shared/pagination'
import { SectionCard } from '@/components/shared/section-card'
import { TableSkeleton } from '@/components/shared/table-skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { useCreateApiKey, useDeleteApiKey, useApiKeys, useUpdateApiKey } from '@/lib/hooks/use-resources'
import { defaultBlockingResponse } from '@/lib/types/api-key'
import { redactKey } from '@/lib/api/http'
import { apiKeyFormSchema } from '@/lib/validation'

export default function ApiKeysPage() {
  const { data, isLoading } = useApiKeys()
  const createKey = useCreateApiKey()
  const updateKey = useUpdateApiKey()
  const deleteKey = useDeleteApiKey()
  const [showSecrets, setShowSecrets] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const pageSize = 6

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error')

  const editingItem = useMemo(() => data?.find((k) => k.id === editingId), [data, editingId])

  const filtered = useMemo(() => {
    if (!data) return []
    const term = search.toLowerCase().trim()
    if (!term) return data
    return data.filter((item) => item.name.toLowerCase().includes(term) || item.key.toLowerCase().includes(term))
  }, [data, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const form = useForm<z.infer<typeof apiKeyFormSchema>, undefined, z.input<typeof apiKeyFormSchema>>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: {
      name: '',
      key: '',
      status: defaultBlockingResponse.status,
      contentType: defaultBlockingResponse.contentType,
      body: defaultBlockingResponse.body,
    },
  })

  useEffect(() => {
    if (editingItem) {
      form.reset({
        id: editingItem.id,
        name: editingItem.name,
        key: editingItem.key,
        status: editingItem.blockingResponse.status,
        contentType: editingItem.blockingResponse.contentType,
        body: editingItem.blockingResponse.body,
      })
    }
  }, [editingItem, form])

  const resetToCreate = () => {
    setEditingId(null)
    setSubmitError(null)
    form.reset({
      name: '',
      key: '',
      status: defaultBlockingResponse.status,
      contentType: defaultBlockingResponse.contentType,
      body: defaultBlockingResponse.body,
    })
  }

  const openCreate = () => {
    resetToCreate()
    setIsFormOpen(true)
  }

  const openEdit = (id: string) => {
    setSubmitError(null)
    setEditingId(id)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    resetToCreate()
    setIsFormOpen(false)
  }

  const onSubmit = async (values: z.infer<typeof apiKeyFormSchema>) => {
    try {
      setSubmitError(null)
      if (values.id) {
        await updateKey.mutateAsync({
          id: values.id,
          name: values.name,
          key: values.key,
          blockingResponse: {
            status: values.status,
            contentType: values.contentType,
            body: values.body || '',
          },
        })
        toast({ title: 'API key updated', description: values.name })
      } else {
        if (data?.some((k) => k.name === values.name)) {
          toast({ title: 'Name must be unique', description: 'Choose a different name.' })
          return
        }
        await createKey.mutateAsync({
          name: values.name,
          key: values.key,
          blockingResponse: {
            status: values.status,
            contentType: values.contentType,
            body: values.body || '',
          },
        })
        toast({ title: 'API key created', description: values.name })
      }
      closeForm()
    } catch (err: unknown) {
      const message = errMsg(err)
      setSubmitError(message)
      toast({ title: 'Save failed', description: message })
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const confirmed = window.confirm(`Delete API key ${name}?`)
    if (!confirmed) return
    try {
      setSubmitError(null)
      await deleteKey.mutateAsync(id)
      toast({ title: 'API key deleted', description: name })
      if (editingId === id) closeForm()
    } catch (err: unknown) {
      toast({ title: 'Delete failed', description: errMsg(err) })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Manage connector keys and blocking responses."
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New key
          </Button>
        }
      />

      <SectionCard title="Keys" description="Existing keys pulled from /config/api/keys." actions={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name or key"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-48"
          />
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setShowSecrets((v) => !v)}>
            {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showSecrets ? 'Hide keys' : 'Show keys'}
          </Button>
        </div>
      }>
        {isLoading ? (
          <TableSkeleton columns={4} rows={4} />
        ) : filtered.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Key</TH>
                <TH>Status</TH>
                <TH>Updated</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {pageItems.map((item) => (
                <TR key={item.id}>
                  <TD className="font-semibold">{item.name}</TD>
                  <TD className="font-mono text-xs">{showSecrets ? item.key : redactKey(item.key)}</TD>
                  <TD>{item.blockingResponse.status}</TD>
                  <TD className="text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString()}</TD>
                  <TD className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item.id)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id, item.name)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-warning" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : search ? (
          <p className="text-sm text-muted-foreground">No keys match “{search}”.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        )}
        {filtered.length ? <div className="mt-4"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div> : null}
      </SectionCard>

      <Modal
        open={isFormOpen}
        onClose={closeForm}
        title={editingId ? 'Edit API key' : 'Create API key'}
        description="Validation mirrors /config/api/keys."
      >
        {submitError ? (
          <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" aria-live="polite">
            {submitError}
          </div>
        ) : null}
        <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="prod-key" {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-xs text-warning">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Key</Label>
            <Input placeholder="sk-..." {...form.register('key')} />
            {form.formState.errors.key ? <p className="text-xs text-warning">{form.formState.errors.key.message}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Blocking status</Label>
              <Input type="number" min={100} max={999} {...form.register('status', { valueAsNumber: true })} />
              {form.formState.errors.status ? (
                <p className="text-xs text-warning">{form.formState.errors.status.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Content-Type</Label>
              <Input placeholder="application/json" {...form.register('contentType')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Blocking body</Label>
            <Textarea rows={4} {...form.register('body')} />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={createKey.isPending || updateKey.isPending}>
              {(createKey.isPending || updateKey.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId ? 'Save changes' : 'Create key'}
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
