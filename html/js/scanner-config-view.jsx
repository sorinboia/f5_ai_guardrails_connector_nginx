// Guardrails config view module
(function (global) {
  const GuardrailsUI = global.GuardrailsUI;
  if (!GuardrailsUI) {
    throw new Error('Guardrails shared helpers must load before the config module.');
  }
  const {
    DEFAULT_HOST,
    NAV_SECTIONS,
    hostDisplayLabel,
    normalizeHost,
    readPersistedHost,
    persistSelectedHost,
    hydrateConfig,
    computeEffectiveRedactMode,
    describeRedactionConstraints,
    ToastStack,
    StatusBanner,
    SectionCard,
    SelectField,
    StickyNav,
    SummaryChips,
    TopNavigation,
    TextField,
    PatternMultiSelector
  } = GuardrailsUI;
  const { useState, useEffect, useMemo, useRef } = React;

  const HostSelector = ({ hosts, selectedHost, onSelect, onCreate, onDelete }) => {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-700">Active Host</p>
            <p className="text-xs text-slate-500">Choose which Host header this configuration applies to.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="min-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary focus:ring-primary"
              value={selectedHost}
              onChange={event => onSelect(event.target.value)}
            >
              {hosts.map(host => (
                <option key={host} value={host}>
                  {hostDisplayLabel(host)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCreate}
                className="inline-flex justify-center rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary shadow-sm hover:bg-primary/10"
              >
                New Host
              </button>
              <button
                type="button"
                onClick={() => onDelete(selectedHost)}
                className="inline-flex justify-center rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 shadow-sm hover:bg-rose-50 disabled:opacity-50"
                disabled={selectedHost === DEFAULT_HOST || hosts.length <= 1}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const ConfigApp = () => {
    const sectionRefs = useRef({});
    const hasSyncedHostRef = useRef(false);
    const [status, setStatus] = useState({ tone: 'loading', message: 'Loading configuration…' });
    const [config, setConfig] = useState(null);
    const [serverConfig, setServerConfig] = useState(null);
    const [defaults, setDefaults] = useState(null);
    const [options, setOptions] = useState({ inspectMode: [], redactMode: [], logLevel: [], requestForwardMode: [] });
    const [updatedAt, setUpdatedAt] = useState(null);
    const [saving, setSaving] = useState(false);
    const [activeSection, setActiveSection] = useState(NAV_SECTIONS[0].id);
    const [toasts, setToasts] = useState([]);
    const [hosts, setHosts] = useState([DEFAULT_HOST]);
    const [selectedHost, setSelectedHost] = useState(DEFAULT_HOST);
    const [patterns, setPatterns] = useState([]);

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

    const normalizeConfig = cfg => ({
      inspectMode: (cfg && cfg.inspectMode) || '',
      requestForwardMode: (cfg && cfg.requestForwardMode) || '',
      redactMode: (cfg && cfg.redactMode) || '',
      logLevel: (cfg && cfg.logLevel) || '',
      backendOrigin: (cfg && cfg.backendOrigin ? cfg.backendOrigin.trim() : ''),
      requestExtractors: (cfg && Array.isArray(cfg.requestExtractors) ? cfg.requestExtractors : []),
      responseExtractors: (cfg && Array.isArray(cfg.responseExtractors) ? cfg.responseExtractors : []),
      extractorParallelEnabled: !!(cfg && cfg.extractorParallelEnabled),
      responseStreamEnabled: !!(cfg && cfg.responseStreamEnabled),
      responseStreamChunkSize: Number(cfg && cfg.responseStreamChunkSize) || 0,
      responseStreamChunkOverlap: Number(cfg && cfg.responseStreamChunkOverlap) || 0,
      responseStreamFinalEnabled: !!(cfg && cfg.responseStreamFinalEnabled),
      responseStreamCollectFullEnabled: !!(cfg && cfg.responseStreamCollectFullEnabled)
    });

    const isDirty = useMemo(() => {
      if (!config || !serverConfig) return false;
      return JSON.stringify(normalizeConfig(config)) !== JSON.stringify(normalizeConfig(serverConfig));
    }, [config, serverConfig]);

    const derivedOptions = useMemo(() => ({
      inspectMode: options.inspectMode || [],
      requestForwardMode: options.requestForwardMode || [],
      redactMode: options.redactMode || [],
      logLevel: options.logLevel || []
    }), [options]);

    const patternMaps = useMemo(() => {
      const contextMap = { request: [], response: [], response_stream: [] };
      const byId = new Map();
      patterns.forEach(pattern => {
        if (!pattern || !pattern.id) return;
        byId.set(pattern.id, pattern);
        if (pattern.context === 'request') {
          contextMap.request.push(pattern);
        } else if (pattern.context === 'response' || pattern.context === 'response_stream') {
          contextMap.response.push(pattern);
          contextMap.response_stream.push(pattern);
        }
      });
      return { contextMap, byId };
    }, [patterns]);

    const requestExtractorIds = useMemo(() => (
      config && Array.isArray(config.requestExtractors) ? config.requestExtractors : []
    ), [config]);
    const responseExtractorIds = useMemo(() => (
      config && Array.isArray(config.responseExtractors) ? config.responseExtractors : []
    ), [config]);
    const requestPatternSelections = useMemo(
      () => requestExtractorIds.map(id => patternMaps.byId.get(id)).filter(Boolean),
      [requestExtractorIds, patternMaps]
    );
    const responsePatternSelections = useMemo(
      () => responseExtractorIds.map(id => patternMaps.byId.get(id)).filter(Boolean),
      [responseExtractorIds, patternMaps]
    );
    const extractorParallelEnabled = !!(config && config.extractorParallelEnabled);
    const effectiveRedactMode = useMemo(() => computeEffectiveRedactMode(config), [config]);
    const redactionConstraints = useMemo(() => describeRedactionConstraints(config), [config]);

    const registerSection = id => el => {
      if (el) {
        sectionRefs.current[id] = el;
      }
    };

    const navigateTo = id => {
      const element = sectionRefs.current[id];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const attachScrollSpy = () => {
      const observer = new IntersectionObserver(
        entries => {
          const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
          if (visible.length) {
            setActiveSection(visible[0].target.id);
          }
        },
        {
          rootMargin: '-40% 0px -55% 0px',
          threshold: [0.1, 0.35, 0.6]
        }
      );
      NAV_SECTIONS.forEach(item => {
        const el = sectionRefs.current[item.id];
        if (el) observer.observe(el);
      });
      return () => observer.disconnect();
    };

    useEffect(() => {
      if (!config) return;
      const detach = attachScrollSpy();
      return detach;
    }, [config]);

    const fetchConfig = async hostOverride => {
      const targetHost = normalizeHost(hostOverride || selectedHost);
      try {
        setStatus({ tone: 'loading', message: `Loading configuration for ${hostDisplayLabel(targetHost)}…` });
        const response = await fetch('/config/api', {
          headers: {
            Accept: 'application/json',
            'X-Guardrails-Config-Host': targetHost
          }
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        const serverHost = normalizeHost(payload.host || targetHost);
        const hostList = Array.isArray(payload.hosts) && payload.hosts.length
          ? payload.hosts.map(normalizeHost)
          : [DEFAULT_HOST];
        const hydratedConfig = hydrateConfig(payload.config);
        const hydratedDefaults = hydrateConfig(payload.defaults || {});
        setHosts(hostList);
        setSelectedHost(serverHost);
        setConfig(hydratedConfig);
        setServerConfig(hydratedConfig);
        setDefaults(hydratedDefaults);
        setOptions(payload.options || {});
        setUpdatedAt(new Date());
        const message = `Configuration loaded for ${hostDisplayLabel(serverHost)}.`;
        setStatus({ tone: 'success', message });
        pushToast('success', message);
      } catch (error) {
        const message = `Unable to load configuration: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
        if (targetHost !== DEFAULT_HOST) {
          const fallbackHost = DEFAULT_HOST;
          setSelectedHost(fallbackHost);
          persistSelectedHost(fallbackHost);
          setTimeout(() => {
            fetchConfig(fallbackHost);
          }, 0);
        }
      }
    };

    const fetchPatterns = async () => {
      try {
        const response = await fetch('/config/api/patterns', {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        setPatterns(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        pushToast('error', `Unable to load pattern rules: ${error.message}`);
      }
    };

    useEffect(() => {
      const persistedHost = readPersistedHost();
      const targetHost = persistedHost || DEFAULT_HOST;
      setSelectedHost(targetHost);
      fetchConfig(targetHost);
      fetchPatterns();
    }, []);

    useEffect(() => {
      if (!hasSyncedHostRef.current) {
        hasSyncedHostRef.current = true;
        return;
      }
      persistSelectedHost(selectedHost);
    }, [selectedHost]);

    const handleSelectChange = (key, value) => {
      setConfig(prev => ({ ...prev, [key]: value }));
      if (key === 'requestForwardMode') {
        if (value === 'parallel') {
          pushToast('info', 'Parallel forwarding disables request redaction during inspection.');
        } else {
          pushToast('info', 'Sequential forwarding respects your configured request redaction.');
        }
      }
    };

    const handlePatternToggle = (context, patternId, checked) => {
      const key = context === 'response' ? 'responseExtractors' : 'requestExtractors';
      setConfig(prev => {
        const current = prev && Array.isArray(prev[key]) ? prev[key] : [];
        let next = current;
        if (checked) {
          if (current.indexOf(patternId) === -1) {
            next = [...current, patternId];
          }
        } else {
          next = current.filter(id => id !== patternId);
        }
        return { ...prev, [key]: next };
      });
    };

    const handleParallelToggle = enabled => {
      setConfig(prev => ({
        ...prev,
        extractorParallelEnabled: enabled
      }));
      if (enabled) {
        pushToast('info', 'Parallel extractor mode enabled; redaction pauses for affected directions.');
      } else {
        pushToast('info', 'Sequential extractor mode restored; redaction follows your selection.');
      }
    };

    const handleStreamToggle = enabled => {
      setConfig(prev => ({
        ...prev,
        responseStreamEnabled: enabled
      }));
      pushToast('info', enabled ? 'Response streaming inspection enabled.' : 'Response streaming inspection disabled.');
    };

    const handleStreamNumberChange = (key, value) => {
      const parsed = parseInt(value, 10);
      setConfig(prev => ({
        ...prev,
        [key]: Number.isFinite(parsed) ? parsed : ''
      }));
    };

    const resetToDefaults = () => {
      if (!defaults) return;
      setConfig({
        inspectMode: defaults.inspectMode,
        requestForwardMode: defaults.requestForwardMode,
        redactMode: defaults.redactMode,
        logLevel: defaults.logLevel,
        backendOrigin: defaults.backendOrigin,
        requestExtractors: [...(defaults.requestExtractors || [])],
        responseExtractors: [...(defaults.responseExtractors || [])],
        extractorParallelEnabled: !!defaults.extractorParallelEnabled,
        responseStreamEnabled: !!defaults.responseStreamEnabled,
        responseStreamChunkSize: defaults.responseStreamChunkSize,
        responseStreamChunkOverlap: defaults.responseStreamChunkOverlap,
        responseStreamFinalEnabled: !!defaults.responseStreamFinalEnabled,
        responseStreamCollectFullEnabled: !!defaults.responseStreamCollectFullEnabled
      });
      const message = `Defaults staged for ${hostDisplayLabel(selectedHost)}. Save to persist.`;
      setStatus({ tone: 'info', message });
      pushToast('info', message);
    };

    const saveConfig = async event => {
      event.preventDefault();
      if (!config) return;
      if (!isDirty) {
        const message = `No changes detected for ${hostDisplayLabel(selectedHost)}.`;
        setStatus({ tone: 'info', message });
        pushToast('info', message);
        return;
      }
      const backendOrigin = (config.backendOrigin || '').trim();
      if (!backendOrigin || !/^https?:\/\//i.test(backendOrigin)) {
        const message = 'Backend origin must start with http:// or https://';
        setStatus({ tone: 'error', message });
        pushToast('error', message);
        return;
      }
      const parseInteger = (value, fallback) => {
        const num = parseInt(value, 10);
        return Number.isFinite(num) ? num : fallback;
      };
      const defaultChunkSize = (defaults && defaults.responseStreamChunkSize) || 2048;
      const defaultChunkOverlap = (defaults && defaults.responseStreamChunkOverlap) || 0;
      const responseStreamChunkSize = parseInteger(config.responseStreamChunkSize, defaultChunkSize);
      const responseStreamChunkOverlap = parseInteger(config.responseStreamChunkOverlap, defaultChunkOverlap);
      if (responseStreamChunkSize < 128 || responseStreamChunkSize > 65536) {
        const message = 'Response stream chunk size must be between 128 and 65536 bytes.';
        setStatus({ tone: 'error', message });
        pushToast('error', message);
        return;
      }
      if (responseStreamChunkOverlap < 0 || responseStreamChunkOverlap >= responseStreamChunkSize) {
        const message = 'Response stream chunk overlap must be >= 0 and smaller than the chunk size.';
        setStatus({ tone: 'error', message });
        pushToast('error', message);
        return;
      }
      setSaving(true);
      setStatus({ tone: 'loading', message: `Saving ${hostDisplayLabel(selectedHost)}…` });
      const requestExtractors = Array.isArray(config.requestExtractors)
        ? config.requestExtractors.map(item => String(item).trim()).filter(Boolean)
        : [];
      const responseExtractors = Array.isArray(config.responseExtractors)
        ? config.responseExtractors.map(item => String(item).trim()).filter(Boolean)
        : [];
      const redactModePayload = config.redactMode && String(config.redactMode).trim() ? config.redactMode : 'off';
      const payload = {
        inspectMode: config.inspectMode,
        requestForwardMode: config.requestForwardMode,
        redactMode: redactModePayload,
        logLevel: config.logLevel,
        backendOrigin,
        requestExtractors,
        responseExtractors,
        extractorParallelEnabled: !!config.extractorParallelEnabled,
        responseStreamEnabled: !!config.responseStreamEnabled,
        responseStreamChunkSize,
        responseStreamChunkOverlap,
        responseStreamFinalEnabled: !!config.responseStreamFinalEnabled,
        responseStreamCollectFullEnabled: !!config.responseStreamCollectFullEnabled
      };
      try {
        const response = await fetch('/config/api', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Guardrails-Config-Host': selectedHost
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({}));
          const message = errPayload.errors ? errPayload.errors.join('; ') : errPayload.message || `Request failed (${response.status})`;
          throw new Error(message);
        }
        const data = await response.json();
        const hydrated = hydrateConfig(data.config);
        const hydratedDefaults = hydrateConfig(data.defaults || defaults || {});
        setConfig(hydrated);
        setServerConfig(hydrated);
        setDefaults(hydratedDefaults);
        setOptions(data.options || options);
        setHosts(Array.isArray(data.hosts) && data.hosts.length ? data.hosts.map(normalizeHost) : hosts);
        setUpdatedAt(new Date());
        const message = `Configuration saved for ${hostDisplayLabel(selectedHost)}.`;
        setStatus({ tone: 'success', message });
        pushToast('success', message);
      } catch (error) {
        const message = `Save failed: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
      } finally {
        setSaving(false);
      }
    };

    const handleHostSelect = host => {
      const normalized = normalizeHost(host);
      if (normalized === selectedHost) return;
      setSelectedHost(normalized);
      fetchConfig(normalized);
    };

    const createHost = async () => {
      const raw = window.prompt('Enter the Host header value for the new configuration');
      if (raw === null) return;
      const normalized = normalizeHost(raw);
      if (!raw.trim()) {
        pushToast('info', 'Host value cannot be empty.');
        return;
      }
      if (hosts.indexOf(normalized) !== -1) {
        pushToast('info', `${hostDisplayLabel(normalized)} already exists.`);
        return;
      }
      try {
        setStatus({ tone: 'loading', message: `Creating ${hostDisplayLabel(normalized)}…` });
        const response = await fetch('/config/api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Guardrails-Config-Host': normalized
          },
          body: JSON.stringify({ host: normalized })
        });
        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({}));
          const message = errPayload.message || (errPayload.errors && errPayload.errors.join('; ')) || `Request failed (${response.status})`;
          throw new Error(message);
        }
        const data = await response.json();
        const serverHost = normalizeHost(data.host || normalized);
        const hydratedConfig = hydrateConfig(data.config);
        const hydratedDefaults = hydrateConfig(data.defaults || defaults || {});
        setHosts(Array.isArray(data.hosts) && data.hosts.length ? data.hosts.map(normalizeHost) : [DEFAULT_HOST]);
        setSelectedHost(serverHost);
        setConfig(hydratedConfig);
        setServerConfig(hydratedConfig);
        setDefaults(hydratedDefaults);
        setOptions(data.options || options);
        setUpdatedAt(new Date());
        const message = `Created ${hostDisplayLabel(serverHost)}.`;
        setStatus({ tone: 'success', message });
        pushToast('success', message);
      } catch (error) {
        const message = `Create failed: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
      }
    };

    const deleteHost = async hostValue => {
      const target = normalizeHost(hostValue || selectedHost);
      if (target === DEFAULT_HOST) {
        pushToast('info', 'The default host cannot be removed.');
        return;
      }
      if (!window.confirm(`Remove configuration for ${hostDisplayLabel(target)}?`)) {
        return;
      }
      try {
        setStatus({ tone: 'loading', message: `Removing ${hostDisplayLabel(target)}…` });
        const response = await fetch('/config/api', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Guardrails-Config-Host': target
          },
          body: JSON.stringify({ host: target })
        });
        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({}));
          const message = errPayload.message || (errPayload.errors && errPayload.errors.join('; ')) || `Request failed (${response.status})`;
          throw new Error(message);
        }
        const data = await response.json();
        const nextHost = normalizeHost(data.host || DEFAULT_HOST);
        const hydratedConfig = hydrateConfig(data.config);
        const hydratedDefaults = hydrateConfig(data.defaults || defaults || {});
        setHosts(Array.isArray(data.hosts) && data.hosts.length ? data.hosts.map(normalizeHost) : [DEFAULT_HOST]);
        setSelectedHost(nextHost);
        setConfig(hydratedConfig);
        setServerConfig(hydratedConfig);
        setDefaults(hydratedDefaults);
        setOptions(data.options || options);
        setUpdatedAt(new Date());
        const message = `Removed ${hostDisplayLabel(target)}.`;
        setStatus({ tone: 'success', message });
        pushToast('success', message);
      } catch (error) {
        const message = `Delete failed: ${error.message}`;
        setStatus({ tone: 'error', message });
        pushToast('error', message);
      }
    };

    const statusSummary = useMemo(() => {
      if (!config) return '—';
      const hostLabel = hostDisplayLabel(selectedHost);
      return updatedAt ? `${hostLabel} last updated ${updatedAt.toLocaleString()}` : hostLabel;
    }, [config, updatedAt, selectedHost]);

    if (!config || !defaults) {
      return (
        <>
          <TopNavigation current="config" />
          <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <div className="h-64 rounded-3xl bg-white/70 shadow-sm" />
          </div>
          <div className="space-y-6">
            <StatusBanner status={status} />
            <div className="grid gap-6 sm:grid-cols-2">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="h-48 animate-pulse rounded-3xl bg-white shadow-sm"></div>
              ))}
            </div>
          </div>
        </div>
        </>
      );
    }

    return (
      <>
        <TopNavigation current="config" />
        <ToastStack toasts={toasts} dismiss={dismissToast} />
        <form onSubmit={saveConfig} className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <StickyNav activeSection={activeSection} onNavigate={navigateTo} isDirty={isDirty} />
          <div className="space-y-10">
            <SectionCard
              ref={registerSection('overview')}
              id="overview"
              title="Current Snapshot"
              description={statusSummary}
            >
              <HostSelector
                hosts={hosts}
                selectedHost={selectedHost}
                onSelect={handleHostSelect}
                onCreate={createHost}
                onDelete={deleteHost}
              />
              <TextField
                label="Backend Origin"
                helper="Destination base URL for this host's upstream requests (e.g., https://api.openai.com)."
                placeholder="https://api.openai.com"
                value={config.backendOrigin || ''}
                onChange={value => setConfig(prev => ({ ...prev, backendOrigin: value }))}
              />
              <StatusBanner status={status} />
              <SummaryChips config={config} />
            </SectionCard>

            <SectionCard
              ref={registerSection('inspection')}
              id="inspection"
              title="Inspection Modes"
              description="Control which message directions are screened by the guardrails service."
            >
              <SelectField
                label="Inspection Mode"
                helper="Select which portions of the conversation are inspected (request, response, or both)."
                options={derivedOptions.inspectMode}
                value={config.inspectMode}
                onChange={value => handleSelectChange('inspectMode', value)}
              />
              <SelectField
                label="Request Forwarding"
                helper="Sequential waits for scan results and works with request redaction. Parallel dispatches upstream immediately and pauses request redaction during inspection."
                options={derivedOptions.requestForwardMode}
                value={config.requestForwardMode}
                onChange={value => handleSelectChange('requestForwardMode', value)}
              />
            </SectionCard>

            <SectionCard
              ref={registerSection('extraction')}
              id="extraction"
              title="Extraction Profiles"
              description="Select which patterns supply extraction selectors and API keys."
            >
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Parallel extractor mode</p>
                  <p className="text-xs text-slate-500">
                    When enabled, all matching profiles run per stage without redaction. Disable to evaluate profiles sequentially and allow redaction.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={extractorParallelEnabled}
                    onChange={event => handleParallelToggle(event.target.checked)}
                  />
                  Parallel
                </label>
              </div>

              <PatternMultiSelector
                label="Request Extraction Profiles"
                helper="Selected profiles supply their own selectors and API keys."
                note={extractorParallelEnabled
                  ? 'All selected request profiles execute in parallel; request redaction is skipped while this mode is active.'
                  : 'Profiles evaluate in selection order; the first match determines the scan.'}
                patterns={patternMaps.contextMap.request}
                values={requestExtractorIds}
                onToggle={(patternId, checked) => handlePatternToggle('request', patternId, checked)}
              />

              <PatternMultiSelector
                label="Response Extraction Profiles"
                helper="Select patterns that control response extraction and API keys."
                note={extractorParallelEnabled
                  ? 'All selected response profiles execute in parallel; response redaction is skipped while this mode is active.'
                  : 'Profiles evaluate in selection order; the first match determines the scan.'}
                patterns={patternMaps.contextMap.response}
                values={responseExtractorIds}
                onToggle={(patternId, checked) => handlePatternToggle('response', patternId, checked)}
              />
            </SectionCard>

            <SectionCard
              ref={registerSection('streaming')}
              id="streaming"
              title="Response Streaming"
              description="Control streaming inspection for Server-Sent Events and chunked responses."
            >
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Stream inspection</p>
                  <p className="text-xs text-slate-500">When enabled, responses are parsed incrementally and scanned chunk-by-chunk.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={!!config.responseStreamEnabled}
                    onChange={event => handleStreamToggle(event.target.checked)}
                  />
                  Enabled
                </label>
              </div>

              <TextField
                label="Chunk Size (bytes)"
                helper={config.responseStreamCollectFullEnabled
                  ? 'Chunking is ignored while full-stream inspection is enabled.'
                  : 'How many bytes are grouped per inspection chunk. Must be between 128 and 65536.'}
                type="number"
                value={config.responseStreamChunkSize}
                onChange={value => handleStreamNumberChange('responseStreamChunkSize', value)}
                disabled={config.responseStreamCollectFullEnabled}
              />

              <TextField
                label="Chunk Overlap (bytes)"
                helper={config.responseStreamCollectFullEnabled
                  ? 'Chunk overlap is skipped when scanning only the assembled stream.'
                  : 'Bytes re-used from the previous chunk to preserve context. Must be smaller than the chunk size.'}
                type="number"
                value={config.responseStreamChunkOverlap}
                onChange={value => handleStreamNumberChange('responseStreamChunkOverlap', value)}
                disabled={config.responseStreamCollectFullEnabled}
              />

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  checked={!!config.responseStreamCollectFullEnabled}
                  onChange={event => setConfig(prev => ({ ...prev, responseStreamCollectFullEnabled: event.target.checked }))}
                />
                <span>
                  Wait for full stream before scanning
                  <span className="block text-xs text-slate-500">Buffers the entire SSE message and runs a single inspection pass.</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  checked={!!config.responseStreamFinalEnabled}
                  onChange={event => setConfig(prev => ({ ...prev, responseStreamFinalEnabled: event.target.checked }))}
                />
                <span>
                  Run a final full-response pass after streaming
                  <span className="block text-xs text-slate-500">Keeps the last full body inspection even when streaming is on.</span>
                </span>
              </label>
            </SectionCard>

            <SectionCard
              ref={registerSection('telemetry')}
              id="telemetry"
              title="Redaction & Logging"
              description="Configure automatic masking behavior and the verbosity of NJS logs."
            >
              <SelectField
                label="Redaction Mode"
                helper={redactionConstraints
                  ? `${redactionConstraints} Effective redaction: ${effectiveRedactMode}.`
                  : `Effective redaction: ${effectiveRedactMode}. Choose request, response, both, or off.`}
                options={derivedOptions.redactMode}
                value={config.redactMode}
                onChange={value => handleSelectChange('redactMode', value)}
              />
              <SelectField
                label="Log Level"
                helper="Choose how verbose the guardrails handler should be in the NGINX error log."
                options={derivedOptions.logLevel}
                value={config.logLevel}
                onChange={value => handleSelectChange('logLevel', value)}
              />
            </SectionCard>

            <div className="sticky bottom-4 z-40 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Ready to apply your updates?</p>
                  <p className="text-xs text-slate-500">Changes persist to the key-value store immediately after saving.</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={resetToDefaults}
                    className="inline-flex justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Reset to Defaults
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fetchConfig(selectedHost);
                      fetchPatterns();
                    }}
                    className="inline-flex justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Refresh from Server
                  </button>
                  <button
                    type="submit"
                    className={`inline-flex justify-center rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isDirty ? '' : 'opacity-60'}`}
                    aria-disabled={!isDirty}
                    disabled={saving || !isDirty}
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </>
    );
  };

  Object.assign(GuardrailsUI, { HostSelector, ConfigApp });
})(window);
