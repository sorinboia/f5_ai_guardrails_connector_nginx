# PRD: Logs Feature

## Overview

Real-time log viewer for F5 AI Guardrails Connector that displays guardrail decisions and proxy errors through the management UI.

## Architecture

**Hybrid approach (Ring Buffer + SSE):**
- In-memory ring buffer stores recent log entries
- REST endpoint for initial load and history
- Server-Sent Events for real-time streaming
- Logs are ephemeral (lost on restart)

## Data Model

```typescript
interface LogEntry {
  id: string;                    // unique ID (e.g., "log_1234567890_abc")
  timestamp: string;             // ISO 8601
  trace_id: string;              // request correlation ID
  host: string;                  // target host (e.g., "api.openai.com")
  phase: 'request' | 'response' | 'response_stream' | 'proxy';
  status: 'cleared' | 'blocked' | 'redacted' | 'skipped' | 'error';
  pattern_id?: string;           // matched pattern ID
  pattern_name?: string;         // matched pattern name
  api_key_name?: string;         // API key used for inspection
  url: string;                   // request path
  method: string;                // HTTP method
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;               // human-readable summary
  details?: Record<string, any>; // additional context
}
```

## Backend API

### GET `/logs/api`

Returns paginated log history.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | - | Filter by host |
| `level` | string | - | Comma-separated levels (e.g., `warn,error`) |
| `status` | string | - | Comma-separated statuses (e.g., `blocked,error`) |
| `search` | string | - | Search in message/url/pattern_name |
| `limit` | number | 100 | Max entries to return (max: 1000) |
| `before` | string | - | Cursor for pagination (log ID) |

**Response:**
```json
{
  "items": [LogEntry],
  "total": 847,
  "hasMore": true,
  "cursor": "log_1234567890_abc"
}
```

### GET `/logs/stream`

SSE endpoint for real-time log streaming.

**Query Parameters:** Same filters as `/logs/api` (excluding pagination).

**Events:**
```
event: log
data: {"id":"log_...","timestamp":"...","level":"info",...}

event: ping
data: {"timestamp":"..."}
```

### POST `/logs/api`

Management actions.

**Request:**
```json
{ "action": "clear" }
```

**Response:**
```json
{ "cleared": 847 }
```

### GET `/logs/api/export`

Download logs as JSON file.

**Query Parameters:** Same filters as `/logs/api` (returns all matching, up to buffer size).

**Response:** JSON file download with `Content-Disposition` header.

## Configuration

New environment variable:

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_BUFFER_SIZE` | 1000 | Max log entries to retain in memory |

## Backend Implementation

### Ring Buffer (`node/src/logging/logBuffer.js`)

```javascript
class LogRingBuffer {
  constructor(maxSize = 1000)
  push(entry: LogEntry): void
  query(filters): { items, total, hasMore, cursor }
  clear(): number
  subscribe(filters, callback): unsubscribe
  getAll(filters): LogEntry[]
}
```

### Log Capture

Intercept Pino logs and capture guardrail-relevant entries:
- Steps matching: `request:*`, `response:*`, `proxy:*`, `stream:*`
- All `warn` and `error` level logs

### SSE Manager

Track active SSE connections, broadcast new entries to matching subscribers.

## UI Implementation

### Components

**LogsPage** (`ui/src/routes/monitor/logs.tsx`)
- Filter bar (host, level, status, search)
- Auto-refresh toggle (SSE connect/disconnect)
- Log table with virtual scrolling
- Export button
- Clear button

**LogTable**
- Columns: Time | Trace ID | Host | Phase | Status | Message
- Status badges with colors:
  - `cleared` → green
  - `blocked` → red
  - `redacted` → yellow
  - `skipped` → gray
  - `error` → red outline
- Expandable rows for details JSON

**LogDetailPanel**
- Full JSON view
- Copy to clipboard
- Link to pattern configuration (if pattern_id present)

### State Management

```typescript
interface LogsState {
  entries: LogEntry[];
  filters: {
    host: string;
    levels: string[];
    statuses: string[];
    search: string;
  };
  streaming: boolean;
  loading: boolean;
  hasMore: boolean;
  cursor: string | null;
}
```

### Hooks

- `useLogStream(filters)` - manages SSE connection
- `useLogs(filters)` - fetches log history with pagination

## UI Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│ Logs                                                            │
│ Real-time guardrail decisions and proxy events                  │
├─────────────────────────────────────────────────────────────────┤
│ [Host ▼] [Level ▼] [Status ▼] [Search...    ] [⟳ Live] [Export] │
├─────────────────────────────────────────────────────────────────┤
│ Time       │ Trace    │ Host          │ Phase │ Status │ Message│
│────────────┼──────────┼───────────────┼───────┼────────┼────────│
│ 14:32:01   │ a1b2c3   │ api.openai.com│ req   │🟢clear │ Pattern│
│ 14:32:00   │ d4e5f6   │ api.openai.com│ resp  │🔴block │ PII det│
│ 14:31:58   │ g7h8i9   │ __default__   │ proxy │🔴error │ Timeout│
│ ...        │          │               │       │        │        │
├─────────────────────────────────────────────────────────────────┤
│ ▼ Expanded: d4e5f6                                    [Copy]    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ {                                                           │ │
│ │   "id": "log_1234567890_abc",                               │ │
│ │   "trace_id": "d4e5f6",                                     │ │
│ │   "status": "blocked",                                      │ │
│ │   "pattern_name": "PII Detection",                          │ │
│ │   "details": { "outcome": "flagged", ... }                  │ │
│ │ }                                                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
node/src/
  logging/
    logger.js          (existing)
    logBuffer.js       (new - ring buffer)
    logCapture.js      (new - pino integration)
  routes/
    logs.js            (new - API routes)
    index.js           (update - register logs routes)

ui/src/
  routes/monitor/
    logs.tsx           (update - full implementation)
  components/logs/
    log-table.tsx      (new)
    log-filters.tsx    (new)
    log-detail.tsx     (new)
  lib/hooks/
    use-logs.ts        (new)
    use-log-stream.ts  (new)
  lib/types/
    log.ts             (new)
```

## Acceptance Criteria

1. **Ring Buffer**
   - [ ] Stores up to configured max entries (default 1000)
   - [ ] Oldest entries evicted when full
   - [ ] Thread-safe for concurrent writes

2. **REST API**
   - [ ] GET `/logs/api` returns filtered, paginated logs
   - [ ] POST `/logs/api` with `action: clear` empties buffer
   - [ ] GET `/logs/api/export` downloads filtered logs as JSON

3. **SSE Streaming**
   - [ ] GET `/logs/stream` establishes SSE connection
   - [ ] New logs broadcast to connected clients
   - [ ] Filters applied server-side
   - [ ] Ping events every 30s to keep connection alive

4. **Log Capture**
   - [ ] Captures all guardrail decision logs
   - [ ] Captures proxy errors
   - [ ] Extracts structured fields (host, phase, status, etc.)

5. **UI**
   - [ ] Displays log table with all columns
   - [ ] Filters work (host, level, status, search)
   - [ ] Live toggle connects/disconnects SSE
   - [ ] Expandable rows show full details
   - [ ] Export downloads JSON file
   - [ ] Clear button empties logs with confirmation

6. **Performance**
   - [ ] UI handles 1000 entries smoothly (virtual scrolling)
   - [ ] SSE doesn't leak connections
   - [ ] No memory growth beyond buffer size
