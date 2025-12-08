import { Navigate, createBrowserRouter } from 'react-router-dom'

import { AppShell } from '@/layouts/app-shell'
import ApiKeysPage from '@/routes/config/api-keys'
import HostConfigPage from '@/routes/config/host-config'
import PatternRulesPage from '@/routes/config/pattern-rules'
import LogsPage from '@/routes/monitor/logs'
import CollectorPage from '@/routes/system/collector'
import SystemPage from '@/routes/system/system'

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="monitor/logs" replace /> },
        { path: 'monitor/logs', element: <LogsPage /> },
        { path: 'config/hosts', element: <HostConfigPage /> },
        { path: 'config/api-keys', element: <ApiKeysPage /> },
        { path: 'config/pattern-rules', element: <PatternRulesPage /> },
        { path: 'system', element: <SystemPage /> },
        { path: 'collector', element: <CollectorPage /> },
        { path: 'keys', element: <Navigate to="/config/api-keys" replace /> },
        { path: 'patterns', element: <Navigate to="/config/pattern-rules" replace /> },
        { path: '*', element: <Navigate to="/monitor/logs" replace /> },
      ],
    },
  ],
  { basename: '/config/ui' }
)
