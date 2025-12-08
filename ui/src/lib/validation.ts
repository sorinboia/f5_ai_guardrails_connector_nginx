import { z } from 'zod'

export const hostFormSchema = z
  .object({
    inspectMode: z.enum(['off', 'request', 'response', 'both']),
    redactMode: z.enum(['off', 'request', 'response', 'both', 'on', 'true']),
    logLevel: z.enum(['debug', 'info', 'warn', 'err']),
    requestForwardMode: z.enum(['sequential', 'parallel']),
    backendOrigin: z.string().url({ message: 'Use http(s) URL' }),
    responseStreamEnabled: z.boolean(),
    responseStreamChunkSize: z.number().int().min(128).max(65536),
    responseStreamChunkOverlap: z.number().int().min(0),
    responseStreamFinalEnabled: z.boolean(),
    responseStreamCollectFullEnabled: z.boolean(),
    responseStreamBufferingMode: z.enum(['buffer', 'passthrough']),
    responseStreamChunkGatingEnabled: z.boolean(),
    extractorParallel: z.boolean().default(false),
    requestExtractors: z.array(z.string().trim().min(1)).default([]),
    responseExtractors: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((values) => values.responseStreamChunkOverlap < values.responseStreamChunkSize, {
    message: 'Chunk overlap must be less than size',
    path: ['responseStreamChunkOverlap'],
  })

export const apiKeyFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name required'),
  key: z.string().min(1, 'Key required'),
  status: z.number().int().min(100).max(999),
  contentType: z.string().min(1, 'Content type required'),
  body: z.string().optional(),
})

const matcherSchema = z
  .object({
    path: z.string().min(1, 'Path required'),
    equals: z.string().optional(),
    contains: z.string().optional(),
    exists: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const hasComparator = Boolean(val.exists || (val.equals && val.equals.trim()) || (val.contains && val.contains.trim()))
    if (!hasComparator) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add equals/contains or toggle exists',
        path: ['equals'],
      })
    }
  })

export const patternRuleFormSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1, 'Name required'),
    context: z.enum(['request', 'response', 'response_stream']),
    apiKeyName: z.string().min(1, 'API key required'),
    paths: z.string().optional(),
    matchers: z.array(matcherSchema),
    notes: z.string().optional(),
  })
  .superRefine((vals, ctx) => {
    const requiresRules = vals.context !== 'response_stream'
    if (requiresRules && (!vals.paths || !vals.paths.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Paths required unless context is response_stream',
        path: ['paths'],
      })
    }
    if (requiresRules && vals.matchers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one matcher',
        path: ['matchers'],
      })
    }
  })
