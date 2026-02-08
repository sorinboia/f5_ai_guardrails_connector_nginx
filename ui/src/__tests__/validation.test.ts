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
  it('requires urlRegex for request/response contexts', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'missing-url',
      context: 'request',
      apiKeyName: 'default',
      paths: '/v1',
      matchers: [],
      notes: '',
    })
    expect(result.success).toBe(false)
  })

  it('accepts pattern with urlRegex and no matchers', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'url-only',
      context: 'request',
      apiKeyName: 'default',
      urlRegex: '^/v1/chat',
      paths: '',
      matchers: [],
      notes: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts pattern with urlRegex and matchers', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'full-pattern',
      context: 'request',
      apiKeyName: 'default',
      urlRegex: '^/v1/chat',
      paths: '.messages',
      matchers: [{ path: '.messages[-1].content', exists: true }],
      notes: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid regex', () => {
    const result = patternRuleFormSchema.safeParse({
      name: 'bad-regex',
      context: 'request',
      apiKeyName: 'default',
      urlRegex: '[invalid(',
      paths: '',
      matchers: [],
      notes: '',
    })
    expect(result.success).toBe(false)
  })

  it('allows response_stream without urlRegex', () => {
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
