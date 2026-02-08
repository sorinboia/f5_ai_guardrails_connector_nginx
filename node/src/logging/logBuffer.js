/**
 * Ring buffer for storing log entries with filtering and subscription support.
 * Entries are evicted FIFO when the buffer reaches max capacity.
 */

/**
 * Generate a unique log ID
 * @returns {string} ID in format "log_{timestamp}_{random}"
 */
function generateId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `log_${timestamp}_${random}`;
}

/**
 * Parse comma-separated filter values into a Set
 * @param {string|undefined} value
 * @returns {Set<string>|null}
 */
function parseFilterSet(value) {
  if (!value || typeof value !== 'string') return null;
  const items = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

/**
 * Check if entry matches the given filters
 * @param {Object} entry - Log entry
 * @param {Object} filters - Filter criteria
 * @returns {boolean}
 */
function matchesFilters(entry, filters) {
  // Host filter
  if (filters.host && entry.host !== filters.host) {
    return false;
  }

  // Level filter (comma-separated)
  if (filters.levelSet && !filters.levelSet.has(entry.level?.toLowerCase())) {
    return false;
  }

  // Status filter (comma-separated)
  if (filters.statusSet && !filters.statusSet.has(entry.status?.toLowerCase())) {
    return false;
  }

  // Search filter (message, url, pattern_name)
  if (filters.searchLower) {
    const searchIn = [
      entry.message || '',
      entry.url || '',
      entry.pattern_name || ''
    ].join(' ').toLowerCase();
    if (!searchIn.includes(filters.searchLower)) {
      return false;
    }
  }

  return true;
}

/**
 * Prepare filters for efficient matching
 * @param {Object} rawFilters
 * @returns {Object}
 */
function prepareFilters(rawFilters = {}) {
  return {
    host: rawFilters.host || null,
    levelSet: parseFilterSet(rawFilters.level),
    statusSet: parseFilterSet(rawFilters.status),
    searchLower: rawFilters.search ? rawFilters.search.toLowerCase() : null
  };
}

export class LogRingBuffer {
  /**
   * @param {number} maxSize - Maximum entries to retain (default: 1000)
   */
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.entries = [];
    this.subscribers = new Map();
    this._subscriberId = 0;
  }

  /**
   * Add a log entry to the buffer
   * @param {Object} entry - Log entry (id and timestamp will be added if missing)
   */
  push(entry) {
    const logEntry = {
      ...entry,
      id: entry.id || generateId(),
      timestamp: entry.timestamp || new Date().toISOString()
    };

    this.entries.push(logEntry);

    // Evict oldest entries if over capacity
    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    // Notify subscribers
    this._notifySubscribers(logEntry);
  }

  /**
   * Query log entries with filters and pagination
   * @param {Object} filters - Filter criteria
   * @param {string} [filters.host] - Filter by host
   * @param {string} [filters.level] - Comma-separated levels
   * @param {string} [filters.status] - Comma-separated statuses
   * @param {string} [filters.search] - Search in message/url/pattern_name
   * @param {number} [filters.limit=100] - Max entries to return (max: 1000)
   * @param {string} [filters.before] - Cursor (log ID) for pagination
   * @returns {{items: Array, total: number, hasMore: boolean, cursor: string|null}}
   */
  query(filters = {}) {
    const prepared = prepareFilters(filters);
    const limit = Math.min(Math.max(1, filters.limit || 100), 1000);
    const before = filters.before || null;

    // Filter entries
    let filtered = this.entries.filter(e => matchesFilters(e, prepared));
    const total = filtered.length;

    // Apply cursor pagination (entries before the cursor ID)
    if (before) {
      const cursorIndex = filtered.findIndex(e => e.id === before);
      if (cursorIndex > 0) {
        filtered = filtered.slice(0, cursorIndex);
      }
    }

    // Return newest first, limited
    const reversed = [...filtered].reverse();
    const items = reversed.slice(0, limit);
    const hasMore = reversed.length > limit;
    const cursor = items.length > 0 ? items[items.length - 1].id : null;

    return { items, total, hasMore, cursor };
  }

  /**
   * Clear all entries from the buffer
   * @returns {number} Number of entries cleared
   */
  clear() {
    const count = this.entries.length;
    this.entries = [];
    return count;
  }

  /**
   * Get all entries matching filters
   * @param {Object} filters - Filter criteria (same as query)
   * @returns {Array} All matching entries (newest first)
   */
  getAll(filters = {}) {
    const prepared = prepareFilters(filters);
    const filtered = this.entries.filter(e => matchesFilters(e, prepared));
    return [...filtered].reverse();
  }

  /**
   * Subscribe to new log entries
   * @param {Object} filters - Filter criteria for subscription
   * @param {Function} callback - Called with each new matching entry
   * @returns {Function} Unsubscribe function
   */
  subscribe(filters, callback) {
    const id = ++this._subscriberId;
    const prepared = prepareFilters(filters);

    this.subscribers.set(id, { filters: prepared, callback });

    return () => {
      this.subscribers.delete(id);
    };
  }

  /**
   * Get current entry count
   * @returns {number}
   */
  get size() {
    return this.entries.length;
  }

  /**
   * Notify all matching subscribers of a new entry
   * @private
   */
  _notifySubscribers(entry) {
    for (const [, sub] of this.subscribers) {
      if (matchesFilters(entry, sub.filters)) {
        try {
          sub.callback(entry);
        } catch (err) {
          // Ignore subscriber errors
        }
      }
    }
  }
}

// Export helper for testing
export { generateId, matchesFilters, prepareFilters };
