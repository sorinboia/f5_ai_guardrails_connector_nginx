export type InspectMode = 'off' | 'request' | 'response' | 'both'
export type RedactMode = InspectMode | 'on' | 'true'
export type LogLevel = 'debug' | 'info' | 'warn' | 'err'
export type RequestForwardMode = 'sequential' | 'parallel'
export type BufferingMode = 'buffer' | 'passthrough'

export type HostConfig = {
  inspectMode: InspectMode
  redactMode: InspectMode | 'on' | 'true'
  logLevel: LogLevel
  requestForwardMode: RequestForwardMode
  backendOrigin: string
  requestExtractor?: string
  responseExtractor?: string
  requestExtractors: string[]
  responseExtractors: string[]
  extractorParallel?: boolean
  extractorParallelEnabled?: boolean
  responseStreamEnabled: boolean
  responseStreamChunkSize: number
  responseStreamChunkOverlap: number
  responseStreamFinalEnabled: boolean
  responseStreamCollectFullEnabled: boolean
  responseStreamBufferingMode: BufferingMode
  responseStreamChunkGatingEnabled: boolean
}

export type ConfigOptions = {
  inspectMode: InspectMode[]
  redactMode: InspectMode[]
  logLevel: LogLevel[]
  requestForwardMode: RequestForwardMode[]
  responseStreamBufferingMode: BufferingMode[]
}

export type ConfigResponse = {
  config: HostConfig
  defaults: HostConfig
  hosts: string[]
  host: string
  options: ConfigOptions
  applied?: Partial<HostConfig>
}

export type HostConfigPatch = Partial<HostConfig>
