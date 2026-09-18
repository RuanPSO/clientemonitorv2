// lib/email.ts
import 'dotenv/config'
import nodemailer from 'nodemailer'

const MAIL_ENABLED = process.env.MAIL_ENABLED !== 'false'

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.MAIL,
    pass: process.env.MAILPASS,
  },
})

interface EnviarAtivacaoParams {
  destinatario: string
  nome: string
  link: string
}

export async function enviarEmailAtivacao({
  destinatario,
  nome,
  link,
}: EnviarAtivacaoParams): Promise<void> {
  const remetente = process.env.MAIL
  const nomeRemetente = process.env.MAIL_FROM_NAME ?? 'ClientMonitor'

  if (!remetente) {
    throw new Error('MAIL não definido no .env')
  }

  const assunto = 'Acesso ao ClientMonitor - Ativação de Conta'
  const corpo = `Olá, ${nome}!

Seu acesso ao portal foi criado com sucesso.

Para ativar sua conta, clique no link abaixo:

${link}

Este link expira em 24 horas.

Atenciosamente,
Equipe Datacore
`

  if (!MAIL_ENABLED) {
    console.log('📧 [MAIL DISABLED] Email NÃO enviado. Conteúdo:')
    console.log(`   Para: ${destinatario}`)
    console.log(`   Assunto: ${assunto}`)
    console.log(`   Link: ${link}`)
    return
  }

  try {
    await transporter.sendMail({
      from: `"${nomeRemetente}" <${remetente}>`,
      to: destinatario,
      subject: assunto,
      text: corpo,
    })
    console.log(`📧 [EMAIL ENVIADO] ${destinatario}`)
  } catch (e) {
    console.error(`📧 [ERRO EMAIL] ${(e as Error).message}`)
    throw e
  }
}