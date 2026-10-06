import dotenv from 'dotenv'

dotenv.config({ override: true })

const requiredMicrosoftAuthVariables = [
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TENANT_ID',
  'AZURE_REDIRECT_URI',
  'SESSION_SECRET',
] as const

export function validateMicrosoftAuthEnv(): void {
  const missing = requiredMicrosoftAuthVariables.filter((name) => !process.env[name]?.trim())

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`)
  }

  if ((process.env.SESSION_SECRET?.length ?? 0) < 32) {
    throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres')
  }

  const redirectUri = new URL(process.env.AZURE_REDIRECT_URI!)
  if (redirectUri.pathname !== '/auth/callback') {
    throw new Error('AZURE_REDIRECT_URI deve apontar para /auth/callback')
  }

  if (process.env.NODE_ENV !== 'production') {
    const backendPort = process.env.PORT ?? '3000'
    if (
      redirectUri.protocol !== 'http:' ||
      redirectUri.hostname !== 'localhost' ||
      redirectUri.port !== backendPort ||
      redirectUri.search ||
      redirectUri.hash
    ) {
      throw new Error(
        `Em desenvolvimento, AZURE_REDIRECT_URI deve ser http://localhost:${backendPort}/auth/callback`,
      )
    }
  }

  new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173')
}
