import type { NextFunction, Request, Response } from 'express'
import { evaluateAccessRules, extractAccessIdentity } from '../config/access-rules.js'

export type RequiredAccess = 'hosts' | 'total'

export function requireAccessLevel(requiredLevel: RequiredAccess) {
  return (req: Request, res: Response, next: NextFunction) => {
    const hasAuthenticatedIdentity = Boolean(
      req.user || (req.session as { user?: unknown } | undefined)?.user || (req.session as { account?: unknown } | undefined)?.account,
    )

    const decision = evaluateAccessRules(extractAccessIdentity(req))

    if (decision === 'deny') {
      if (!hasAuthenticatedIdentity) {
        return res.status(401).json({ error: 'Autenticação necessária' })
      }

      return res.status(403).json({ error: 'Acesso negado' })
    }

    if (requiredLevel === 'total' && decision !== 'total') {
      return res.status(403).json({ error: 'Permissão insuficiente' })
    }

    return next()
  }
}
