import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createActivationUrl,
  readEmailSmtpConfig,
  toSmtpTransportOptions,
} from '../services/email/email.config.js'
import {
  createEmailService,
  EmailServiceError,
} from '../services/email/email.service.js'
import {
  ASSUNTO_CONVITE_CLIENTE,
  renderConviteCliente,
} from '../services/email/templates/convite-cliente.template.js'

function smtpEnv(): NodeJS.ProcessEnv {
  return {
    EMAIL_SMTP_HOST: 'smtp.example.test',
    EMAIL_SMTP_PORT: '587',
    EMAIL_SMTP_USER: 'mailer@example.test',
    EMAIL_SMTP_PASSWORD: 'test-password',
    EMAIL_FROM_ADDRESS: 'no-reply@example.test',
    EMAIL_USE_TLS: 'true',
    EMAIL_USE_SSL: 'false',
  }
}

test('valida a configuração SMTP e exige STARTTLS sem SSL implícito', () => {
  const config = readEmailSmtpConfig(smtpEnv())
  assert.equal(config.port, 587)
  assert.equal(config.secure, false)
  assert.equal(config.requireTLS, true)
  assert.deepEqual(toSmtpTransportOptions(config), {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: 'mailer@example.test', pass: 'test-password' },
  })

  const sslEnv = smtpEnv()
  sslEnv.EMAIL_USE_TLS = 'false'
  sslEnv.EMAIL_USE_SSL = 'true'
  assert.deepEqual(toSmtpTransportOptions(readEmailSmtpConfig(sslEnv)), {
    host: 'smtp.example.test',
    port: 587,
    secure: true,
    auth: { user: 'mailer@example.test', pass: 'test-password' },
  })

  const noTlsEnv = smtpEnv()
  noTlsEnv.EMAIL_USE_TLS = 'false'
  noTlsEnv.EMAIL_USE_SSL = 'false'
  assert.equal(readEmailSmtpConfig(noTlsEnv).requireTLS, false)
})

test('rejeita configuração SMTP incompleta, porta inválida e conflito TLS/SSL', () => {
  const incomplete = smtpEnv()
  delete incomplete.EMAIL_SMTP_PASSWORD
  assert.throws(() => readEmailSmtpConfig(incomplete), /EMAIL_SMTP_PASSWORD/)

  const invalidPort = smtpEnv()
  invalidPort.EMAIL_SMTP_PORT = '587.5'
  assert.throws(() => readEmailSmtpConfig(invalidPort), /número inteiro/)

  const conflict = smtpEnv()
  conflict.EMAIL_USE_SSL = 'true'
  assert.throws(() => readEmailSmtpConfig(conflict), /não podem estar habilitados simultaneamente/)
})

test('cria a URL de ativação com URL e searchParams', () => {
  const url = createActivationUrl('token+/=&value', {
    CLIENTMONITOR_URL: 'http://monitor.example.test/prefix',
  })
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'http://monitor.example.test')
  assert.equal(parsed.pathname, '/ativar')
  assert.equal(parsed.searchParams.get('token'), 'token+/=&value')
  assert.throws(() => createActivationUrl('token', {}), /CLIENTMONITOR_URL não configurada/)
})

test('renderiza convite HTML e texto simples escapando valores dinâmicos', () => {
  const message = renderConviteCliente({
    nome: '<script>alert(1)</script>',
    email: 'user&test@example.test',
    grupo: '"Grupo" & operação',
    urlAtivacao: 'https://monitor.example.test/ativar?token=a&b',
  })

  assert.equal(ASSUNTO_CONVITE_CLIENTE, 'Solicitação de acesso ao Portal de Monitoramento — DataCore')
  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(message.html, /user&amp;test@example\.test/)
  assert.match(message.html, /&quot;Grupo&quot; &amp; operação/)
  assert.match(message.html, /href="https:\/\/monitor\.example\.test\/ativar\?token=a&amp;b"/)
  assert.doesNotMatch(message.html, /<script>/)
  assert.match(message.texto, /https:\/\/monitor\.example\.test\/ativar\?token=a&b/)
  assert.match(message.texto, /Grupo/)
})

test('envia e verifica pelo mesmo transportador SMTP sem conectar durante o teste', async () => {
  let transportOptions: ReturnType<typeof toSmtpTransportOptions> | undefined
  let sentMessage: unknown
  let verifyCalls = 0
  const service = createEmailService(smtpEnv(), (options) => {
    transportOptions = options
    return {
      sendMail: async (message) => {
        sentMessage = message
        return { messageId: 'message-id' }
      },
      verify: async () => {
        verifyCalls += 1
        return true as const
      },
    }
  })

  assert.equal(verifyCalls, 0)
  assert.deepEqual(await service.enviarEmail(
    'client@example.test',
    'Subject',
    '<p>HTML</p>',
    'Text',
  ), { messageId: 'message-id' })
  assert.equal(transportOptions?.requireTLS, true)
  assert.deepEqual(sentMessage, {
    from: 'no-reply@example.test',
    to: 'client@example.test',
    subject: 'Subject',
    html: '<p>HTML</p>',
    text: 'Text',
  })

  await service.verificarConexao()
  assert.equal(verifyCalls, 1)
})

test('rejeita destinatário inválido e classifica falhas SMTP sem propagar detalhes', async () => {
  let sendCalls = 0
  const service = createEmailService(smtpEnv(), () => ({
    sendMail: async () => {
      sendCalls += 1
      throw Object.assign(new Error('private server detail'), { code: 'EAUTH' })
    },
    verify: async () => {
      throw Object.assign(new Error('private connection detail'), { code: 'ETIMEDOUT' })
    },
  }))

  await assert.rejects(service.enviarEmail('not-an-email', 'Subject', '', ''), /Destinatário inválido/)
  assert.equal(sendCalls, 0)

  await assert.rejects(
    service.enviarEmail('client@example.test', 'Subject', '', ''),
    (error: unknown) => error instanceof EmailServiceError && error.category === 'authentication',
  )
  await assert.rejects(
    service.verificarConexao(),
    (error: unknown) => error instanceof EmailServiceError && error.category === 'timeout',
  )
})

test('classifica falhas de conexão e rejeição de destinatário', async () => {
  for (const [failure, category] of [
    [Object.assign(new Error('private connection detail'), { code: 'ECONNECTION' }), 'connection'],
    [Object.assign(new Error('private rejection detail'), { responseCode: 550, command: 'RCPT TO' }), 'recipient_rejected'],
  ] as const) {
    const service = createEmailService(smtpEnv(), () => ({
      sendMail: async () => {
        throw failure
      },
      verify: async () => true,
    }))
    await assert.rejects(
      service.enviarEmail('client@example.test', 'Subject', '', ''),
      (error: unknown) => error instanceof EmailServiceError && error.category === category,
    )
  }
})
