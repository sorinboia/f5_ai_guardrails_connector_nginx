import { describe, expect, it } from 'vitest'

import { apiKeyFormSchema, hostFormSchema, patternRuleFormSchema } from '@/lib/validation'

describe('hostFormSchema', () => {
  it('rejects overlap greater than size', () => {
    const result = hostFormSchema.safeParse({
      inspectMode: 'both',
      redactMode: 'both',
      logLevel: 'info',
      requestForwardMode: 'sequential',
      backendOrigin: 'https://example.com',
      responseStreamEnabled: true,
      responseStreamChunkSize: 256,
      responseStreamChunkOverlap: 300,
      responseStreamFinalEnabled: true,
      responseStreamCollectFullEnabled: false,
      responseStreamBufferingMode: 'buffer',
      responseStreamChunkGatingEnabled: false,
      extractorParallel: false,
      requestExtractors: [],
      responseExtractors: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts defaults', () => {
    const result = hostFormSchema.safeParse({
      inspectMode: 'both',
      redactMode: 'both',
      logLevel: 'info',
      requestForwardMode: 'sequential',
      backendOrigin: 'https://api.openai.com',
      responseStreamEnabled: true,
      responseStreamChunkSize: 2048,
      responseStreamChunkOverlap: 128,
      responseStreamFinalEnabled: true,
      responseStreamCollectFullEnabled: false,
      responseStreamBufferingMode: 'buffer',
      responseStreamChunkGatingEnabled: false,
      extractorParallel: false,
      requestExtractors: ['pii'],
      responseExtractors: ['stream'],
    })
    expect(result.success).toBe(true)
  })
})

describe('apiKeyFormSchema', () => {
  it('enforces status range', () => {
    const invalid = apiKeyFormSchema.safeParse({
      name: 'bad',
      key: 'secret',
      status: 42,
      contentType: 'application/json',
      body: '{}',
    })
    expect(invalid.success).toBe(false)
  })
})

describe('patternRuleFormSchema', () => {
  it('requires matchers for request/response contexts', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'missing',
      context: 'request',
      apiKeyName: 'default',
      paths: '/v1',
      matchers: [],
      notes: '',
    })
    expect(result.success).toBe(false)
  })

  it('allows response_stream without matchers', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'stream-rule',
      context: 'response_stream',
      apiKeyName: 'default',
      paths: '',
      matchers: [],
      notes: '',
    })
    expect(result.success).toBe(true)
  })
})
