# Tasks: Logs Feature Implementation

> **Status:** Not Started
> **Last Updated:** 2026-02-08

## Overview

Implementation tasks for the Logs feature as defined in [PRD_LOGS.md](./PRD_LOGS.md).

---

## Phase 1: Backend - Core Infrastructure

### 1.1 Ring Buffer Implementation
- [ ] Create `node/src/logging/logBuffer.js`
- [ ] Implement `LogRingBuffer` class
  - [ ] Constructor with configurable `maxSize` (default: 1000)
  - [ ] `push(entry)` - add entry, evict oldest if full
  - [ ] `query(filters)` - return filtered, paginated results
  - [ ] `clear()` - empty buffer, return count cleared
  - [ ] `getAll(filters)` - return all matching entries
  - [ ] `subscribe(filters, callback)` - register listener for new entries
  - [ ] `unsubscribe(callback)` - remove listener
- [ ] Add unit tests for ring buffer

### 1.2 Log Capture Integration
- [ ] Create `node/src/logging/logCapture.js`
- [ ] Create custom Pino transport/destination to intercept logs
- [ ] Parse structured log fields into `LogEntry` format
- [ ] Extract fields: `trace_id`, `host`, `phase`, `status`, `pattern_id`, etc.
- [ ] Filter relevant logs (guardrail decisions + errors)
- [ ] Push captured entries to ring buffer
- [ ] Add unit tests for log capture

### 1.3 Environment Configuration
- [ ] Add `LOG_BUFFER_SIZE` to `node/src/config/env.js`
- [ ] Document in README or config docs

---

## Phase 2: Backend - API Routes

### 2.1 REST API
- [ ] Create `node/src/routes/logs.js`
- [ ] Implement `GET /logs/api`
  - [ ] Parse query params (host, level, status, search, limit, before)
  - [ ] Call `logBuffer.query()` with filters
  - [ ] Return paginated response
- [ ] Implement `POST /logs/api`
  - [ ] Handle `action: clear`
  - [ ] Return cleared count
- [ ] Implement `GET /logs/api/export`
  - [ ] Apply filters
  - [ ] Return JSON file with Content-Disposition header
- [ ] Add CORS/OPTIONS handlers
- [ ] Add unit tests for REST endpoints

### 2.2 SSE Streaming
- [ ] Implement `GET /logs/stream` in `node/src/routes/logs.js`
- [ ] Set SSE headers (`Content-Type: text/event-stream`, etc.)
- [ ] Parse filter query params
- [ ] Subscribe to ring buffer with filters
- [ ] Stream `event: log` for new entries
- [ ] Send `event: ping` every 30 seconds
- [ ] Handle client disconnect (cleanup subscription)
- [ ] Add integration tests for SSE

### 2.3 Route Registration
- [ ] Update `node/src/routes/index.js` to register logs routes
- [ ] Enable only on management server (not proxy listeners)

---

## Phase 3: Backend - Server Integration

### 3.1 Wire Up Components
- [ ] Update `node/src/server.js`
  - [ ] Create shared `LogRingBuffer` instance
  - [ ] Configure Pino with log capture destination
  - [ ] Decorate Fastify with `logBuffer` reference
- [ ] Verify logs flow: Pino → Capture → Buffer → SSE

### 3.2 End-to-End Testing
- [ ] Manual test: make proxy requests, verify logs appear
- [ ] Test SSE connection and real-time updates
- [ ] Test filters work correctly
- [ ] Test buffer eviction at max size

---

## Phase 4: Frontend - Types and Hooks

### 4.1 Type Definitions
- [ ] Create `ui/src/lib/types/log.ts`
- [ ] Define `LogEntry` interface
- [ ] Define `LogFilters` interface
- [ ] Define `LogsResponse` interface

### 4.2 API Hooks
- [ ] Create `ui/src/lib/hooks/use-logs.ts`
  - [ ] Fetch logs with filters and pagination
  - [ ] Handle loading/error states
  - [ ] Support "load more" pagination
- [ ] Create `ui/src/lib/hooks/use-log-stream.ts`
  - [ ] Manage SSE connection lifecycle
  - [ ] Parse incoming events
  - [ ] Merge streamed entries with existing state
  - [ ] Handle reconnection on disconnect

---

## Phase 5: Frontend - Components

### 5.1 Filter Components
- [ ] Create `ui/src/components/logs/log-filters.tsx`
- [ ] Host dropdown (reuse existing pattern)
- [ ] Level multi-select (debug, info, warn, error)
- [ ] Status multi-select (cleared, blocked, redacted, skipped, error)
- [ ] Search input with debounce
- [ ] Reset button

### 5.2 Log Table
- [ ] Create `ui/src/components/logs/log-table.tsx`
- [ ] Table columns: Time, Trace ID, Host, Phase, Status, Message
- [ ] Status badge component with colors
- [ ] Expandable row functionality
- [ ] Virtual scrolling for performance (if needed)
- [ ] Empty state when no logs

### 5.3 Log Detail Panel
- [ ] Create `ui/src/components/logs/log-detail.tsx`
- [ ] JSON syntax highlighting
- [ ] Copy to clipboard button
- [ ] Link to pattern config (if pattern_id present)

### 5.4 Export/Clear Actions
- [ ] Export button - trigger download
- [ ] Clear button with confirmation dialog

---

## Phase 6: Frontend - Main Page

### 6.1 Logs Page Integration
- [ ] Update `ui/src/routes/monitor/logs.tsx`
- [ ] Replace scaffold with full implementation
- [ ] Wire up filters, table, and detail panel
- [ ] Add "Live" toggle button for SSE
- [ ] Show connection status indicator
- [ ] Handle loading and error states

### 6.2 Polish
- [ ] Responsive layout
- [ ] Keyboard navigation
- [ ] Accessibility (ARIA labels, focus management)

---

## Phase 7: Testing and Documentation

### 7.1 Testing
- [ ] Unit tests for all new components
- [ ] Integration tests for API endpoints
- [ ] E2E test: full flow from proxy request to UI display

### 7.2 Documentation
- [ ] Update README with logs feature description
- [ ] Document `LOG_BUFFER_SIZE` env var
- [ ] Add usage examples

---

## Progress Summary

| Phase | Description | Status | Progress |
|-------|-------------|--------|----------|
| 1 | Backend - Core Infrastructure | Not Started | 0/10 |
| 2 | Backend - API Routes | Not Started | 0/12 |
| 3 | Backend - Server Integration | Not Started | 0/6 |
| 4 | Frontend - Types and Hooks | Not Started | 0/6 |
| 5 | Frontend - Components | Not Started | 0/12 |
| 6 | Frontend - Main Page | Not Started | 0/6 |
| 7 | Testing and Documentation | Not Started | 0/5 |

**Total Progress: 0/57 tasks completed**
