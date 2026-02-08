/**
 * Types for the Logs feature
 */

export type LogPhase = 'request' | 'response' | 'response_stream' | 'proxy'
export type LogStatus = 'cleared' | 'blocked' | 'redacted' | 'skipped' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  trace_id: string
  host: string
  phase: LogPhase
  status: LogStatus
  pattern_id?: string
  pattern_name?: string
  api_key_name?: string
  url: string
  method: string
  level: LogLevel
  message: string
  details?: Record<string, unknown>
}

export interface LogsResponse {
  items: LogEntry[]
  total: number
  hasMore: boolean
  cursor: string | null
}

export interface LogFilters {
  host?: string
  level?: string
  status?: string
  search?: string
  limit?: number
  before?: string
}

export interface LogsState {
  entries: LogEntry[]
  filters: {
    host: string
    levels: string[]
    statuses: string[]
    search: string
  }
  streaming: boolean
  loading: boolean
  hasMore: boolean
  cursor: string | null
}
