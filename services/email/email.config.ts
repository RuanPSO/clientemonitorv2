export interface EmailSmtpConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
  secure: boolean
  requireTLS: boolean
  ignoreTLS: boolean
}

export interface SmtpTransportOptions {
  host: string
  port: number
  secure: boolean
  requireTLS?: true
  ignoreTLS?: true
  auth: {
    user: string
    pass: string
  }
}

const requiredVariables = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASSWORD',
  'EMAIL_USE_TLS',
  'EMAIL_USE_SSL',
] as const

function parseBoolean(name: string, value: string): boolean {
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  throw new Error(`${name} deve ser "true" ou "false"`)
}

export function readEmailSmtpConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmailSmtpConfig {
  const missing = requiredVariables.filter((name) => !env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Configuração SMTP incompleta. Variáveis ausentes: ${missing.join(', ')}`)
  }

  const host = env.EMAIL_SMTP_HOST!.trim()
  const portValue = env.EMAIL_SMTP_PORT!.trim()
  const port = Number(portValue)
  const user = env.EMAIL_SMTP_USER!.trim()
  const password = env.EMAIL_SMTP_PASSWORD!
  const useTls = parseBoolean('EMAIL_USE_TLS', env.EMAIL_USE_TLS!.trim())
  const useSsl = parseBoolean('EMAIL_USE_SSL', env.EMAIL_USE_SSL!.trim())

  if (!host) throw new Error('EMAIL_SMTP_HOST não pode ficar vazio')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('EMAIL_SMTP_PORT deve ser um número inteiro entre 1 e 65535')
  }
  if (!user) throw new Error('EMAIL_SMTP_USER não pode ficar vazio')
  if (!password.trim()) throw new Error('EMAIL_SMTP_PASSWORD não pode ficar vazio')
  if (useTls && useSsl) {
    console.warn('EMAIL_USE_SSL=true tem prioridade sobre EMAIL_USE_TLS=true')
  }

  return {
    host,
    port,
    user,
    password,
    from: user,
    secure: useSsl,
    requireTLS: useTls && !useSsl,
    ignoreTLS: !useTls && !useSsl,
  }
}

export function toSmtpTransportOptions(config: EmailSmtpConfig): SmtpTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.requireTLS ? { requireTLS: true as const } : {}),
    ...(config.ignoreTLS ? { ignoreTLS: true as const } : {}),
    auth: {
      user: config.user,
      pass: config.password,
    },
  }
}

export function createActivationUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const configuredUrl = env.CLIENTMONITOR_URL?.trim()
  if (!configuredUrl) throw new Error('CLIENTMONITOR_URL não configurada')

  let baseUrl: URL
  try {
    baseUrl = new URL(configuredUrl)
  } catch {
    throw new Error('CLIENTMONITOR_URL deve ser uma URL válida')
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error('CLIENTMONITOR_URL deve usar HTTP ou HTTPS e não pode conter credenciais')
  }

  const activationUrl = new URL('/ativar', baseUrl)
  activationUrl.searchParams.set('token', token)
  return activationUrl.toString()
}
