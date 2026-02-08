/**
 * Logs API routes for real-time log viewing in the management UI.
 * Provides REST endpoints for querying log history and SSE for real-time streaming.
 */

import fp from 'fastify-plugin';
import { respondJson, optionsReply } from './helpers.js';

/**
 * Parse query parameters for log filtering
 * @param {Object} query - Request query parameters
 * @returns {Object} Parsed filters
 */
function parseFilters(query) {
  const filters = {};

  if (query.host) {
    filters.host = query.host;
  }

  if (query.level) {
    filters.level = query.level;
  }

  if (query.status) {
    filters.status = query.status;
  }

  if (query.search) {
    filters.search = query.search;
  }

  if (query.limit) {
    const limit = parseInt(query.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      filters.limit = Math.min(limit, 1000);
    }
  }

  if (query.before) {
    filters.before = query.before;
  }

  return filters;
}

/**
 * Get request body as object
 * @param {Object} request - Fastify request
 * @returns {Object}
 */
function getBody(request) {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  try {
    return JSON.parse(request.body);
  } catch (err) {
    return {};
  }
}

async function logsRoutes(fastify) {
  // CORS preflight
  fastify.options('/logs/api', async (_, reply) => optionsReply(reply, 'GET, POST, OPTIONS', 'content-type'));
  fastify.options('/logs/api/export', async (_, reply) => optionsReply(reply, 'GET, OPTIONS', 'content-type'));
  fastify.options('/logs/stream', async (_, reply) => optionsReply(reply, 'GET, OPTIONS', 'content-type'));

  /**
   * GET /logs/api - Query log history with filtering and pagination
   *
   * Query Parameters:
   * - host: Filter by host
   * - level: Comma-separated levels (debug, info, warn, error)
   * - status: Comma-separated statuses (cleared, blocked, redacted, skipped, error)
   * - search: Search in message/url/pattern_name
   * - limit: Max entries to return (default: 100, max: 1000)
   * - before: Cursor (log ID) for pagination
   *
   * Response:
   * {
   *   items: LogEntry[],
   *   total: number,
   *   hasMore: boolean,
   *   cursor: string | null
   * }
   */
  fastify.get('/logs/api', async (request, reply) => {
    const logBuffer = fastify.logBuffer;
    if (!logBuffer) {
      return respondJson(reply, 503, { error: 'log_buffer_unavailable', message: 'Log buffer not initialized' });
    }

    const filters = parseFilters(request.query);
    const result = logBuffer.query(filters);

    return respondJson(reply, 200, result);
  });

  /**
   * POST /logs/api - Management actions
   *
   * Request body:
   * { action: 'clear' }
   *
   * Response:
   * { cleared: number }
   */
  fastify.post('/logs/api', async (request, reply) => {
    const logBuffer = fastify.logBuffer;
    if (!logBuffer) {
      return respondJson(reply, 503, { error: 'log_buffer_unavailable', message: 'Log buffer not initialized' });
    }

    const payload = getBody(request);

    if (payload.action === 'clear') {
      const cleared = logBuffer.clear();
      return respondJson(reply, 200, { cleared });
    }

    return respondJson(reply, 400, { error: 'invalid_action', message: 'Supported actions: clear' });
  });

  /**
   * GET /logs/api/export - Download logs as JSON file
   *
   * Query Parameters: Same as /logs/api (excluding pagination)
   *
   * Response: JSON file download with Content-Disposition header
   */
  fastify.get('/logs/api/export', async (request, reply) => {
    const logBuffer = fastify.logBuffer;
    if (!logBuffer) {
      return respondJson(reply, 503, { error: 'log_buffer_unavailable', message: 'Log buffer not initialized' });
    }

    const filters = parseFilters(request.query);
    const items = logBuffer.getAll(filters);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `guardrails-logs-${timestamp}.json`;

    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store');

    return reply.send(JSON.stringify({ items, exported_at: new Date().toISOString() }, null, 2));
  });

  /**
   * GET /logs/stream - SSE endpoint for real-time log streaming
   *
   * Query Parameters: Same filters as /logs/api (excluding pagination)
   *
   * Events:
   * - event: log, data: LogEntry JSON
   * - event: ping, data: { timestamp: ISO8601 }
   */
  fastify.get('/logs/stream', async (request, reply) => {
    const logBuffer = fastify.logBuffer;
    if (!logBuffer) {
      return respondJson(reply, 503, { error: 'log_buffer_unavailable', message: 'Log buffer not initialized' });
    }

    const filters = parseFilters(request.query);

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Send initial connection message
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    // Subscribe to new log entries
    const unsubscribe = logBuffer.subscribe(filters, (entry) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      }
    });

    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      }
    }, 30000);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      clearInterval(pingInterval);
      unsubscribe();
    });

    // Keep the connection open
    return reply;
  });
}

export default fp(logsRoutes);
