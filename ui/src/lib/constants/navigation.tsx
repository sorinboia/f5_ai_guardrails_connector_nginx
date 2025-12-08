import type { ComponentType } from 'react'
import { Activity, Database, KeyRound, LayoutDashboard, ShieldHalf, SlidersHorizontal } from 'lucide-react'
import { routes } from './routes'

export type NavItem = {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  description?: string
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    label: 'Monitor',
    items: [
      {
        label: 'Logs',
        to: routes.monitorLogs,
        icon: Activity,
        description: 'Future live stream of guardrail decisions.',
      },
    ],
  },
  {
    label: 'Config',
    items: [
      {
        label: 'Host Config',
        to: routes.configHosts,
        icon: SlidersHorizontal,
        description: 'Per-host inspection and forwarding settings.',
      },
      {
        label: 'API Keys',
        to: routes.configApiKeys,
        icon: KeyRound,
        description: 'Manage connector keys and blocking responses.',
      },
      {
        label: 'Pattern Rules',
        to: routes.configPatternRules,
        icon: ShieldHalf,
        description: 'Match and act on sensitive content across contexts.',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'System',
        to: routes.system,
        icon: LayoutDashboard,
        description: 'Certificates, export/import, environment details.',
      },
      {
        label: 'Collector',
        to: routes.collector,
        icon: Database,
        description: 'Control capture counters for troubleshooting.',
      },
    ],
  },
]

export function findNavItem(pathname: string): NavItem | undefined {
  const flat = navSections.flatMap((section) => section.items)
  return flat.find((item) => pathname.startsWith(item.to))
}
