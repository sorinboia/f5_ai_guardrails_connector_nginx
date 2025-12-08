import type { HostConfig } from './config'
import type { ApiKey } from './api-key'
import type { PatternRule } from './pattern'
import type { CollectorState } from './collector'

export type StoreSnapshot = {
  version: number
  hosts: string[]
  hostConfigs: Record<string, Partial<HostConfig>>
  apiKeys: ApiKey[]
  patterns: PatternRule[]
  collector: CollectorState
}
