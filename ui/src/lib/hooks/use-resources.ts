import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  clearCollector,
  createApiKey,
  createPattern,
  deleteApiKey,
  deletePattern,
  fetchCollector,
  fetchStore,
  importStore,
  listApiKeys,
  listPatterns,
  updateApiKey,
  updateCollectorCount,
  updatePattern,
} from '@/lib/api/http'
import type { ApiKey, PatternRule, StoreSnapshot } from '@/lib/types'
import { queryKeys } from './query-keys'

export function useApiKeys() {
  return useQuery({ queryKey: queryKeys.apiKeys, queryFn: listApiKeys })
}

export function usePatterns() {
  return useQuery({ queryKey: queryKeys.patterns, queryFn: listPatterns })
}

export function useCollector() {
  return useQuery({ queryKey: queryKeys.collector, queryFn: fetchCollector })
}

export function useStoreDownload() {
  return useQuery({ queryKey: queryKeys.store, queryFn: fetchStore, staleTime: 0, gcTime: 0 })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>) => createApiKey(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.apiKeys })
      const previous = qc.getQueryData<ApiKey[]>(queryKeys.apiKeys) || []
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()
      const optimistic: ApiKey = { ...input, id: tempId, created_at: now, updated_at: now }
      qc.setQueryData(queryKeys.apiKeys, [...previous, optimistic])
      return { previous, tempId }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.apiKeys, ctx.previous)
    },
    onSuccess: (item, _input, ctx) => {
      qc.setQueryData<ApiKey[]>(queryKeys.apiKeys, (current: ApiKey[] = []) => {
        const withoutTemp = ctx?.tempId ? current.filter((k) => k.id !== ctx.tempId) : current
        return [...withoutTemp, item]
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  })
}

export function useUpdateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<ApiKey> & { id: string }) => updateApiKey(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.apiKeys })
      const previous = qc.getQueryData<ApiKey[]>(queryKeys.apiKeys) || []
      const optimistic = previous.map((item) =>
        item.id === input.id
          ? {
              ...item,
              ...input,
              blockingResponse: input.blockingResponse ?? item.blockingResponse,
              updated_at: new Date().toISOString(),
            }
          : item,
      )
      qc.setQueryData(queryKeys.apiKeys, optimistic)
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.apiKeys, ctx.previous)
    },
    onSuccess: (item) => {
      qc.setQueryData<ApiKey[]>(queryKeys.apiKeys, (current: ApiKey[] = []) =>
        current.map((k) => (k.id === item.id ? item : k)),
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.apiKeys })
      const previous = qc.getQueryData<ApiKey[]>(queryKeys.apiKeys) || []
      qc.setQueryData(
        queryKeys.apiKeys,
        previous.filter((item) => item.id !== id),
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.apiKeys, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  })
}

export function useCreatePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<PatternRule, 'id' | 'created_at' | 'updated_at'>) => createPattern(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.patterns })
      const previous = qc.getQueryData<PatternRule[]>(queryKeys.patterns) || []
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()
      const optimistic: PatternRule = { ...input, id: tempId, created_at: now, updated_at: now }
      qc.setQueryData(queryKeys.patterns, [...previous, optimistic])
      return { previous, tempId }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.patterns, ctx.previous)
    },
    onSuccess: (item, _input, ctx) => {
      qc.setQueryData<PatternRule[]>(queryKeys.patterns, (current: PatternRule[] = []) => {
        const withoutTemp = ctx?.tempId ? current.filter((p) => p.id !== ctx.tempId) : current
        return [...withoutTemp, item]
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.patterns }),
  })
}

export function useUpdatePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<PatternRule> & { id: string }) => updatePattern(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.patterns })
      const previous = qc.getQueryData<PatternRule[]>(queryKeys.patterns) || []
      const optimistic = previous.map((item) =>
        item.id === input.id
          ? {
              ...item,
              ...input,
              matchers: input.matchers ?? item.matchers,
              paths: input.paths ?? item.paths,
              updated_at: new Date().toISOString(),
            }
          : item,
      )
      qc.setQueryData(queryKeys.patterns, optimistic)
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.patterns, ctx.previous)
    },
    onSuccess: (item) => {
      qc.setQueryData<PatternRule[]>(queryKeys.patterns, (current: PatternRule[] = []) =>
        current.map((p) => (p.id === item.id ? item : p)),
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.patterns }),
  })
}

export function useDeletePattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePattern(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.patterns })
      const previous = qc.getQueryData<PatternRule[]>(queryKeys.patterns) || []
      qc.setQueryData(
        queryKeys.patterns,
        previous.filter((item) => item.id !== id),
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.patterns, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.patterns }),
  })
}

export function useSetCollector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (count: number) => updateCollectorCount(count),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.collector }),
  })
}

export function useClearCollector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => clearCollector(),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.collector }),
  })
}

export function useImportStore() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshot: StoreSnapshot) => importStore(snapshot),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.store })
      qc.invalidateQueries({ queryKey: queryKeys.hostConfig('__default__') })
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys })
      qc.invalidateQueries({ queryKey: queryKeys.patterns })
    },
  })
}
