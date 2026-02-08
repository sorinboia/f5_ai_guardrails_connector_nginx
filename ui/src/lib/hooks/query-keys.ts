import type { LogFilters } from '@/lib/types/log'

export const queryKeys = {
  hosts: ['hosts'] as const,
  hostConfig: (host: string) => ['hostConfig', host] as const,
  apiKeys: ['apiKeys'] as const,
  patterns: ['patterns'] as const,
  collector: ['collector'] as const,
  store: ['store'] as const,
  logs: (filters?: LogFilters) => ['logs', filters] as const,
}
