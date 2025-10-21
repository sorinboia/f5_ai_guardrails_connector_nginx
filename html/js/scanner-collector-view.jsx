// Guardrails payload collector module
(function (global) {
  const GuardrailsUI = global.GuardrailsUI;
  if (!GuardrailsUI) {
    throw new Error('Guardrails shared helpers must load before the collector module.');
  }
  const {
    STATUS_TONES,
    classNames,
    useAsyncCallback,
    SummaryPill,
    PayloadTree,
    MAX_SELECTORS
  } = GuardrailsUI;
  const { useState, useEffect } = React;

  function CollectorApp() {
    const [status, setStatus] = useState({ tone: 'muted', message: '' });
    const [loading, setLoading] = useState(true);
    const [collector, setCollector] = useState({ total: 0, remaining: 0, entries: [] });
    const [collectInput, setCollectInput] = useState('3');
    const [expandedEntries, setExpandedEntries] = useState([]);

    const totalCaptured = collector.entries ? collector.entries.length : 0;
    const quotaRemaining = collector.remaining || 0;

    const notify = (tone, message) => setStatus({ tone, message });

    const loadCollector = async () => {
      const resp = await fetch('/collector/api', { method: 'GET' });
      if (!resp.ok) throw new Error('Failed to load collector state');
      const data = await resp.json();
      setCollector({
        total: data.total || 0,
        remaining: data.remaining || 0,
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      setCollectInput(prev =>
        prev === '' ? String(data.remaining || data.total || 0) : prev
      );
    };

    useEffect(() => {
      (async () => {
        try {
          await loadCollector();
          notify('info', 'Collector state synced.');
        } catch (err) {
          notify('error', err.message || 'Failed to load collector state.');
        } finally {
          setLoading(false);
        }
      })();
    }, []);

    const [handleCollect, collecting] = useAsyncCallback(async () => {
      const parsed = parseInt(collectInput, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        notify('error', 'Enter a non-negative count.');
        return;
      }
      const capped = Math.min(parsed, MAX_SELECTORS * 4);
      const resp = await fetch('/collector/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: capped })
      });
      if (!resp.ok) {
        notify('error', 'Collector request failed.');
        return;
      }
      const data = await resp.json();
      setCollector({
        total: data.total || 0,
        remaining: data.remaining || 0,
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      setCollectInput(String(data.remaining || data.total || 0));
      setExpandedEntries([]);
      notify('success', `Collection armed for ${data.total || 0} pairs.`);
    });

    const [handleRefresh, refreshing] = useAsyncCallback(async () => {
      try {
        await loadCollector();
        notify('info', 'Collector entries refreshed.');
      } catch (err) {
        notify('error', err.message || 'Refresh failed.');
      }
    });

    const isExpanded = id => expandedEntries.includes(id);

    const toggleEntry = id => {
      setExpandedEntries(prev =>
        prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
      );
    };

    if (loading) {
      return (
        <div className="flex h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white shadow-sm">
          <span className="text-sm text-slate-500">Loading collector interface…</span>
        </div>
      );
    }

    return (
      <div className="space-y-8">
        {status.message ? (
          <div className={classNames('rounded-2xl border px-4 py-3 text-sm shadow-sm', STATUS_TONES[status.tone] || STATUS_TONES.muted)}>
            {status.message}
          </div>
        ) : null}

        <section className="grid gap-6 md:grid-cols-3">
          <SummaryPill label="Captured" value={`${totalCaptured}`} />
          <SummaryPill label="Remaining Quota" value={`${quotaRemaining}`} />
          <SummaryPill label="Configured Collectors" value={`${collector.total || 0}`} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Pairs to capture</label>
              <input
                type="number"
                min="0"
                value={collectInput}
                onChange={event => setCollectInput(event.target.value)}
                className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary focus:ring-primary"
              />
              <p className="text-xs text-slate-500">Collector resets existing samples when armed.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleCollect}
                disabled={collecting}
                className={classNames(
                  'inline-flex items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold text-white shadow',
                  'bg-blue-600 bg-primary',
                  collecting ? 'opacity-70' : 'hover:bg-blue-700 hover:bg-primary-dark'
                )}
              >
                {collecting ? 'Arming…' : 'Collect Pairs'}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className={classNames(
                  'inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-600',
                  refreshing ? 'opacity-70' : 'hover:bg-slate-100'
                )}
              >
                {refreshing ? 'Refreshing…' : 'Refresh Entries'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Collected Entries</h2>
              <p className="text-sm text-slate-500">
                Expand an entry to inspect captured request and response payloads.
              </p>
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
              {totalCaptured} captured
            </span>
          </header>

          {totalCaptured === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              No payloads captured yet. Arm the collector above and exercise the proxy.
            </div>
          ) : (
            <div className="space-y-4">
              {collector.entries.map((entry, index) => {
                const entryId = entry.id || `entry-${index}`;
                const expanded = isExpanded(entryId);
                return (
                  <article key={entryId} className="rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggleEntry(entryId)}
                      className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <span>
                        Pair {index + 1} •{' '}
                        <span className="font-normal text-slate-500">
                          {entry.collected_at ? new Date(entry.collected_at).toLocaleString() : 'timestamp unknown'}
                        </span>
                      </span>
                      <span className="text-xl text-slate-400">{expanded ? '−' : '+'}</span>
                    </button>
                    {expanded ? (
                      <div className="grid gap-6 border-t border-slate-100 px-5 py-6 md:grid-cols-2">
                        <PayloadTree
                          title="Request Payload"
                          bodyText={(entry.request && entry.request.body) || ''}
                        />
                        <PayloadTree
                          title="Response Payload"
                          bodyText={(entry.response && entry.response.body) || ''}
                        />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  GuardrailsUI.CollectorApp = CollectorApp;
})(window);
