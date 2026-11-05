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
import { gerarHashScrypt, validarSenhaForte } from '../utils/helpers.js'
import { prismaCliente } from '../lib/prisma-cliente.js'
import { requireAccessLevel } from '../middlewares/access-control.middleware.js'
import { logger } from '../utils/logger.js'
import { createActivationUrl } from '../services/email/email.config.js'
import { EmailServiceError, enviarEmail } from '../services/email/email.service.js'
import { ASSUNTO_CONVITE_CLIENTE, renderConviteCliente } from '../services/email/templates/convite-cliente.template.js'

const router = Router()
const SECRET = process.env.SECRET_KEY ?? process.env.APIKEY

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const details = error as { code?: unknown; message?: unknown }
  const message = typeof details.message === 'string' ? details.message : ''
  return details.code === 'P2002' || details.code === '23505' || /unique|duplicate/i.test(message)
}

if (!SECRET) {
  throw new Error('SECRET_KEY (ou APIKEY) não definida no .env')
}

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n

export function parseZabbixGroupId(value: unknown): bigint | null {
  let serialized: string
  if (typeof value === 'string') {
    serialized = value.trim()
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    serialized = String(value)
  } else {
    return null
  }

  if (!/^\d+$/.test(serialized)) return null

  const groupId = BigInt(serialized)
  return groupId > 0n && groupId <= MAX_POSTGRES_BIGINT ? groupId : null
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
router.post('/users', validarToken, requireAccessLevel('total'), async (req: Request, res: Response) => {
  try {
    const { nome, email, cargo, grupo } = req.body ?? {}

    if (!nome || !email || !grupo) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    const emailNorm = String(email).trim().toLowerCase()
    const tokenAtivacao = crypto.randomBytes(32).toString('base64url')
    const nomeLimpo = String(nome).trim()
    const grupoId = Number(grupo)
    if (!nomeLimpo || !Number.isInteger(grupoId) || grupoId <= 0) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    const grupos = await prismaCliente.$queryRaw<Array<{ nome: string }>>`
      SELECT nome FROM grupos_hosts WHERE id = ${grupoId} LIMIT 1
    `
    const grupoInfo = grupos[0]
    if (!grupoInfo) return res.status(400).json({ error: 'Grupo inválido' })

    let link: string
    try {
      link = createActivationUrl(tokenAtivacao)
    } catch (error) {
      logger.error('Configuração de URL de ativação inválida', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      return res.status(503).json({ error: 'Configuração de convite indisponível' })
    }

    let id: number
    try {
      id = await UsuarioRepository.criar({
        nome: nomeLimpo,
        email: emailNorm,
        cargo: cargo ? String(cargo).trim() : null,
        id_grupo: grupoId,
        token_ativacao: tokenAtivacao,
      })
    } catch (errIns: unknown) {
      if (isUniqueConstraintError(errIns)) {
        return res.status(409).json({ error: 'E-mail já cadastrado' })
      }
      throw errIns
    }

    try {
      const convite = renderConviteCliente({
        nome: nomeLimpo,
        email: emailNorm,
        grupo: grupoInfo.nome.trim(),
        urlAtivacao: link,
      })
      await enviarEmail(emailNorm, ASSUNTO_CONVITE_CLIENTE, convite.html, convite.texto)
    } catch (emailError) {
      logger.error('Falha ao enviar convite de cliente', {
        userId: id,
        category: emailError instanceof EmailServiceError ? emailError.category : 'configuration_or_internal',
      })
      return res.status(502).json({
        message: 'Usuário criado, mas o convite não foi enviado. Tente novamente.',
        usuarioId: id,
        aviso: 'email_falhou',
      })
    }

    res.status(201).json({
      message: 'Usuário criado. Aguardando ativação.',
      usuarioId: id,
    })
  } catch (e: unknown) {
    logger.error('Falha ao criar usuário pelo endpoint legado', {
      errorName: e instanceof Error ? e.name : 'unknown',
    })
    res.status(500).json({ error: 'Erro ao criar usuário' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /clientes/cadastrar
// O token só aparece em NODE_ENV=test com EMAIL_INCLUDE_ACTIVATION_TOKEN_IN_RESPONSE=true.
// ─────────────────────────────────────────────────────────────
router.post('/clientes/cadastrar', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {}
    const { nome, cargo, email, id_grupo } = body

    const camposProibidos = ['ativo', 'senha', 'token_ativacao', 'token_expira']
    const camposEnviados = camposProibidos.filter((campo) => Object.prototype.hasOwnProperty.call(body, campo))
    if (camposEnviados.length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: `Campos não permitidos no cadastro: ${camposEnviados.join(', ')}`,
      })
    }

    if (!nome || !cargo || !email || id_grupo === undefined || id_grupo === null || id_grupo === '') {
      return res.status(400).json({ sucesso: false, erro: 'nome, cargo, email e id_grupo são obrigatórios' })
    }

    const nomeLimpo = String(nome).trim()
    const cargoLimpo = String(cargo).trim()
    const emailLimpo = String(email).trim().toLowerCase()
    const idGrupoZabbix = parseZabbixGroupId(id_grupo)

    if (!nomeLimpo || !cargoLimpo || !emailLimpo) {
      return res.status(400).json({ sucesso: false, erro: 'nome, cargo e e-mail não podem ficar vazios' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailLimpo)) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' })
    }

    if (idGrupoZabbix === null) {
      return res.status(400).json({ sucesso: false, erro: 'id_grupo inválido' })
    }

    const grupos = await prismaCliente.$queryRaw<Array<{ id: number; nome: string; groupid_zabbix: bigint }>>`
      SELECT id, nome, groupid_zabbix
      FROM grupos_hosts
      WHERE groupid_zabbix = ${idGrupoZabbix}
      LIMIT 1
    `
    const grupoInfo = grupos[0]
    if (!grupoInfo) {
      return res.status(400).json({ sucesso: false, erro: 'Grupo Zabbix informado não existe ou ainda não está sincronizado' })
    }

    const emailDuplicado = await prismaCliente.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM usuarios
      WHERE email = ${emailLimpo}
      LIMIT 1
    `

    if (emailDuplicado.length > 0) {
      return res.status(409).json({ sucesso: false, erro: 'E-mail já cadastrado' })
    }

    const tokenAtivacao = crypto.randomBytes(32).toString('base64url')
    const tokenExpira = new Date(Date.now() + 24 * 60 * 60 * 1000)
    let urlAtivacao: string
    try {
      urlAtivacao = createActivationUrl(tokenAtivacao)
    } catch (error) {
      logger.error('Configuração de URL de ativação inválida', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      return res.status(503).json({ sucesso: false, erro: 'Configuração de convite indisponível' })
    }
    const convite = renderConviteCliente({
      nome: nomeLimpo,
      email: emailLimpo,
      grupo: grupoInfo.nome.trim(),
      urlAtivacao,
    })
    let idUsuario: number
    try {
      idUsuario = await UsuarioRepository.criar({
        nome: nomeLimpo,
        email: emailLimpo,
        cargo: cargoLimpo,
        id_grupo: Number(grupoInfo.id),
        token_ativacao: tokenAtivacao,
        token_expira: tokenExpira,
      })
    } catch (createError) {
      if (isUniqueConstraintError(createError)) {
        return res.status(409).json({ sucesso: false, erro: 'E-mail já cadastrado' })
      }
      throw createError
    }

    try {
      await enviarEmail(emailLimpo, ASSUNTO_CONVITE_CLIENTE, convite.html, convite.texto)
    } catch (emailError) {
      logger.error('Cadastro criado, mas o convite de cliente não foi enviado', {
        userId: idUsuario,
        category: emailError instanceof EmailServiceError ? emailError.category : 'configuration_or_internal',
      })
      return res.status(502).json({
        sucesso: false,
        cadastro_criado: true,
        email_enviado: false,
        mensagem: 'O cadastro foi criado, mas não foi possível enviar o convite. Tente novamente.',
      })
    }

    const incluirTokenDeTeste =
      process.env.NODE_ENV === 'test' && process.env.EMAIL_INCLUDE_ACTIVATION_TOKEN_IN_RESPONSE === 'true'

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Cadastro criado e convite enviado com sucesso.',
      usuario: {
        id: idUsuario,
        nome: nomeLimpo,
        email: emailLimpo,
        id_grupo: Number(grupoInfo.id),
        groupid_zabbix: String(grupoInfo.groupid_zabbix),
        ativo: false,
      },
      email: {
        enviado: true,
        destinatario: emailLimpo,
      },
      ...(incluirTokenDeTeste ? { token_ativacao: tokenAtivacao } : {}),
      token_expira: tokenExpira.toISOString(),
    })
  } catch (error: unknown) {
    logger.error('Falha ao processar cadastro de cliente', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return res.status(500).json({ sucesso: false, erro: 'Erro ao cadastrar cliente' })
  }
})

router.post('/clientes/:id/reenviar-convite', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ sucesso: false, erro: 'ID de cliente inválido' })
  }

  try {
    const existing = await UsuarioRepository.findConvitePendenteById(id)
    if (!existing) return res.status(404).json({ sucesso: false, erro: 'Cliente não encontrado' })
    if (existing.ativo) return res.status(409).json({ sucesso: false, erro: 'Não é possível reenviar convite para conta ativada' })

    const tokenAtivacao = crypto.randomBytes(32).toString('base64url')
    const tokenExpira = new Date(Date.now() + 24 * 60 * 60 * 1000)
    let urlAtivacao: string
    try {
      urlAtivacao = createActivationUrl(tokenAtivacao)
    } catch (error) {
      logger.error('Configuração de URL de ativação inválida', {
        userId: id,
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      return res.status(503).json({ sucesso: false, erro: 'Configuração de convite indisponível' })
    }
    const convite = renderConviteCliente({
      nome: existing.nome,
      email: existing.email,
      grupo: existing.grupo,
      urlAtivacao,
    })

    const pending = await UsuarioRepository.emitirNovoConvite(id, tokenAtivacao, tokenExpira)
    if (!pending) {
      return res.status(409).json({ sucesso: false, erro: 'A conta foi ativada ou atualizada; atualize os dados e tente novamente' })
    }

    try {
      await enviarEmail(pending.email, ASSUNTO_CONVITE_CLIENTE, convite.html, convite.texto)
    } catch (emailError) {
      logger.error('Falha ao reenviar convite de cliente', {
        userId: id,
        category: emailError instanceof EmailServiceError ? emailError.category : 'configuration_or_internal',
      })
      return res.status(502).json({
        sucesso: false,
        cadastro_criado: true,
        email_enviado: false,
        mensagem: 'Não foi possível enviar o convite. Tente novamente.',
      })
    }

    return res.json({
      sucesso: true,
      mensagem: 'Convite reenviado com sucesso.',
      usuario: { id: pending.id, nome: pending.nome, email: pending.email, ativo: false },
      email: { enviado: true, destinatario: pending.email },
      token_expira: pending.token_expira?.toISOString() ?? tokenExpira.toISOString(),
    })
  } catch (error: unknown) {
    logger.error('Falha ao processar reenvio de convite', {
      userId: id,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return res.status(500).json({ sucesso: false, erro: 'Erro ao reenviar convite' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /clientes/ativar
// ─────────────────────────────────────────────────────────────
router.post('/clientes/ativar', async (req: Request, res: Response) => {
  try {
    const { token, senha, confirmarSenha } = req.body ?? {}

    if (!token || !senha || !confirmarSenha) {
      return res.status(400).json({ sucesso: false, erro: 'token, senha e confirmarSenha são obrigatórios' })
    }

    const tokenAtivacao = String(token).trim()
    const senhaLimpa = String(senha)
    const confirmarSenhaLimpa = String(confirmarSenha)

    if (senhaLimpa !== confirmarSenhaLimpa) {
      return res.status(400).json({ sucesso: false, erro: 'As senhas não conferem' })
    }

    if (!validarSenhaForte(senhaLimpa)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A senha deve ter no mínimo 8 caracteres, incluindo letra maiúscula, minúscula, número e caractere especial',
      })
    }

    const usuario = await UsuarioRepository.findByTokenAtivacao(tokenAtivacao)
    if (!usuario) {
      return res.status(404).json({ sucesso: false, erro: 'Token inválido' })
    }

    if (usuario.ativo) {
      return res.status(409).json({ sucesso: false, erro: 'Usuário já ativado' })
    }

    if (usuario.token_expira && new Date(usuario.token_expira) < new Date()) {
      return res.status(410).json({ sucesso: false, erro: 'Token expirado' })
    }

    const senhaHash = gerarHashScrypt(senhaLimpa)
    const atualizado = await UsuarioRepository.ativarComSenhaSeValido(usuario.id, senhaHash, tokenAtivacao)

    if (!atualizado) {
      return res.status(409).json({ sucesso: false, erro: 'Token já utilizado ou expirado' })
    }

    return res.json({
      sucesso: true,
      mensagem: 'Conta ativada com sucesso',
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        ativo: true,
      },
    })
  } catch (error: unknown) {
    logger.error('Falha ao ativar conta de cliente', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return res.status(500).json({ sucesso: false, erro: 'Erro ao ativar conta' })
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
    logger.error('Falha ao validar token de ativação', {
      errorName: e instanceof Error ? e.name : 'unknown',
    })
    res.status(500).json({ error: 'Erro ao validar token' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /ativar  (público)
// ─────────────────────────────────────────────────────────────
router.post('/ativar', async (req: Request, res: Response) => {
  try {
    const { token, senha, confirmarSenha } = req.body ?? {}

    if (!token || !senha) {
      return res.status(400).json({ error: 'Dados inválidos' })
    }

    const senhaLimpa = String(senha)
    const confirmarSenhaLimpa = confirmarSenha === undefined ? senhaLimpa : String(confirmarSenha)

    if (senhaLimpa !== confirmarSenhaLimpa) {
      return res.status(400).json({ error: 'As senhas não conferem' })
    }

    if (!validarSenhaForte(senhaLimpa)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, incluindo letra maiúscula, minúscula, número e caractere especial',
      })
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

    const senhaHash = gerarHashScrypt(senhaLimpa)
    const atualizado = await UsuarioRepository.ativarComSenhaSeValido(user.id, senhaHash, String(token))
    if (!atualizado) {
      return res.status(409).json({ error: 'Token já utilizado ou expirado' })
    }

    logger.info('Conta ativada', { userId: user.id })

    res.json({ message: 'Conta ativada com sucesso' })
  } catch (e: unknown) {
    logger.error('Falha ao ativar conta', {
      errorName: e instanceof Error ? e.name : 'unknown',
    })
    res.status(500).json({ error: 'Erro ao ativar conta' })
  }
})

export default router