export const queryKeys = {
  hosts: ['hosts'] as const,
  hostConfig: (host: string) => ['hostConfig', host] as const,
  apiKeys: ['apiKeys'] as const,
  patterns: ['patterns'] as const,
  collector: ['collector'] as const,
  store: ['store'] as const,
}
