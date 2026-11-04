import type { RequestHandler } from 'express'
import { EmailServiceError, enviarEmail, verificarConexaoSmtp } from '../services/email/email.service.js'
import { logger } from '../utils/logger.js'

export interface EmailControllerDependencies {
  enviarEmail: typeof enviarEmail
  verificarConexaoSmtp: typeof verificarConexaoSmtp
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (character) => entities[character]!)
}

function emailErrorDetails(error: unknown): string {
  if (!(error instanceof EmailServiceError)) return 'Ocorreu uma falha interna ao enviar o e-mail.'

  switch (error.category) {
    case 'authentication':
      return 'Falha na autenticação SMTP.'
    case 'connection':
      return 'Não foi possível conectar ao servidor SMTP.'
    case 'timeout':
      return 'Tempo limite ao comunicar com o servidor SMTP.'
    case 'recipient_rejected':
      return 'O servidor SMTP rejeitou o destinatário.'
    case 'unknown':
      return 'O servidor SMTP não conseguiu concluir o envio.'
  }
}

export function createEmailController(
  dependencies: EmailControllerDependencies = { enviarEmail, verificarConexaoSmtp },
) {
  const enviar: RequestHandler = async (req, res) => {
    const body: unknown = req.body
    const details: Array<{ field: string; message: string }> = []

    if (!isRecord(body)) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: [{ field: 'body', message: 'O corpo deve ser um objeto JSON.' }],
      })
    }

    const allowedFields = new Set(['to', 'subject', 'text'])
    for (const field of Object.keys(body)) {
      if (!allowedFields.has(field)) {
        details.push({ field, message: 'Campo não permitido.' })
      }
    }

    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''

    if (!to || to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      details.push({ field: 'to', message: 'Informe um endereço de e-mail válido.' })
    }
    if (!subject) details.push({ field: 'subject', message: 'O assunto é obrigatório.' })
    if (!text.trim()) details.push({ field: 'text', message: 'O texto é obrigatório.' })

    if (details.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation error', details })
    }

    try {
      const result = await dependencies.enviarEmail(to, subject, undefined, text)
      return res.json({
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      })
    } catch (error: unknown) {
      logger.error('Falha ao enviar e-mail', {
        category: error instanceof EmailServiceError ? error.category : 'configuration_or_internal',
      })
      return res.status(500).json({
        success: false,
        error: 'Falha ao enviar e-mail',
        details: emailErrorDetails(error),
      })
    }
  }

  const testarConexaoSmtp: RequestHandler = async (_req, res) => {
    try {
      await dependencies.verificarConexaoSmtp()
      return res.json({ sucesso: true, mensagem: 'Conexão SMTP estabelecida com sucesso.' })
    } catch (error: unknown) {
      logger.error('Falha no teste administrativo de conexão SMTP', {
        category: error instanceof EmailServiceError ? error.category : 'configuration_or_internal',
      })
      return res.status(502).json({ sucesso: false, mensagem: 'Não foi possível estabelecer conexão com o SMTP.' })
    }
  }

  const testarEnvio: RequestHandler = async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'O envio de teste SMTP só está disponível em ambiente de desenvolvimento.',
      })
    }

    const body: unknown = req.body
    if (!isRecord(body)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Informe destinatário, assunto e corpo.' })
    }

    const allowedFields = new Set(['destinatario', 'assunto', 'corpo'])
    if (Object.keys(body).some((field) => !allowedFields.has(field))) {
      return res.status(400).json({ sucesso: false, mensagem: 'A requisição contém campos não permitidos.' })
    }

    const destinatario = typeof body.destinatario === 'string' ? body.destinatario.trim() : ''
    const assunto = typeof body.assunto === 'string' ? body.assunto.trim() : ''
    const corpo = body.corpo

    if (!destinatario || destinatario.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Destinatário inválido.' })
    }
    if (!assunto || assunto.length > 200 || /[\r\n]/.test(assunto)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Assunto inválido; informe até 200 caracteres em uma linha.' })
    }
    if (typeof corpo !== 'string' || !corpo.trim() || corpo.length > 10_000) {
      return res.status(400).json({ sucesso: false, mensagem: 'O corpo é obrigatório e deve ter até 10.000 caracteres.' })
    }

    try {
      await dependencies.enviarEmail(
        destinatario,
        assunto,
        `<div style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;">${escapeHtml(corpo)}</div>`,
        corpo,
      )
      return res.json({
        sucesso: true,
        mensagem: 'E-mail de teste enviado com sucesso.',
        email: { enviado: true, destinatario },
      })
    } catch (error: unknown) {
      logger.error('Falha ao enviar e-mail de teste', {
        category: error instanceof EmailServiceError ? error.category : 'configuration_or_internal',
      })
      return res.status(502).json({
        sucesso: false,
        mensagem: 'Não foi possível enviar o e-mail de teste.',
        email: { enviado: false },
      })
    }
  }

  return { enviar, testarConexaoSmtp, testarEnvio }
}
