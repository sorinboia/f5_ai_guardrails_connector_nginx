export const routes = {
  monitorLogs: '/monitor/logs',
  configHosts: '/config/hosts',
  configApiKeys: '/config/api-keys',
  configPatternRules: '/config/pattern-rules',
  system: '/system',
  collector: '/collector',
  legacyKeys: '/keys',
  legacyPatterns: '/patterns',
} as const

type RouteKey = keyof typeof routes
export type RoutePath = (typeof routes)[RouteKey]
