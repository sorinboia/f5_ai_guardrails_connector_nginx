// Guardrails UI bootstrap
(function (global) {
  const GuardrailsUI = global.GuardrailsUI;
  if (!GuardrailsUI) {
    throw new Error('Guardrails shared helpers must load before the UI bootstrap.');
  }

  const {
    ConfigApp,
    CollectorApp,
    ApiKeysApp,
    PatternsApp,
    VIEW_OPTIONS,
    classNames
  } = GuardrailsUI;

  if (!ConfigApp || !CollectorApp || !ApiKeysApp || !PatternsApp) {
    throw new Error('Guardrails UI modules failed to initialize.');
  }

  const { useState, useEffect } = React;

  const determinePageKind = pathname => {
    if (!pathname) return 'config';
    if (pathname.endsWith('/keys')) return 'keys';
    if (pathname.endsWith('/patterns')) return 'patterns';
    return 'config';
  };

  const PAGE_KIND = determinePageKind(global.location.pathname || '');

  if (PAGE_KIND === 'keys') {
    document.title = 'Guardrails API Keys';
  } else if (PAGE_KIND === 'patterns') {
    document.title = 'Guardrails Pattern Rules';
  }

  const ConfigPage = () => {
    const [activeView, setActiveView] = useState('config');

    useEffect(() => {
      document.title = activeView === 'collector'
        ? 'Guardrails Payload Collector'
        : 'Guardrails Scan Configuration';
    }, [activeView]);

    return (
      <div className="space-y-10">
        <div className="flex justify-center">
          <div className="inline-flex rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
            {VIEW_OPTIONS.map(option => {
              const isActive = activeView === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setActiveView(option.id)}
                  className={classNames(
                    'mx-1 rounded-full px-4 py-2 text-sm font-semibold transition',
                    isActive
                      ? 'bg-blue-600 bg-primary text-white shadow hover:bg-blue-700 hover:bg-primary-dark'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        {activeView === 'collector' ? <CollectorApp /> : <ConfigApp />}
      </div>
    );
  };

  const AppComponent = PAGE_KIND === 'keys'
    ? ApiKeysApp
    : PAGE_KIND === 'patterns'
      ? PatternsApp
      : ConfigPage;

  ReactDOM.createRoot(document.getElementById('root')).render(<AppComponent />);
})(window);
