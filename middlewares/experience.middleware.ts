import type { NextFunction, Request, Response } from 'express'
import { validarToken } from './auth.middleware.js'

export type Experience = 'normal' | 'secondary'
export type ExperienceRequirement = Experience | readonly Experience[]

export function requireExperience(requiredExperience: ExperienceRequirement) {
  const allowedExperiences = Array.isArray(requiredExperience)
    ? requiredExperience
    : [requiredExperience]

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.account || !req.session.experience) {
      return res.status(401).json({ error: 'Autenticação e classificação de experiência necessárias' })
    }

    if (!allowedExperiences.includes(req.session.experience)) {
      return res.status(403).json({ error: 'Acesso negado para esta experiência' })
    }

    return next()
  }
}

export function requireExperienceOrLegacyJwt(requiredExperience: ExperienceRequirement) {
  const experienceMiddleware = requireExperience(requiredExperience)

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.account) return validarToken(req, res, next)

    return experienceMiddleware(req, res, () =>
      validarToken(req, res, next),
    )
  }
}
