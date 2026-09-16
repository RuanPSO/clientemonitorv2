// routes/auth.routes.ts
import 'dotenv/config'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'

const router = Router()
const SECRET = process.env.SECRET_KEY ?? process.env.APIKEY

if (!SECRET) {
  throw new Error('SECRET_KEY (ou APIKEY) não definida no .env')
}

/**
 * POST /auth/token
 *
 * Expiração controlada por JWT_EXPIRES_IN no .env:
 *   - "5m"     → 5 minutos (padrão do Python, seguro para produção)
 *   - "1h"     → 1 hora
 *   - "30d"    → 30 dias
 *   - "never"  → sem expiração (⚠️ apenas QA/dev)
 *   - ausente  → cai no default "5m"
 */
router.post('/auth/token', (_req, res) => {
  const expiresInEnv = process.env.JWT_EXPIRES_IN ?? 'never'
  const payload = { origem: 'portal' }

  let token: string

  if (expiresInEnv === 'never') {
    // Sem expiração — não define exp no payload
    token = jwt.sign(payload, SECRET, { algorithm: 'HS256' })
    console.warn('⚠️  Token gerado SEM EXPIRAÇÃO (JWT_EXPIRES_IN=never). Use apenas em QA/dev.')
  } else {
    token = jwt.sign(payload, SECRET, {
      algorithm: 'HS256',
      expiresIn: expiresInEnv as Exclude<SignOptions['expiresIn'], undefined>,
    })
  }

  res.json({
    token,
    expira_em: expiresInEnv === 'never' ? null : expiresInEnv,
  })
})

export default router