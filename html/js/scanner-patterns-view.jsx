// Guardrails patterns module
(function (global) {
  const GuardrailsUI = global.GuardrailsUI;
  if (!GuardrailsUI) {
    throw new Error('Guardrails shared helpers must load before the patterns module.');
  }
  const {
    ToastStack,
    StatusBanner,
    Modal,
    TopNavigation,
    PatternMultiSelector,
    PageHeader,
    KpiCard
  } = GuardrailsUI;
  const { useState, useEffect } = React;

  const PatternsApp = () => {
    const renderContextLabel = ctx => {
      if (!ctx) return '—';
      if (ctx === 'response_stream') return 'Response-stream';
      return ctx.charAt(0).toUpperCase() + ctx.slice(1);
    };

    const emptyForm = {
      name: '',
      context: 'request',
      apiKeyName: '',
      paths: '',
      matchers: ''
    };
    const [patterns, setPatterns] = useState([]);
    const [apiKeys, setApiKeys] = useState([]);
    const [status, setStatus] = useState({ tone: 'loading', message: 'Loading pattern rules…' });
    const [toasts, setToasts] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState('create');
    const [editingRecord, setEditingRecord] = useState(null);

    const pushToast = (tone, message) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, tone, message }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, 4200);
    };

    const dismissToast = id => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    };

    const loadAll = async () => {
      try {
        setStatus({ tone: 'loading', message: 'Loading pattern rules…' });
        const [patternResp, keyResp] = await Promise.all([
          fetch('/config/api/patterns', { headers: { Accept: 'application/json' } }),
          fetch('/config/api/keys', { headers: { Accept: 'application/json' } })
        ]);
        if (!patternResp.ok) throw new Error(`Patterns request failed (${patternResp.status})`);
        if (!keyResp.ok) throw new Error(`API keys request failed (${keyResp.status})`);
        const patternData = await patternResp.json();
        const keyData = await keyResp.json();
        const patternItems = Array.isArray(patternData.items) ? patternData.items : [];
        setPatterns(patternItems);
        const keyItems = Array.isArray(keyData.items) ? keyData.items : [];
        setApiKeys(keyItems);
        setStatus({
          tone: 'success',
          message: `Loaded ${patternItems.length} pattern rule${patternItems.length === 1 ? '' : 's'}.`
        });
      } catch (error) {
        const message = `Unable to load configuration: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
      }
    };

    useEffect(() => {
      loadAll();
    }, []);

    const totalPatterns = patterns.length;
    const totalKeys = apiKeys.length;

    const stringifyMatchers = matcherList => {
      if (!Array.isArray(matcherList)) return '';
      return matcherList
        .map(item => {
          if (!item || !item.path) return '';
          if (item.equals !== undefined) return `${item.path} => equals:${item.equals}`;
          if (item.contains !== undefined) return `${item.path} => contains:${item.contains}`;
          if ('exists' in item && item.exists) return item.path;
          return item.path;
        })
        .filter(Boolean)
        .join('\n');
    };

    const formatMatchers = matcherList => {
      if (!Array.isArray(matcherList) || !matcherList.length) return '—';
      return matcherList
        .map(matcher => {
          if (!matcher) return '';
          if (matcher.equals !== undefined) return `${matcher.path} equals “${matcher.equals}”`;
          if (matcher.contains !== undefined) return `${matcher.path} contains “${matcher.contains}”`;
          if (matcher.exists) return `${matcher.path} exists`;
          return matcher.path;
        })
        .filter(Boolean)
        .join(', ');
    };

    const parseListInput = text => text.split(/\r?\n/).map(item => item.trim()).filter(Boolean);

    const isResponseStream = form.context === 'response_stream';

    const openCreate = () => {
      const defaultKey = apiKeys.length ? apiKeys[0].name : '';
      setEditorMode('create');
      setEditingRecord(null);
      setForm({ ...emptyForm, apiKeyName: defaultKey });
      setEditorOpen(true);
    };

    const openEdit = pattern => {
      if (!pattern) return;
      setEditorMode('edit');
      setEditingRecord(pattern);
      setForm({
        name: pattern.name || '',
        context: pattern.context || 'request',
        apiKeyName: pattern.apiKeyName || (apiKeys.length ? apiKeys[0].name : ''),
        paths: Array.isArray(pattern.paths) ? pattern.paths.join('\n') : '',
        matchers: stringifyMatchers(pattern.matchers)
      });
      setEditorOpen(true);
    };

    const closeEditor = () => {
      setEditorOpen(false);
      setEditorMode('create');
      setEditingRecord(null);
      setForm({ ...emptyForm });
    };

    const handleFormChange = event => {
      const { name, value } = event.target;
      setForm(prev => ({ ...prev, [name]: value }));
    };

    const handleEditorSubmit = async event => {
      event.preventDefault();
      const name = (form.name || '').trim();
      const apiKeyName = (form.apiKeyName || '').trim();
      const paths = parseListInput(form.paths);
      const matchers = parseListInput(form.matchers)
        .map(line => {
          const [path, match] = line.split(/\s*=>\s*/);
          if (!path) return null;
          if (!match) {
            return { path: path.trim(), exists: true };
          }
          const eqMatch = match.match(/^equals:(.*)$/i);
          const containsMatch = match.match(/^contains:(.*)$/i);
          if (eqMatch) {
            return { path: path.trim(), equals: eqMatch[1].trim() };
          }
          if (containsMatch) {
            return { path: path.trim(), contains: containsMatch[1].trim() };
          }
          return { path: path.trim(), equals: match.trim() };
        })
        .filter(Boolean);

      if (!name || !apiKeyName) {
        pushToast('info', 'Provide name and API key.');
        return;
      }
      if (!isResponseStream && (!paths.length || !matchers.length)) {
        pushToast('info', 'Provide at least one extraction path and matcher.');
        return;
      }

      const payload = {
        name,
        context: form.context,
        apiKeyName,
        paths: isResponseStream ? [] : paths,
        matchers: isResponseStream ? [] : matchers
      };

      setSubmitting(true);
      try {
        if (editorMode === 'create') {
          const response = await fetch('/config/api/patterns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Request failed (${response.status})`);
          }
          pushToast('success', `Pattern “${name}” created.`);
          closeEditor();
          await loadAll();
        } else if (editingRecord && editingRecord.id) {
          const response = await fetch('/config/api/patterns', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ ...payload, id: editingRecord.id })
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Request failed (${response.status})`);
          }
          pushToast('success', `Pattern “${name}” updated.`);
          closeEditor();
          await loadAll();
        } else {
          throw new Error('Missing pattern identifier.');
        }
      } catch (error) {
        pushToast('error', `Save failed: ${error.message}`);
      } finally {
        setSubmitting(false);
      }
    };

    const handleDelete = async record => {
      if (!record || !record.id) return;
      const confirmed = window.confirm(`Delete pattern “${record.name}”?`);
      if (!confirmed) return;
      try {
        const response = await fetch('/config/api/patterns', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: record.id })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || data.error || `Request failed (${response.status})`);
        }
        pushToast('success', `Pattern “${record.name}” removed.`);
        await loadAll();
      } catch (error) {
        pushToast('error', `Delete failed: ${error.message}`);
      }
    };

    return (
      <>
        <TopNavigation current="patterns" />
        <ToastStack toasts={toasts} dismiss={dismissToast} />
        <div className="space-y-8">
          <PageHeader
            kicker="Routing logic"
            title="Pattern rules"
            description="Match incoming payloads to extraction selectors and API keys. Use patterns to route traffic to the right provider credentials."
            meta={`${totalPatterns} rules`}
            actions={(
              <>
                <button
                  type="button"
                  onClick={loadAll}
                  className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Refresh list
                </button>
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white shadow hover:bg-primary-dark disabled:opacity-60"
                  disabled={apiKeys.length === 0}
                >
                  New pattern
                </button>
              </>
            )}
          />
          <StatusBanner status={status} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="Patterns" value={totalPatterns} helper="Active matching rules" tone="emerald" />
            <KpiCard label="API keys" value={totalKeys} helper="Available for selection" tone="sky" />
            <KpiCard label="Last sync" value={status.message || '—'} helper="Pattern service" tone="amber" />
          </div>

          <div className="space-y-5 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Pattern Rules</h2>
                <p className="text-sm text-slate-500">Patterns evaluate JSON matchers and reference an API key.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={loadAll}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={openCreate}
                  className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-primary-dark disabled:opacity-60"
                  disabled={apiKeys.length === 0}
                >
                  New Pattern
                </button>
              </div>
            </div>

            {patterns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                No patterns configured yet.
              </div>
            ) : (
              <div className="space-y-4">
                {patterns.map(pattern => (
                  <div key={pattern.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-800">{pattern.name}</h3>
                        <p className="text-xs uppercase tracking-wide text-slate-400">
                          {renderContextLabel(pattern.context)} • API key {pattern.apiKeyName}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(pattern)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(pattern)}
                          className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 shadow-sm hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {pattern.context === 'response_stream' ? (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Full stream content is inspected; extraction paths and matchers do not apply.
                      </div>
                    ) : (
                      <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-400">Paths</p>
                          <p>{Array.isArray(pattern.paths) && pattern.paths.length ? pattern.paths.join(', ') : '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-400">Matchers</p>
                          <p>{formatMatchers(pattern.matchers)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>

        <Modal
          open={editorOpen}
          title={editorMode === 'create' ? 'New Pattern Rule' : `Edit ${editingRecord ? editingRecord.name : 'Pattern'}`}
          description="Patterns evaluate matchers and choose which API key Guardrails uses."
          onClose={() => {
            if (!submitting) {
              closeEditor();
            }
          }}
        >
          <form onSubmit={handleEditorSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="pattern-name">
                Rule Name
              </label>
              <input
                id="pattern-name"
                name="name"
                type="text"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={form.name}
                onChange={handleFormChange}
                placeholder="LLM request selectors"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="pattern-context">
                Context
              </label>
              <select
                id="pattern-context"
                name="context"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={form.context}
                onChange={handleFormChange}
                disabled={submitting}
              >
                <option value="request">Request</option>
                <option value="response">Response</option>
                <option value="response_stream">Response-stream</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="pattern-api-key">
                API Key
              </label>
              <select
                id="pattern-api-key"
                name="apiKeyName"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={form.apiKeyName}
                onChange={handleFormChange}
                disabled={submitting || apiKeys.length === 0}
              >
                {apiKeys.length === 0 ? <option value="">No API keys configured</option> : null}
                {apiKeys.map(key => (
                  <option key={key.id} value={key.name}>{key.name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Populate API keys on the dedicated page first.</p>
            </div>
            {!isResponseStream ? (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700" htmlFor="pattern-paths">
                    Extraction Paths
                  </label>
                  <textarea
                    id="pattern-paths"
                    name="paths"
                    rows="3"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                    value={form.paths}
                    onChange={handleFormChange}
                    placeholder=".messages[-1].content"
                    disabled={submitting}
                  ></textarea>
                  <p className="text-xs text-slate-500">Enter one JSON selector per line.</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700" htmlFor="pattern-matchers">
                    Matchers
                  </label>
                  <textarea
                    id="pattern-matchers"
                    name="matchers"
                    rows="4"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                    value={form.matchers}
                    onChange={handleFormChange}
                    placeholder={`.model => equals:llama3.1\n.messages[-1].role => equals:user`}
                    disabled={submitting}
                  ></textarea>
                  <p className="text-xs text-slate-500">
                    Use “path => equals:value”, “path => contains:value”, or “path” (for existence checks).
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Extraction Paths and Matchers are not required for Response-stream rules; the full stream is inspected.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                onClick={() => {
                  if (!submitting) {
                    closeEditor();
                  }
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
                disabled={submitting || apiKeys.length === 0}
              >
                {submitting ? 'Saving…' : editorMode === 'create' ? 'Save Pattern' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      </>
    );
  };

  GuardrailsUI.PatternsApp = PatternsApp;
})(window);
