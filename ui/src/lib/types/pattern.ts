export type PatternContext = 'request' | 'response' | 'response_stream'

export type Matcher = {
  path: string
  equals?: string
  contains?: string
  exists?: boolean
}

export type PatternRule = {
  id: string
  name: string
  context: PatternContext
  apiKeyName: string
  paths: string[]
  matchers: Matcher[]
  notes?: string
  created_at: string
  updated_at: string
}
