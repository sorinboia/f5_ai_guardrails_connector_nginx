import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  buildHostPatch,
  createHost,
  deleteHost,
  fetchConfig,
  updateHost,
} from '@/lib/api/http'
import type { HostConfig } from '@/lib/types'
import { queryKeys } from './query-keys'

export function useHostConfig(host: string) {
  return useQuery({
    queryKey: queryKeys.hostConfig(host),
    queryFn: () => fetchConfig(host),
  })
}

export function useCreateHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (host: string) => createHost(host),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.hostConfig(res.host) })
      qc.invalidateQueries({ queryKey: queryKeys.hosts })
    },
  })
}

export function useUpdateHost(host: string, baseline?: HostConfig) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (values: HostConfig) => updateHost(host, baseline ? buildHostPatch(values, baseline) : values),
    onSuccess: (res) => {
      qc.setQueryData(queryKeys.hostConfig(host), res)
    },
  })
}

export function useDeleteHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (host: string) => deleteHost(host),
    onSuccess: (_, host) => {
      qc.removeQueries({ queryKey: queryKeys.hostConfig(host) })
      qc.invalidateQueries({ queryKey: queryKeys.hosts })
    },
  })
}
