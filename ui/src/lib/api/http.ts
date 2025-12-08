import type { ApiKey, BlockingResponse } from '@/lib/types/api-key'
import type { CollectorState } from '@/lib/types/collector'
import type { ConfigResponse, HostConfig, HostConfigPatch } from '@/lib/types/config'
import type { PatternRule } from '@/lib/types/pattern'
import type { StoreSnapshot } from '@/lib/types/store'

const baseUrl = new URL('/config', window.location.origin).toString().replace(/\/$/, '')

type RequestInitWithBody = RequestInit & { body?: BodyInit | null }

type ApiError = {
  status: number
  message?: string
  error?: string
  errors?: string[]
}

async function request<T>(path: string, init: RequestInitWithBody = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...init.headers,
    },
  })

  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const err: ApiError = typeof payload === 'object' && payload ? payload : { message: String(payload) }
    err.status = response.status
    throw err
  }

  return payload as T
}

export async function fetchConfig(host?: string) {
  const headers: Record<string, string> = {}
  if (host) headers['x-guardrails-config-host'] = host
  return request<ConfigResponse>('/api', { method: 'GET', headers })
}

export async function createHost(host: string) {
  return request<ConfigResponse>('/api', {
    method: 'POST',
    body: JSON.stringify({ host }),
    headers: { 'x-guardrails-config-host': host },
  })
}

export async function updateHost(host: string, patch: HostConfigPatch) {
  return request<ConfigResponse>('/api', {
    method: 'PATCH',
    body: JSON.stringify({ ...patch }),
    headers: { 'x-guardrails-config-host': host },
  })
}

export async function deleteHost(host: string) {
  return request<ConfigResponse>('/api', {
    method: 'DELETE',
    body: JSON.stringify({ host }),
    headers: { 'x-guardrails-config-host': host },
  })
}

export async function listApiKeys() {
  const res = await request<{ items: ApiKey[] }>('/api/keys')
  return res.items
}

export async function createApiKey(input: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>) {
  const res = await request<{ item: ApiKey }>('/api/keys', { method: 'POST', body: JSON.stringify(input) })
  return res.item
}

export async function updateApiKey(input: Partial<ApiKey> & { id: string }) {
  const res = await request<{ item: ApiKey }>('/api/keys', { method: 'PATCH', body: JSON.stringify(input) })
  return res.item
}

export async function deleteApiKey(id: string) {
  return request<{ removed: string }>('/api/keys', { method: 'DELETE', body: JSON.stringify({ id }) })
}

export async function listPatterns() {
  const res = await request<{ items: PatternRule[] }>('/api/patterns')
  return res.items
}

export async function createPattern(input: Omit<PatternRule, 'id' | 'created_at' | 'updated_at'>) {
  const res = await request<{ item: PatternRule }>('/api/patterns', { method: 'POST', body: JSON.stringify(input) })
  return res.item
}

export async function updatePattern(input: Partial<PatternRule> & { id: string }) {
  const res = await request<{ item: PatternRule }>('/api/patterns', { method: 'PATCH', body: JSON.stringify(input) })
  return res.item
}

export async function deletePattern(id: string) {
  return request<{ removed: string }>('/api/patterns', { method: 'DELETE', body: JSON.stringify({ id }) })
}

export async function fetchStore(): Promise<{ snapshot: StoreSnapshot; filename?: string; bytes: number }> {
  const response = await fetch(`${baseUrl}/api/store`, {
    method: 'GET',
    headers: { 'cache-control': 'no-store' },
  })
  const clone = response.clone()
  const text = await clone.text()
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const filenameHeader = response.headers.get('content-disposition') || ''
  const match = filenameHeader.match(/filename="?([^";]+)"?/)
  const filename = match ? match[1] : undefined
  const bytes = new TextEncoder().encode(text).byteLength
  return { snapshot: JSON.parse(text), filename, bytes }
}

export async function importStore(snapshot: StoreSnapshot) {
  return request('/api/store', { method: 'PUT', body: JSON.stringify(snapshot) })
}

export async function fetchCollector() {
  return request<CollectorState>('/collector/api', { method: 'GET' })
}

export async function updateCollectorCount(count: number) {
  return request<CollectorState>('/collector/api', { method: 'POST', body: JSON.stringify({ count }) })
}

export async function clearCollector() {
  return request<CollectorState>('/collector/api', { method: 'POST', body: JSON.stringify({ action: 'clear' }) })
}

export function redactKey(key: string) {
  if (!key) return ''
  if (key.length <= 6) return '*'.repeat(key.length)
  return `${key.slice(0, 3)}***${key.slice(-3)}`
}

export function buildHostPatch(values: HostConfig, baseline: HostConfig): HostConfigPatch {
  const keys = Object.keys(values) as (keyof HostConfig)[]
  const entries: [keyof HostConfig, HostConfig[keyof HostConfig]][] = []

  keys.forEach((key) => {
    const nextValue = values[key]
    const baseValue = baseline[key]
    if (Array.isArray(nextValue) && Array.isArray(baseValue)) {
      if (nextValue.join('|') !== baseValue.join('|')) {
        entries.push([key, nextValue])
      }
    } else if (nextValue !== baseValue) {
      entries.push([key, nextValue])
    }
  })

  return Object.fromEntries(entries) as HostConfigPatch
}

export function mapBlockingResponse(input?: BlockingResponse): BlockingResponse {
  if (!input) return { status: 200, contentType: 'application/json; charset=utf-8', body: '' }
  return {
    status: input.status ?? 200,
    contentType: input.contentType || 'application/json; charset=utf-8',
    body: input.body || '',
  }
}
