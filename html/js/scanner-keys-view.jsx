// Guardrails API keys module
(function (global) {
  const GuardrailsUI = global.GuardrailsUI;
  if (!GuardrailsUI) {
    throw new Error('Guardrails shared helpers must load before the API keys module.');
  }
  const {
    ToastStack,
    StatusBanner,
    Modal,
    TopNavigation,
    PageHeader,
    Badge,
    SummaryPill,
    normalizeBlockingResponseConfig,
    createEmptyEditorForm,
    DEFAULT_BLOCKING_RESPONSE_SHAPE,
    blockingResponsesEqual,
    summarizeBlockingResponseBody
  } = GuardrailsUI;
  const { useState, useEffect, useMemo } = React;

  const ApiKeysApp = () => {
    const [keys, setKeys] = useState([]);
    const [status, setStatus] = useState({ tone: 'loading', message: 'Loading API keys…' });
    const [toasts, setToasts] = useState([]);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState('create');
    const [editingRecord, setEditingRecord] = useState(null);
    const [editorForm, setEditorForm] = useState(() => createEmptyEditorForm());
    const [editorSubmitting, setEditorSubmitting] = useState(false);

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

    const loadKeys = async () => {
      try {
        setStatus({ tone: 'loading', message: 'Loading API keys…' });
        const response = await fetch('/config/api/keys', {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const normalized = items.map(item => ({
          ...item,
          blockingResponse: normalizeBlockingResponseConfig(item.blockingResponse)
        }));
        setKeys(normalized);
        setStatus({ tone: 'success', message: `Loaded ${normalized.length} API key${normalized.length === 1 ? '' : 's'}.` });
      } catch (error) {
        const message = `Unable to load API keys: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
      }
    };

    useEffect(() => {
      loadKeys();
    }, []);

    const keyPreview = value => {
      if (!value) return '—';
      const trimmed = String(value).trim();
      if (trimmed.length <= 8) return trimmed;
      return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
    };

    const resetEditor = () => {
      setEditorForm(createEmptyEditorForm());
      setEditingRecord(null);
      setEditorMode('create');
    };

    const closeEditor = () => {
      setEditorOpen(false);
      resetEditor();
    };

    const openCreate = () => {
      setEditorMode('create');
      setEditingRecord(null);
      setEditorForm(createEmptyEditorForm());
      setEditorOpen(true);
    };

    const openEdit = record => {
      if (!record) return;
      const normalizedBlock = normalizeBlockingResponseConfig(record.blockingResponse);
      setEditorMode('edit');
      setEditingRecord(record);
      setEditorForm({
        name: record.name || '',
        key: '',
        blockStatus: String(normalizedBlock.status),
        blockContentType: normalizedBlock.contentType,
        blockBody: normalizedBlock.body
      });
      setEditorOpen(true);
    };

    const handleEditorChange = event => {
      const { name, value } = event.target;
      setEditorForm(prev => ({ ...prev, [name]: value }));
    };

    const buildBlockingPayload = () => {
      const statusNumber = Number(editorForm.blockStatus);
      if (!Number.isFinite(statusNumber)) {
        pushToast('info', 'Blocking status must be a number between 100 and 999.');
        return null;
      }
      const statusCode = Math.trunc(statusNumber);
      if (statusCode < 100 || statusCode > 999) {
        pushToast('info', 'Blocking status must be between 100 and 999.');
        return null;
      }
      const contentType = (editorForm.blockContentType || '').trim();
      if (!contentType) {
        pushToast('info', 'Blocking response content type cannot be empty.');
        return null;
      }
      const body = editorForm.blockBody === undefined || editorForm.blockBody === null
        ? ''
        : String(editorForm.blockBody);
      return { status: statusCode, contentType, body };
    };

    const handleEditorSubmit = async event => {
      event.preventDefault();
      const name = (editorForm.name || '').trim();
      const key = (editorForm.key || '').trim();

      if (!name) {
        pushToast('info', 'Display name is required.');
        return;
      }

      if (editorMode === 'create' && !key) {
        pushToast('info', 'Provide an API key value.');
        return;
      }

      const blockingPayload = buildBlockingPayload();
      if (!blockingPayload) {
        return;
      }

      setEditorSubmitting(true);
      try {
        if (editorMode === 'create') {
          const response = await fetch('/config/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ name, key, blockingResponse: blockingPayload })
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Request failed (${response.status})`);
          }
          pushToast('success', `API key “${name}” saved.`);
          closeEditor();
          await loadKeys();
        } else if (editingRecord && editingRecord.id) {
          const payload = { id: editingRecord.id };
          let changed = false;
          if (name !== editingRecord.name) {
            payload.name = name;
            changed = true;
          }
          if (key) {
            payload.key = key;
            changed = true;
          }
          const existingBlocking = editingRecord.blockingResponse || normalizeBlockingResponseConfig(null);
          if (!blockingResponsesEqual(blockingPayload, existingBlocking) || existingBlocking.__fromDefault === true) {
            payload.blockingResponse = blockingPayload;
            changed = true;
          }
          if (!changed) {
            pushToast('info', 'Update at least one field before saving.');
            return;
          }
          const response = await fetch('/config/api/keys', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || data.error || `Request failed (${response.status})`);
          }
          pushToast('success', `API key “${name}” updated.`);
          closeEditor();
          await loadKeys();
        } else {
          throw new Error('Missing API key identifier.');
        }
      } catch (error) {
        pushToast('error', `Save failed: ${error.message}`);
      } finally {
        setEditorSubmitting(false);
      }
    };

    const handleDelete = async record => {
      if (!record || !record.id) return;
      const confirmed = window.confirm(`Delete API key “${record.name}”? This cannot be undone.`);
      if (!confirmed) return;
      try {
        const response = await fetch('/config/api/keys', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: record.id })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || data.error || `Request failed (${response.status})`);
        }
        pushToast('success', `API key “${record.name}” removed.`);
        await loadKeys();
      } catch (error) {
        pushToast('error', `Delete failed: ${error.message}`);
      }
    };

    const headerMeta = useMemo(() => ([
      <Badge tone="info" key="count">{keys.length} key{keys.length === 1 ? '' : 's'} configured</Badge>,
      <Badge tone={status.tone === 'error' ? 'warning' : 'success'} key="state">{status.tone === 'error' ? 'Attention needed' : 'Healthy'}</Badge>,
      <Badge tone="neutral" key="block">Default block {DEFAULT_BLOCKING_RESPONSE_SHAPE.status}</Badge>
    ]), [keys.length, status.tone]);

    return (
      <>
        <TopNavigation current="keys" />
        <ToastStack toasts={toasts} dismiss={dismissToast} />
        <PageHeader
          eyebrow="Credential registry"
          title="API keys"
          description="Manage shared secrets used by pattern rules when calling upstream providers."
          meta={headerMeta}
          actions={[
            <button
              key="refresh"
              type="button"
              onClick={loadKeys}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
            >
              Refresh
            </button>,
            <button
              key="create"
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              New key
            </button>
          ]}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryPill label="Keys available" value={keys.length || '—'} />
            <SummaryPill label="Blocking status" value={DEFAULT_BLOCKING_RESPONSE_SHAPE.status} />
            <SummaryPill label="Activity" value={status.message || 'Loading…'} />
          </div>
        </PageHeader>
        <StatusBanner status={status} />
        <div className="mt-6 space-y-5 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Configured Keys</h2>
              <p className="text-sm text-slate-500">These keys can be referenced by pattern rules on the matching page.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadKeys}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                New Key
              </button>
            </div>
          </div>

          {keys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              No API keys configured yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Key Preview</th>
                    <th className="px-4 py-3 text-left font-semibold">Blocking Response</th>
                    <th className="px-4 py-3 text-left font-semibold">Updated</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {keys.map(record => (
                    <tr key={record.id}>
                      <td className="px-4 py-3 font-medium text-slate-800">{record.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{keyPreview(record.key)}</td>
                      <td className="px-4 py-3 text-slate-500">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">{(record.blockingResponse && record.blockingResponse.status) || DEFAULT_BLOCKING_RESPONSE_SHAPE.status}</span>
                          <span className="text-slate-400">•</span>
                          <span>{(record.blockingResponse && record.blockingResponse.contentType) || DEFAULT_BLOCKING_RESPONSE_SHAPE.contentType}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {summarizeBlockingResponseBody(record.blockingResponse)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{record.updated_at ? new Date(record.updated_at).toLocaleString() : '—'}</td>
                      <td className="flex justify-end gap-2 px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record)}
                          className="rounded-md border border-rose-200 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Modal
          open={editorOpen}
          title={editorMode === 'create' ? 'New API Key' : `Edit ${editingRecord ? editingRecord.name : 'API Key'}`}
          description={
            editorMode === 'create'
              ? 'Provide a display name, bearer token, and customize the blocking response stored in the key-value store.'
              : 'Update the display name, rotate the stored key value, or adjust the blocking response.'
          }
          onClose={() => {
            if (!editorSubmitting) {
              closeEditor();
            }
          }}
        >
          <form onSubmit={handleEditorSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="api-key-name">
                Display Name
              </label>
              <input
                id="api-key-name"
                name="name"
                type="text"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={editorForm.name}
                onChange={handleEditorChange}
                placeholder="Production sideband token"
                disabled={editorSubmitting}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="api-key-value">
                API Key
              </label>
              <textarea
                id="api-key-value"
                name="key"
                rows="3"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={editorForm.key}
                onChange={handleEditorChange}
                placeholder={editorMode === 'create' ? 'Paste bearer token' : 'Leave blank to keep the current value'}
                disabled={editorSubmitting}
                required={editorMode === 'create'}
              ></textarea>
              <p className="text-xs text-slate-500">
                {editorMode === 'create'
                  ? 'Values persist to the NGINX key-value store. Rotate credentials when upstream keys change.'
                  : 'Leaving this field blank keeps the currently stored token.'}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700" htmlFor="block-status">
                  Blocking Status Code
                </label>
                <input
                  id="block-status"
                  name="blockStatus"
                  type="number"
                  min="100"
                  max="999"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                  value={editorForm.blockStatus}
                  onChange={handleEditorChange}
                  placeholder="200"
                  disabled={editorSubmitting}
                />
                <p className="text-xs text-slate-500">Set the HTTP status returned when this key blocks a request.</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700" htmlFor="block-content-type">
                  Blocking Content-Type
                </label>
                <input
                  id="block-content-type"
                  name="blockContentType"
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                  value={editorForm.blockContentType}
                  onChange={handleEditorChange}
                  placeholder="application/json; charset=utf-8"
                  disabled={editorSubmitting}
                />
                <p className="text-xs text-slate-500">Customize the Content-Type header attached to blocking responses.</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="block-body">
                Blocking Response Body
              </label>
              <textarea
                id="block-body"
                name="blockBody"
                rows="6"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:ring-primary"
                value={editorForm.blockBody || ''}
                onChange={handleEditorChange}
                placeholder='{"message":{"role":"assistant","content":"F5 AI Guardrails blocked this request"}}'
                disabled={editorSubmitting}
              ></textarea>
              <p className="text-xs text-slate-500">Provide the exact payload returned when a request is blocked. JSON is recommended.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                onClick={() => {
                  if (!editorSubmitting) {
                    closeEditor();
                  }
                }}
                disabled={editorSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
                disabled={editorSubmitting}
              >
                {editorSubmitting ? 'Saving…' : editorMode === 'create' ? 'Save Key' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      </>
    );
  };

  GuardrailsUI.ApiKeysApp = ApiKeysApp;
})(window);
