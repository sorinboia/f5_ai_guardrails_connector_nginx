import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clearLogs, fetchLogs } from '@/lib/api/http'
import type { LogFilters } from '@/lib/types/log'
import { queryKeys } from './query-keys'

export function useLogs(filters: LogFilters = {}) {
  return useQuery({
    queryKey: queryKeys.logs(filters),
    queryFn: () => fetchLogs(filters),
    refetchInterval: false,
  })
}

export function useClearLogs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => clearLogs(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs'] })
    },
  })
}
