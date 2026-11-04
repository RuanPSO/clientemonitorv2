import 'dotenv/config'
import nodemailer, { type SendMailOptions } from 'nodemailer'
import {
  readEmailSmtpConfig,
  toSmtpTransportOptions,
  type SmtpTransportOptions,
} from './email.config.js'

interface EmailTransporter {
  sendMail(options: SendMailOptions): Promise<{
    messageId: string
    accepted: unknown[]
    rejected: unknown[]
  }>
  verify(): Promise<unknown>
}
type TransportFactory = (options: SmtpTransportOptions) => EmailTransporter

export interface EmailSendResult {
  messageId: string
  accepted: unknown[]
  rejected: unknown[]
}

export type EmailErrorCategory =
  | 'authentication'
  | 'connection'
  | 'timeout'
  | 'recipient_rejected'
  | 'unknown'

export class EmailServiceError extends Error {
  constructor(readonly category: EmailErrorCategory) {
    super(`Falha no serviço de e-mail (${category})`)
    this.name = 'EmailServiceError'
  }
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function errorCategory(error: unknown): EmailErrorCategory {
  if (typeof error !== 'object' || error === null) return 'unknown'

  const details = error as { code?: unknown; responseCode?: unknown; command?: unknown }
  const code = typeof details.code === 'string' ? details.code.toUpperCase() : ''
  const command = typeof details.command === 'string' ? details.command.toUpperCase() : ''

  if (code === 'EAUTH') return 'authentication'
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout'
  if (code === 'EENVELOPE' || command.includes('RCPT') || details.responseCode === 550) {
    return 'recipient_rejected'
  }
  if (code.startsWith('ECONNECTION') || code === 'ESOCKET' || code === 'ECONNREFUSED') {
    return 'connection'
  }
  return 'unknown'
}

export function createEmailService(
  env: NodeJS.ProcessEnv = process.env,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
) {
  const config = readEmailSmtpConfig(env)
  const transporter = createTransport(toSmtpTransportOptions(config))

  return {
    async enviarEmail(
      destinatario: string,
      assunto: string,
      html: string | undefined,
      texto: string,
    ): Promise<EmailSendResult> {
      if (!isEmail(destinatario)) throw new Error('Destinatário inválido')

      try {
        const message: SendMailOptions = {
          from: config.from,
          to: destinatario,
          subject: assunto,
          text: texto,
        }
        if (html !== undefined) message.html = html

        const result = await transporter.sendMail(message)
        return {
          messageId: result.messageId,
          accepted: result.accepted,
          rejected: result.rejected,
        }
      } catch (error) {
        throw new EmailServiceError(errorCategory(error))
      }
    },

    async verificarConexao(): Promise<void> {
      try {
        await transporter.verify()
      } catch (error) {
        throw new EmailServiceError(errorCategory(error))
      }
    },
  }
}

let emailService: ReturnType<typeof createEmailService> | undefined

export function initializeEmailService(): void {
  if (!emailService) emailService = createEmailService()
}

function getEmailService(): ReturnType<typeof createEmailService> {
  initializeEmailService()
  return emailService!
}

export function enviarEmail(
  destinatario: string,
  assunto: string,
  html: string | undefined,
  texto: string,
): Promise<EmailSendResult> {
  return getEmailService().enviarEmail(destinatario, assunto, html, texto)
}

export function verificarConexaoSmtp(): Promise<void> {
  return getEmailService().verificarConexao()
}
