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

// ─────────────────────────────────────────────────────────────
// POST /users
// Cria usuário (endpoint ADMIN, requer JWT)
// Body: { nome, email, cargo, grupo }
//   - "grupo" é o ID do grupo em grupos_hosts (integer)
// ─────────────────────────────────────────────────────────────
router.post('/users', validarToken, async (req: Request, res: Response) => {
  try {
    const { nome, email, cargo, grupo } = req.body ?? {}

    if (!nome || !email || !grupo) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    const emailNorm = String(email).trim().toLowerCase()

    // Verifica se já existe
    const existente = await prismaCliente.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM usuarios WHERE LOWER(email) = ${emailNorm} LIMIT 1
    `
    if (existente.length > 0) {
      return res.status(409).json({ error: 'E-mail já cadastrado' })
    }

    // Gera token de ativação
    const tokenAtivacao = crypto.randomBytes(32).toString('base64url')

    const id = await UsuarioRepository.criar({
      nome: String(nome).trim(),
      email: emailNorm,
      cargo: cargo ? String(cargo).trim() : null,
      id_grupo: Number(grupo),
      token_ativacao: tokenAtivacao,
    })

    // Monta link de ativação
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173'
    const link = `${appUrl}/ativar?token=${tokenAtivacao}`

    // Envia e-mail
    try {
      await enviarEmailAtivacao({
        destinatario: emailNorm,
        nome: String(nome).trim(),
        link,
      })
    } catch (errEmail) {
      console.error('[POST /users] Erro ao enviar e-mail:', errEmail)
      // Usuário foi criado, mas o email falhou — devolve aviso
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
// GET /ativar?token=XXX
// Valida o token (existe + não expirou) e retorna dados básicos do usuário.
// Endpoint PÚBLICO.
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
// POST /ativar
// Ativa o usuário: salva senha e marca como ativo.
// Body: { token, senha }
// Endpoint PÚBLICO.
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


















