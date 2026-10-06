import type { NextFunction, Request, Response } from 'express'
import { getClientIp } from '../utils/clientIp.js'
import { logger } from '../utils/logger.js'

export function requireMicrosoftAccount(req: Request, res: Response, next: NextFunction) {
  if (!req.session.account) {
    logger.warn('Microsoft auth sem sessão', { clientIp: getClientIp(req), path: req.path })
    return res.status(401).json({ needsLogin: true })
  }

  next()
}
