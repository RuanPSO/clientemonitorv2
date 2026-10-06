type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const sensitiveKeys = new Set([
  'access_token',
  'authorization',
  'client_secret',
  'code',
  'cookie',
  'id_token',
  'refresh_token',
  'set-cookie',
])

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : redact(item),
    ]),
  )
}

function write(level: LogLevel, message: string, details?: unknown): void {
  if (level === 'debug' && (process.env.NODE_ENV === 'production' || process.env.DEBUG !== 'true')) {
    return
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(details === undefined ? {} : { details: redact(details) }),
  }
  const output = JSON.stringify(entry)

  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.log(output)
}

export const logger = {
  debug: (message: string, details?: unknown) => write('debug', message, details),
  info: (message: string, details?: unknown) => write('info', message, details),
  warn: (message: string, details?: unknown) => write('warn', message, details),
  error: (message: string, details?: unknown) => write('error', message, details),
}
