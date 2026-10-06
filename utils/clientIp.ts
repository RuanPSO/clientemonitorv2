import { isIP } from 'node:net'
import type { Request } from 'express'

function normalizeIp(candidate: string): string | undefined {
  const value = candidate.trim().replace(/^::ffff:/i, '')
  return isIP(value) ? value : undefined
}

export function getClientIp(req: Request): string {
  const forwarded = req.get('x-forwarded-for')
  const candidates = [
    ...(forwarded ? forwarded.split(',') : []),
    req.get('x-real-ip') ?? '',
    req.socket.remoteAddress ?? '',
    req.ip ?? '',
  ]

  for (const candidate of candidates) {
    const validIp = normalizeIp(candidate)
    if (validIp) return validIp
  }

  return ''
}
