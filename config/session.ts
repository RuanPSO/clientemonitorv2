import type { CookieOptions } from 'express-session'

export function getSessionCookieOptions(): CookieOptions {
  const configuredSameSite = process.env.SESSION_COOKIE_SAME_SITE?.toLowerCase() ?? 'lax'
  let sameSite: 'lax' | 'strict' | 'none'
  switch (configuredSameSite) {
    case 'lax':
    case 'strict':
    case 'none':
      sameSite = configuredSameSite
      break
    default:
      throw new Error('SESSION_COOKIE_SAME_SITE deve ser lax, strict ou none')
  }

  const secure = process.env.NODE_ENV === 'production'
  if (sameSite === 'none' && !secure) {
    throw new Error('SameSite=None requer NODE_ENV=production para habilitar Secure')
  }

  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim()

  return {
    httpOnly: true,
    secure,
    sameSite,
    ...(domain ? { domain } : {}),
  }
}
