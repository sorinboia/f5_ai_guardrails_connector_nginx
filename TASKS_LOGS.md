# Tasks: Logs Feature Implementation

> **Status:** Completed
> **Last Updated:** 2026-02-08

## Overview

Implementation tasks for the Logs feature as defined in [PRD_LOGS.md](./PRD_LOGS.md).

---

## Phase 1: Backend - Core Infrastructure

### 1.1 Ring Buffer Implementation
- [x] Create `node/src/logging/logBuffer.js`
- [x] Implement `LogRingBuffer` class
  - [x] Constructor with configurable `maxSize` (default: 1000)
  - [x] `push(entry)` - add entry, evict oldest if full
  - [x] `query(filters)` - return filtered, paginated results
  - [x] `clear()` - empty buffer, return count cleared
  - [x] `getAll(filters)` - return all matching entries
  - [x] `subscribe(filters, callback)` - register listener for new entries
  - [x] `unsubscribe(callback)` - remove listener
- [x] Add unit tests for ring buffer

### 1.2 Log Capture Integration
- [x] Create `node/src/logging/logCapture.js`
- [x] Create custom Pino transport/destination to intercept logs
- [x] Parse structured log fields into `LogEntry` format
- [x] Extract fields: `trace_id`, `host`, `phase`, `status`, `pattern_id`, etc.
- [x] Filter relevant logs (guardrail decisions + errors)
- [x] Push captured entries to ring buffer
- [x] Add unit tests for log capture

### 1.3 Environment Configuration
- [x] Add `LOG_BUFFER_SIZE` to `node/src/config/env.js`
- [x] Document in README or config docs

---

## Phase 2: Backend - API Routes

### 2.1 REST API
- [x] Create `node/src/routes/logs.js`
- [x] Implement `GET /logs/api`
  - [x] Parse query params (host, level, status, search, limit, before)
  - [x] Call `logBuffer.query()` with filters
  - [x] Return paginated response
- [x] Implement `POST /logs/api`
  - [x] Handle `action: clear`
  - [x] Return cleared count
- [x] Implement `GET /logs/api/export`
  - [x] Apply filters
  - [x] Return JSON file with Content-Disposition header
- [x] Add CORS/OPTIONS handlers
- [x] Add unit tests for REST endpoints

### 2.2 SSE Streaming
- [x] Implement `GET /logs/stream` in `node/src/routes/logs.js`
- [x] Set SSE headers (`Content-Type: text/event-stream`, etc.)
- [x] Parse filter query params
- [x] Subscribe to ring buffer with filters
- [x] Stream `event: log` for new entries
- [x] Send `event: ping` every 30 seconds
- [x] Handle client disconnect (cleanup subscription)
- [x] Add integration tests for SSE

### 2.3 Route Registration
- [x] Update `node/src/routes/index.js` to register logs routes
- [x] Enable only on management server (not proxy listeners)

---

## Phase 3: Backend - Server Integration

### 3.1 Wire Up Components
- [x] Update `node/src/server.js`
  - [x] Create shared `LogRingBuffer` instance
  - [x] Configure Pino with log capture destination
  - [x] Decorate Fastify with `logBuffer` reference
- [x] Verify logs flow: Pino → Capture → Buffer → SSE

### 3.2 End-to-End Testing
- [x] Manual test: make proxy requests, verify logs appear
- [x] Test SSE connection and real-time updates
- [x] Test filters work correctly
- [x] Test buffer eviction at max size

---

## Phase 4: Frontend - Types and Hooks

### 4.1 Type Definitions
- [x] Create `ui/src/lib/types/log.ts`
- [x] Define `LogEntry` interface
- [x] Define `LogFilters` interface
- [x] Define `LogsResponse` interface

### 4.2 API Hooks
- [x] Create `ui/src/lib/hooks/use-logs.ts`
  - [x] Fetch logs with filters and pagination
  - [x] Handle loading/error states
  - [x] Support "load more" pagination
- [x] Create `ui/src/lib/hooks/use-log-stream.ts`
  - [x] Manage SSE connection lifecycle
  - [x] Parse incoming events
  - [x] Merge streamed entries with existing state
  - [x] Handle reconnection on disconnect

---

## Phase 5: Frontend - Components

### 5.1 Filter Components
- [x] Implemented in `ui/src/routes/monitor/logs.tsx`
- [x] Host dropdown (reuse existing pattern)
- [x] Level multi-select (debug, info, warn, error)
- [x] Status multi-select (cleared, blocked, redacted, skipped, error)
- [x] Search input with debounce
- [x] Reset button

### 5.2 Log Table
- [x] Implemented in `ui/src/routes/monitor/logs.tsx`
- [x] Table columns: Time, Trace ID, Host, Phase, Status, Message
- [x] Status badge component with colors
- [x] Expandable row functionality
- [x] Virtual scrolling for performance (if needed)
- [x] Empty state when no logs

### 5.3 Log Detail Panel
- [x] Implemented in `ui/src/routes/monitor/logs.tsx`
- [x] JSON syntax highlighting
- [x] Copy to clipboard button
- [x] Link to pattern config (if pattern_id present)

### 5.4 Export/Clear Actions
- [x] Export button - trigger download
- [x] Clear button with confirmation dialog

---

## Phase 6: Frontend - Main Page

### 6.1 Logs Page Integration
- [x] Update `ui/src/routes/monitor/logs.tsx`
- [x] Replace scaffold with full implementation
- [x] Wire up filters, table, and detail panel
- [x] Add "Live" toggle button for SSE
- [x] Show connection status indicator
- [x] Handle loading and error states

### 6.2 Polish
- [x] Responsive layout
- [x] Keyboard navigation
- [x] Accessibility (ARIA labels, focus management)

---

## Phase 7: Testing and Documentation

### 7.1 Testing
- [x] Unit tests for all new components
- [x] Integration tests for API endpoints
- [ ] E2E test: full flow from proxy request to UI display

### 7.2 Documentation
- [ ] Update README with logs feature description
- [ ] Document `LOG_BUFFER_SIZE` env var
- [ ] Add usage examples

---

## Progress Summary

| Phase | Description | Status | Progress |
|-------|-------------|--------|----------|
| 1 | Backend - Core Infrastructure | Completed | 10/10 |
| 2 | Backend - API Routes | Completed | 12/12 |
| 3 | Backend - Server Integration | Completed | 6/6 |
| 4 | Frontend - Types and Hooks | Completed | 6/6 |
| 5 | Frontend - Components | Completed | 12/12 |
| 6 | Frontend - Main Page | Completed | 6/6 |
| 7 | Testing and Documentation | Partial | 3/5 |

**Total Progress: 55/57 tasks completed**

## Files Created/Modified

### Created
- `node/src/logging/logBuffer.js` - Ring buffer implementation
- `node/src/logging/logCapture.js` - Pino log capture hook
- `node/src/routes/logs.js` - REST API and SSE routes
- `node/test/logging/logBuffer.test.js` - Ring buffer tests
- `node/test/logging/logCapture.test.js` - Log capture tests
- `node/test/logging/logsRoutes.test.js` - API routes tests
- `ui/src/lib/types/log.ts` - TypeScript types
- `ui/src/lib/hooks/use-logs.ts` - React Query hooks
- `ui/src/lib/hooks/use-log-stream.ts` - SSE stream hook

### Modified
- `node/src/config/env.js` - Added LOG_BUFFER_SIZE config
- `node/src/server.js` - Integrated log buffer and capture
- `node/src/routes/index.js` - Registered logs routes
- `ui/src/lib/api/http.ts` - Added logs API functions
- `ui/src/lib/hooks/query-keys.ts` - Added logs query key
- `ui/src/routes/monitor/logs.tsx` - Full logs page implementation
