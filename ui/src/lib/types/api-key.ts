export type BlockingResponse = {
  status: number
  contentType: string
  body: string
}

export type ApiKey = {
  id: string
  name: string
  key: string
  blockingResponse: BlockingResponse
  created_at: string
  updated_at: string
}

export const defaultBlockingResponse: BlockingResponse = {
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ message: { role: 'assistant', content: 'F5 AI Guardrails blocked this request' } }),
}
