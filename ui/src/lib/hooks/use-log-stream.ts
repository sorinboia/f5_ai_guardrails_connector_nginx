import { useCallback, useEffect, useRef, useState } from 'react'
import { getLogsStreamUrl } from '@/lib/api/http'
import type { LogEntry, LogFilters } from '@/lib/types/log'

interface UseLogStreamOptions {
  filters?: LogFilters
  enabled?: boolean
  maxEntries?: number
  onEntry?: (entry: LogEntry) => void
}

interface UseLogStreamResult {
  entries: LogEntry[]
  connected: boolean
  error: Error | null
  connect: () => void
  disconnect: () => void
  clear: () => void
}

export function useLogStream(options: UseLogStreamOptions = {}): UseLogStreamResult {
  const { filters = {}, enabled = false, maxEntries = 500, onEntry } = options

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    setEntries([])
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setConnected(false)
  }, [])

  const connect = useCallback(() => {
    // Clean up any existing connection
    disconnect()

    const url = getLogsStreamUrl(filters)

    try {
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.addEventListener('connected', () => {
        setConnected(true)
        setError(null)
      })

      eventSource.addEventListener('log', (event) => {
        try {
          const entry = JSON.parse(event.data) as LogEntry
          setEntries((prev) => {
            const next = [entry, ...prev]
            // Limit entries to prevent memory issues
            return next.slice(0, maxEntries)
          })
          onEntry?.(entry)
        } catch (err) {
          console.error('Failed to parse log entry:', err)
        }
      })

      eventSource.addEventListener('ping', () => {
        // Ping received, connection is alive
      })

      eventSource.onerror = (event) => {
        console.error('SSE error:', event)
        setConnected(false)
        setError(new Error('Connection lost'))

        // Close the current connection
        eventSource.close()
        eventSourceRef.current = null

        // Attempt to reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (enabled) {
            connect()
          }
        }, 5000)
      }

      eventSource.onopen = () => {
        setConnected(true)
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to connect'))
      setConnected(false)
    }
  }, [disconnect, filters, maxEntries, onEntry, enabled])

  // Auto-connect when enabled changes
  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [enabled, connect, disconnect])

  // Reconnect when filters change (if enabled)
  useEffect(() => {
    if (enabled && eventSourceRef.current) {
      connect()
    }
  }, [JSON.stringify(filters)])

  return {
    entries,
    connected,
    error,
    connect,
    disconnect,
    clear,
  }
}
