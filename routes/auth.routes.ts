// routes/auth.routes.ts
import 'dotenv/config'
import { Router } from 'express'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { AuthService } from '../services/auth.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'

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
      expiresIn: expiresInEnv as NonNullable<SignOptions['expiresIn']>,
    })
  }

  res.json({
    token,
    expira_em: expiresInEnv === 'never' ? null : expiresInEnv,
  })
})




router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, senha } = req.body ?? {}

    const resultado = await AuthService.login(String(email ?? ''), String(senha ?? ''))

    if (!resultado.ok) {
      // 401 para credenciais inválidas, 403 para inativo
      const status = resultado.motivo === 'usuario_inativo' ? 403 : 401
      return res.status(status).json({ erro: resultado.mensagem, motivo: resultado.motivo })
    }

    const u = resultado.usuario
    const expiresInEnv = process.env.JWT_EXPIRES_IN ?? 'never'

    const payload = {
      origem: 'portal',
      sub: String(u.id),
      nome: u.nome,
      email: u.email,
      cargo: u.cargo,
      grupo: u.grupo,
      groupid_zabbix: u.groupid_zabbix,
    }

    let token: string
    if (expiresInEnv === 'never') {
      token = jwt.sign(payload, SECRET, { algorithm: 'HS256' })
    } else {
      token = jwt.sign(payload, SECRET, {
        algorithm: 'HS256',
        expiresIn: expiresInEnv as NonNullable<SignOptions['expiresIn']>,
      })
    }

    res.json({
      token,
      expira_em: expiresInEnv === 'never' ? null : expiresInEnv,
      usuario: u,
    })
  } catch (e: unknown) {
    console.error('[POST /login] erro:', e)
    res.status(500).json({ erro: 'Erro ao processar login' })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /me
// Retorna os dados do usuário logado a partir do JWT.
// ─────────────────────────────────────────────────────────────
router.get('/me', validarToken, async (req: Request, res: Response) => {
  try {
    const payload = req.user
    const id = Number(payload?.sub)

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ erro: 'Token sem identificação de usuário' })
    }

    const usuario = await AuthService.getUsuarioPorId(id)
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' })
    }

    res.json(usuario)
  } catch (e: unknown) {
    console.error('[GET /me] erro:', e)
    res.status(500).json({ erro: 'Erro ao buscar usuário' })
  }
})

export default router


















