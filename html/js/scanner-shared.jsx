// Guardrails UI shared helpers
(function (global) {
  const { useState, useEffect, useMemo, useRef } = React;
  const GuardrailsUI = global.GuardrailsUI || (global.GuardrailsUI = {});

  const DEFAULT_HOST = '__default__';
  const STORAGE_KEYS = {
    selectedHost: 'guardrails:last-selected-host'
  };

  function normalizeHost(value) {
    if (!value) return DEFAULT_HOST;
    const trimmed = String(value).trim().toLowerCase();
    return trimmed || DEFAULT_HOST;
  }

  function hostDisplayLabel(host) {
    return host === DEFAULT_HOST ? 'Default (__default__)' : host;
  }

  function readPersistedHost() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.selectedHost);
      return raw ? normalizeHost(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function persistSelectedHost(host) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.selectedHost, normalizeHost(host));
    } catch (_) {
      // Ignore storage failures (e.g., private browsing).
    }
  }

  function hydrateExtractorList(value, fallback = []) {
    if (Array.isArray(value)) {
      return value.map(item => String(item)).map(item => item.trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      if (value.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(value.trim());
          return hydrateExtractorList(parsed, fallback);
        } catch (_) {
          return [value.trim()];
        }
      }
      if (value.indexOf(',') !== -1) {
        return value.split(',').map(part => part.trim()).filter(Boolean);
      }
      return [value.trim()];
    }
    return Array.isArray(fallback) ? fallback.slice() : [];
  }

  function hydrateConfig(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const requestExtractors = hydrateExtractorList(raw.requestExtractors, raw.requestExtractor ? [raw.requestExtractor] : []);
    const responseExtractors = hydrateExtractorList(raw.responseExtractors, raw.responseExtractor ? [raw.responseExtractor] : []);
    const toNumber = (value, fallback) => {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
      return fallback;
    };
    return {
      ...raw,
      requestExtractors,
      responseExtractors,
      backendOrigin: raw.backendOrigin || '',
      extractorParallelEnabled: !!raw.extractorParallelEnabled,
      responseStreamEnabled: !!raw.responseStreamEnabled,
      responseStreamChunkSize: toNumber(raw.responseStreamChunkSize, raw.responseStreamChunkSize === 0 ? 0 : undefined),
      responseStreamChunkOverlap: toNumber(raw.responseStreamChunkOverlap, raw.responseStreamChunkOverlap === 0 ? 0 : undefined),
      responseStreamFinalEnabled: !!raw.responseStreamFinalEnabled,
      responseStreamCollectFullEnabled: !!raw.responseStreamCollectFullEnabled
    };
  }

  function inspectDirectionEnabled(mode, direction) {
    const normalized = String(mode || '').toLowerCase();
    if (direction === 'request') {
      return normalized === 'both' || normalized === 'request';
    }
    if (direction === 'response') {
      return normalized === 'both' || normalized === 'response';
    }
    return false;
  }

  function parseRedactMode(mode) {
    const normalized = String(mode || '').toLowerCase();
    if (normalized === 'both') return new Set(['request', 'response']);
    if (normalized === 'request') return new Set(['request']);
    if (normalized === 'response') return new Set(['response']);
    return new Set();
  }

  function formatRedactMode(contexts) {
    const hasRequest = contexts.has('request');
    const hasResponse = contexts.has('response');
    if (hasRequest && hasResponse) return 'both';
    if (hasRequest) return 'request';
    if (hasResponse) return 'response';
    return 'off';
  }

  function computeEffectiveRedactMode(config) {
    if (!config) return 'off';
    const contexts = parseRedactMode(config.redactMode);
    const inspectMode = config.inspectMode;
    if (!inspectDirectionEnabled(inspectMode, 'request')) contexts.delete('request');
    if (!inspectDirectionEnabled(inspectMode, 'response')) contexts.delete('response');

    if (config.requestForwardMode === 'parallel' && inspectDirectionEnabled(inspectMode, 'request')) {
      contexts.delete('request');
    }

    if (config.extractorParallelEnabled) {
      const requestParallel = Array.isArray(config.requestExtractors) && config.requestExtractors.length > 0;
      const responseParallel = Array.isArray(config.responseExtractors) && config.responseExtractors.length > 0;
      if (requestParallel && inspectDirectionEnabled(inspectMode, 'request')) {
        contexts.delete('request');
      }
      if (responseParallel && inspectDirectionEnabled(inspectMode, 'response')) {
        contexts.delete('response');
      }
    }

    return formatRedactMode(contexts);
  }

  function describeRedactionConstraints(config) {
    if (!config) return '';
    const parts = [];
    const inspectMode = config.inspectMode;
    if (config.requestForwardMode === 'parallel' && inspectDirectionEnabled(inspectMode, 'request')) {
      parts.push('Request redaction pauses while forwarding runs in parallel.');
    }
    if (config.extractorParallelEnabled) {
      const requestParallel = Array.isArray(config.requestExtractors) && config.requestExtractors.length > 0 && inspectDirectionEnabled(inspectMode, 'request');
      const responseParallel = Array.isArray(config.responseExtractors) && config.responseExtractors.length > 0 && inspectDirectionEnabled(inspectMode, 'response');
      if (requestParallel && responseParallel) {
        parts.push('Parallel extractors disable redaction for both directions.');
      } else if (requestParallel) {
        parts.push('Parallel request extractors disable request redaction.');
      } else if (responseParallel) {
        parts.push('Parallel response extractors disable response redaction.');
      }
    }
    return parts.join(' ');
  }

  const NAV_SECTIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'inspection', label: 'Inspection Modes' },
    { id: 'extraction', label: 'Extraction Paths' },
    { id: 'streaming', label: 'Response Streaming' },
    { id: 'telemetry', label: 'Redaction & Logging' }
  ];

  const PAGE_LINKS = [
    { id: 'config', label: 'Scan Config', href: 'ui' },
    { id: 'keys', label: 'API Keys', href: 'ui/keys' },
    { id: 'patterns', label: 'Pattern Rules', href: 'ui/patterns' }
  ];

  const ICONS = {
    loading: '⏳',
    success: '✅',
    error: '⚠️',
    info: 'ℹ️'
  };

  const toneClasses = {
    loading: 'border-slate-300 bg-slate-100 text-slate-600',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700'
  };

  const ToastStack = ({ toasts, dismiss }) => (
    <div className="fixed top-6 right-6 z-50 space-y-3">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${toneClasses[toast.tone] || toneClasses.info}`}
        >
          <span className="text-xl leading-none">{ICONS[toast.tone] || ICONS.info}</span>
          <div className="flex-1 text-sm">{toast.message}</div>
          <button
            type="button"
            className="rounded-md p-1 text-xs text-slate-500 hover:text-slate-700"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  const StatusBanner = ({ status }) => {
    if (!status.message) return null;
    const tone = toneClasses[status.tone] || toneClasses.info;
    return (
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${tone}`}>
        <span className="text-lg leading-none">{ICONS[status.tone] || ICONS.info}</span>
        <span>{status.message}</span>
      </div>
    );
  };

  const Modal = ({ open, title, description, onClose, children, actions }) => {
    useEffect(() => {
      if (!open) return undefined;
      const handleKey = event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (onClose) onClose();
        }
      };
      window.addEventListener('keydown', handleKey);
      return () => {
        window.removeEventListener('keydown', handleKey);
      };
    }, [open, onClose]);

    if (!open) return null;

    const handleOverlayClick = event => {
      if (event.target === event.currentTarget && onClose) {
        onClose();
      }
    };

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:text-slate-700"
              onClick={onClose}
              aria-label="Close dialog"
            >
              ✕
            </button>
          </div>
          <div>{children}</div>
          {actions ? <div className="flex justify-end gap-3">{actions}</div> : null}
        </div>
      </div>
    );
  };

  const SelectField = ({ label, helper, options, value, onChange, disabled }) => (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <select
        className="block w-full rounded-lg border-slate-300 bg-white focus:border-primary focus:ring-primary"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {helper && <p className="text-sm text-slate-500">{helper}</p>}
    </div>
  );

  const TextField = ({ label, helper, value, onChange, placeholder = '', type = 'text', disabled = false }) => (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:ring-primary"
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      />
      {helper && <p className="text-sm text-slate-500">{helper}</p>}
    </div>
  );

  const SectionCard = React.forwardRef(({ id, title, description, children }, ref) => (
    <section
      ref={ref}
      id={id}
      className="scroll-mt-32 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  ));

  const StickyNav = ({ activeSection, onNavigate, isDirty }) => (
    <aside className="lg:sticky lg:top-24">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-600">Configuration Sections</p>
        <nav className="mt-4 space-y-1">
          {NAV_SECTIONS.map(item => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'true' : 'false'}
                className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                  isActive ? 'text-primary' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full border transition ${
                    isActive
                      ? 'border-primary bg-primary'
                      : 'border-slate-300 bg-transparent group-hover:border-slate-400'
                  }`}
                ></span>
                <span className="flex-1">{item.label}</span>
              </button>
            );
          })}
        </nav>
        {isDirty && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Unsaved changes detected. Remember to save before leaving.
          </p>
        )}
      </div>
    </aside>
  );

  const SummaryChips = ({ config }) => {
    if (!config) return null;
    const configuredRedact = config.redactMode && String(config.redactMode).trim() ? config.redactMode : 'off';
    const effectiveRedact = computeEffectiveRedactMode(config);
    const redactChip = configuredRedact === effectiveRedact
      ? effectiveRedact
      : `${configuredRedact} → ${effectiveRedact}`;
    const chips = [
      { label: 'Inspect', value: config.inspectMode },
      { label: 'Backend', value: config.backendOrigin || '—' },
      { label: 'Forwarding', value: config.requestForwardMode || '—' },
      { label: 'Redact', value: redactChip },
      { label: 'Log Level', value: config.logLevel },
      { label: 'Request Profiles', value: (config.requestExtractors || []).length },
      { label: 'Response Profiles', value: (config.responseExtractors || []).length },
      {
        label: 'Stream',
        value: config.responseStreamEnabled
          ? (config.responseStreamCollectFullEnabled
            ? 'on (full)'
            : `on (${config.responseStreamChunkSize || '—'}/${config.responseStreamChunkOverlap || 0})`)
          : 'off'
      }
    ];
    return (
      <div className="flex flex-wrap gap-3">
        {chips.map((chip, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-600"
          >
            <span className="uppercase tracking-wide text-[0.65rem] text-slate-400">{chip.label}</span>
            <span>{chip.value}</span>
          </span>
        ))}
      </div>
    );
  };

  const TopNavigation = ({ current }) => (
    <div className="mb-8 flex justify-center">
      <div className="inline-flex rounded-full border border-slate-300 bg-white/80 p-1 shadow-sm">
        {PAGE_LINKS.map(link => {
          const isActive = current === link.id;
          return (
            <a
              key={link.id}
              href={link.href}
              className={classNames(
                'mx-1 rounded-full px-4 py-2 text-sm font-semibold transition',
                isActive ? 'bg-blue-600 text-white shadow hover:bg-blue-700' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {link.label}
            </a>
          );
        })}
      </div>
    </div>
  );

  const PatternMultiSelector = ({ label, helper, patterns, values, onToggle, disabled, note }) => (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          {helper && <p className="text-sm text-slate-500">{helper}</p>}
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
        {patterns.length ? (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{values.length} selected</span>
        ) : null}
      </div>
      {patterns.length === 0 ? (
        <p className="text-sm text-slate-500">No patterns available. Configure them on the Pattern Rules page.</p>
      ) : (
        <div className="space-y-2">
          {patterns.map(pattern => {
            const checked = values.indexOf(pattern.id) !== -1;
            return (
              <label
                key={pattern.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${checked ? 'border-primary/60 bg-primary/5' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-700">{pattern.name}</span>
                  <span className="text-xs text-slate-500">API key {pattern.apiKeyName}</span>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  disabled={disabled}
                  checked={checked}
                  onChange={event => onToggle(pattern.id, event.target.checked)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  const STATUS_TONES = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
    muted: 'border-slate-200 bg-white text-slate-600'
  };

  const VIEW_OPTIONS = [
    { id: 'config', label: 'Scan Configuration' },
    { id: 'collector', label: 'Payload Collector' }
  ];

  function classNames(...parts) {
    return parts.filter(Boolean).join(' ');
  }

  function useAsyncCallback(callback) {
    const [pending, setPending] = useState(false);
    const wrapped = async (...args) => {
      if (pending) return;
      setPending(true);
      try {
        return await callback(...args);
      } finally {
        setPending(false);
      }
    };
    return [wrapped, pending];
  }

  const SummaryPill = ({ label, value }) => (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="mt-1 text-lg font-semibold text-slate-800">{value}</span>
    </div>
  );

  function TreeNode({ name, value, path, depth = 0, onSelect }) {
    const isObject = value && typeof value === 'object';
    const isArray = Array.isArray(value);
    const hasChildren = isObject || isArray;
    const [open, setOpen] = useState(depth < 1);

    const preview = useMemo(() => {
      if (value === null) return 'null';
      if (isArray) return `Array(${value.length})`;
      if (isObject) return 'Object';
      if (typeof value === 'string') {
        return `"${value.length > 40 ? value.slice(0, 37) + '…' : value}"`;
      }
      return String(value);
    }, [value, isArray, isObject]);

    const toggle = event => {
      event.stopPropagation();
      setOpen(prev => !prev);
    };

    const handleSelect = event => {
      event.stopPropagation();
      if (onSelect && path) {
        onSelect(path);
      }
    };

    return (
      <div className="ml-4">
        <div
          className={classNames(
            'group flex items-center gap-2 rounded-md px-2 py-1 text-sm transition',
            'hover:bg-slate-100'
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={toggle}
              className="h-5 w-5 rounded border border-slate-300 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-800"
              aria-label={open ? 'Collapse node' : 'Expand node'}
            >
              {open ? '−' : '+'}
            </button>
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center text-slate-300">•</span>
          )}
          <button
            type="button"
            onClick={handleSelect}
            className="flex-1 text-left font-mono text-xs text-slate-700 group-hover:text-primary"
          >
            <span className="font-semibold text-slate-800">{name}</span>
            <span className="ml-2 text-slate-500">{preview}</span>
          </button>
        </div>
        {hasChildren && open ? (
          <div className="border-l border-dashed border-slate-300 pl-4">
            {isArray
              ? value.map((item, index) => {
                  const childPath = path ? `${path}[${index}]` : `.[${index}]`;
                  return (
                    <TreeNode
                      key={childPath}
                      name={`[${index}]`}
                      value={item}
                      path={childPath}
                      depth={depth + 1}
                      onSelect={onSelect}
                    />
                  );
                })
              : Object.keys(value).map(childKey => {
                  const childPath = path ? `${path}.${childKey}` : `.${childKey}`;
                  return (
                    <TreeNode
                      key={childPath}
                      name={childKey}
                      value={value[childKey]}
                      path={childPath}
                      depth={depth + 1}
                      onSelect={onSelect}
                    />
                  );
                })}
          </div>
        ) : null}
      </div>
    );
  }

  function PayloadTree({ title, bodyText, onSelect }) {
    const parsed = useMemo(() => {
      if (!bodyText) return { kind: 'empty' };
      try {
        return { kind: 'json', value: JSON.parse(bodyText) };
      } catch (_) {
        return { kind: 'text' };
      }
    }, [bodyText]);

    const rootSelector = onSelect ? (path => onSelect(path || '.')) : undefined;

    return (
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          <span className="font-mono text-xs text-slate-500">{bodyText.length} bytes</span>
        </header>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-inner">
          {parsed.kind === 'json' ? (
            <div className="space-y-2">
              {Array.isArray(parsed.value) ? (
                <TreeNode
                  name="root"
                  value={parsed.value}
                  path=""
                  depth={0}
                  onSelect={rootSelector}
                />
              ) : typeof parsed.value === 'object' && parsed.value !== null ? (
                Object.keys(parsed.value).length ? (
                  Object.keys(parsed.value).map(key => (
                    <TreeNode
                      key={`.${key}`}
                      name={key}
                      value={parsed.value[key]}
                      path={`.${key}`}
                      depth={0}
                      onSelect={onSelect}
                    />
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Object is empty.</p>
                )
              ) : (
                <div className="text-sm text-slate-600">
                  Primitive: <span className="font-mono">{JSON.stringify(parsed.value)}</span>
                </div>
              )}
            </div>
          ) : parsed.kind === 'text' ? (
            <pre className="max-h-64 overflow-auto rounded bg-slate-900/90 p-3 text-xs text-slate-100">
  {bodyText}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">No payload captured for this entry.</p>
          )}
        </div>
      </section>
    );
  }

  const MAX_SELECTORS = 12;

  const DEFAULT_BLOCK_BODY_TEMPLATE = {
    message: {
      role: 'assistant',
      content: 'F5 AI Guardrails blocked this request'
    }
  };

  const DEFAULT_BLOCKING_RESPONSE_SHAPE = Object.freeze({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(DEFAULT_BLOCK_BODY_TEMPLATE, null, 2)
  });

  function prettyPrintBlockingBody(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return value;
    }
  }

  function normalizeBlockingResponseConfig(value) {
    const base = DEFAULT_BLOCKING_RESPONSE_SHAPE;
    let source = value;
    let fromDefault = false;

    if (!source || typeof source !== 'object') {
      source = {};
      fromDefault = true;
    } else if (source.__fromDefault === true) {
      fromDefault = true;
    }

    const result = {
      status: base.status,
      contentType: base.contentType,
      body: base.body
    };

    if (source.status !== undefined) {
      const num = Number(source.status);
      if (Number.isFinite(num) && num >= 100 && num <= 999) {
        result.status = Math.trunc(num);
      }
    }

    if (source.contentType !== undefined) {
      const ct = String(source.contentType).trim();
      if (ct) {
        result.contentType = ct;
      }
    }

    if (source.body !== undefined) {
      if (typeof source.body === 'string') {
        const pretty = prettyPrintBlockingBody(source.body);
        result.body = pretty === '' ? '' : pretty;
      } else if (source.body && typeof source.body === 'object') {
        try {
          result.body = JSON.stringify(source.body, null, 2);
        } catch (_) {
          result.body = base.body;
        }
      } else {
        result.body = '';
      }
    }

    result.__fromDefault = fromDefault;
    return result;
  }

  function summarizeBlockingResponseBody(response) {
    if (!response || typeof response !== 'object') return '—';
    const { body } = response;
    if (!body) return '—';
    if (typeof body !== 'string') {
      try {
        return JSON.stringify(body);
      } catch (_) {
        return '—';
      }
    }
    try {
      const parsed = JSON.parse(body);
      const message = parsed && parsed.message;
      if (message && typeof message.content === 'string') {
        return message.content.length > 80 ? `${message.content.slice(0, 80)}…` : message.content;
      }
    } catch (_) {
      // ignore parse failure
    }
    const trimmed = body.trim();
    if (!trimmed) return '—';
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }

  function createEmptyEditorForm() {
    return {
      name: '',
      key: '',
      blockStatus: String(DEFAULT_BLOCKING_RESPONSE_SHAPE.status),
      blockContentType: DEFAULT_BLOCKING_RESPONSE_SHAPE.contentType,
      blockBody: DEFAULT_BLOCKING_RESPONSE_SHAPE.body
    };
  }

  function blockingResponsesEqual(a, b) {
    if (!a || !b) return false;
    return a.status === b.status && a.contentType === b.contentType && a.body === b.body;
  }

  Object.assign(GuardrailsUI, {
    DEFAULT_HOST,
    STORAGE_KEYS,
    normalizeHost,
    hostDisplayLabel,
    readPersistedHost,
    persistSelectedHost,
    hydrateExtractorList,
    hydrateConfig,
    inspectDirectionEnabled,
    parseRedactMode,
    formatRedactMode,
    computeEffectiveRedactMode,
    describeRedactionConstraints,
    NAV_SECTIONS,
    PAGE_LINKS,
    ICONS,
    toneClasses,
    ToastStack,
    StatusBanner,
    Modal,
    SelectField,
    TextField,
    SectionCard,
    StickyNav,
    SummaryChips,
    TopNavigation,
    PatternMultiSelector,
    STATUS_TONES,
    VIEW_OPTIONS,
    classNames,
    useAsyncCallback,
    SummaryPill,
    TreeNode,
    PayloadTree,
    MAX_SELECTORS,
    DEFAULT_BLOCK_BODY_TEMPLATE,
    DEFAULT_BLOCKING_RESPONSE_SHAPE,
    prettyPrintBlockingBody,
    normalizeBlockingResponseConfig,
    summarizeBlockingResponseBody,
    createEmptyEditorForm,
    blockingResponsesEqual
  });
})(window);
