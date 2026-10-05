// routes/auth.routes.ts
import 'dotenv/config'
import { Router } from 'express'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import crypto from 'node:crypto'

import { AuthService } from '../services/auth.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'
import { UsuarioRepository } from '../repositories/cliente/usuario.repository.js'
import { gerarHashWerkzeug, verificarSenhaWerkzeug } from '../utils/helpers.js'
import { enviarEmailAtivacao } from '../lib/email.js'
import { prismaCliente } from '../lib/prisma-cliente.js'

const router = Router()
const SECRET = process.env.SECRET_KEY ?? process.env.APIKEY

if (!SECRET) {
  throw new Error('SECRET_KEY (ou APIKEY) não definida no .env')
}

/**
 * POST /auth/token
 */
router.post('/auth/token', (_req, res) => {
  const expiresInEnv = process.env.JWT_EXPIRES_IN ?? 'never'
  const payload = { origem: 'portal' }

  let token: string

  if (expiresInEnv === 'never') {
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

// ─────────────────────────────────────────────────────────────
// POST /login
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, senha } = req.body ?? {}

    const resultado = await AuthService.login(String(email ?? ''), String(senha ?? ''))

    if (!resultado.ok) {
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

// ─────────────────────────────────────────────────────────────
// POST /users
// ✅ Sem SELECT prévio. Confia na UNIQUE do banco. Elimina race.
// ─────────────────────────────────────────────────────────────
router.post('/users', validarToken, async (req: Request, res: Response) => {
  try {
    const { nome, email, cargo, grupo } = req.body ?? {}

    if (!nome || !email || !grupo) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const tokenAtivacao = crypto.randomBytes(32).toString('base64url')

    let id: number
    try {
      id = await UsuarioRepository.criar({
        nome: String(nome).trim(),
        email: emailNorm,
        cargo: cargo ? String(cargo).trim() : null,
        id_grupo: Number(grupo),
        token_ativacao: tokenAtivacao,
      })
    } catch (errIns: any) {
      const msg = String(errIns?.message ?? '')
      // P2002 = unique constraint do Prisma. Também cobrimos pela mensagem.
      if (errIns?.code === 'P2002' || /unique|duplicate/i.test(msg)) {
        return res.status(409).json({ error: 'E-mail já cadastrado' })
      }
      throw errIns
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173'
    const link = `${appUrl}/ativar?token=${tokenAtivacao}`

    try {
      await enviarEmailAtivacao({
        destinatario: emailNorm,
        nome: String(nome).trim(),
        link,
      })
    } catch (errEmail) {
      console.error('[POST /users] Erro ao enviar e-mail:', errEmail)
      return res.status(201).json({
        message: 'Usuário criado, mas o envio de e-mail falhou. Verifique o log.',
        usuarioId: id,
        aviso: 'email_falhou',
      })
    }

    console.log(`[ATIVAÇÃO] ${emailNorm} → ${link}`)

    res.status(201).json({
      message: 'Usuário criado. Aguardando ativação.',
      usuarioId: id,
    })
  } catch (e: unknown) {
    console.error('[POST /users]', e)
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /ativar?token=XXX  (público)
// ─────────────────────────────────────────────────────────────
router.get('/ativar', async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token ?? '')
    if (!token) {
      return res.status(400).json({ error: 'Token inválido' })
    }

    const user = await UsuarioRepository.findByTokenAtivacao(token)
    if (!user) {
      return res.status(404).json({ error: 'Token inválido' })
    }

    if (user.token_expira && new Date(user.token_expira) < new Date()) {
      return res.status(410).json({ error: 'Token expirado' })
    }

    if (user.ativo) {
      return res.status(409).json({ error: 'Usuário já ativado' })
    }

    res.json({
      valido: true,
      nome: user.nome,
      email: user.email,
    })
  } catch (e: unknown) {
    console.error('[GET /ativar]', e)
    res.status(500).json({ error: 'Erro ao validar token' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /ativar  (público)
// ─────────────────────────────────────────────────────────────
router.post('/ativar', async (req: Request, res: Response) => {
  try {
    const { token, senha } = req.body ?? {}

    if (!token || !senha) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    if (String(senha).length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' })
    }

    const user = await UsuarioRepository.findByTokenAtivacao(String(token))
    if (!user) {
      return res.status(404).json({ error: 'Token inválido' })
    }

    if (user.token_expira && new Date(user.token_expira) < new Date()) {
      return res.status(410).json({ error: 'Token expirado' })
    }

    if (user.ativo) {
      return res.status(409).json({ error: 'Usuário já ativado' })
    }

    const senhaHash = gerarHashWerkzeug(String(senha))
    await UsuarioRepository.ativarComSenha(user.id, senhaHash)

    console.log(`[ATIVADO] ${user.email}`)

    res.json({ message: 'Conta ativada com sucesso' })
  } catch (e: unknown) {
    console.error('[POST /ativar]', e)
    res.status(500).json({ error: 'Erro ao ativar conta' })
  }
})

export default router