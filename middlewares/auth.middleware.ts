// middlewares/auth.middleware.ts
import 'dotenv/config'
import type { Request, Response, NextFunction } from 'express' 
import jwt from 'jsonwebtoken'

const SECRET = process.env.SECRET_KEY ?? process.env.APIKEY

if (!SECRET) {
  throw new Error('SECRET_KEY (ou APIKEY) não definida no .env')
}

export interface JwtPayloadPortal {
  origem: string
  iat: number
  exp: number
}

export function validarToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization

  if (!header) {
    return res.status(401).json({ error: 'Token ausente' })
  }
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Formato de token inválido' })
  }

  const token = header.slice(7)

  try {
    const decoded = jwt.verify(token, SECRET as string) as unknown as JwtPayloadPortal
    if (decoded.origem !== 'portal') {
      return res.status(403).json({ error: 'Origem inválida' })
    }
    ;(req as any).user = decoded
    next()
  } catch (e: unknown) {
    const err = e as Error
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' })
    }
    return res.status(401).json({ error: 'Token inválido' })
  }
}