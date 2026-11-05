import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'
import { createEmailRoutes, createSendEmailRoute } from '../routes/email.routes.js'
import type { EmailControllerDependencies } from '../controllers/email.controller.js'
import { EmailServiceError } from '../services/email/email.service.js'

process.env.DATABASE_CLIENTE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.SECRET_KEY ??= 'test-secret-key-for-email-admin-routes'

const { default: authRoutes, parseZabbixGroupId } = await import('../routes/auth.routes.js')

async function startApi(emailDependencies: EmailControllerDependencies, nodeEnv = 'development') {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  const app = express()
  app.use(express.json())
  app.use(session({
    name: 'clientemonitor.sid',
    secret: 'test-session-secret-with-more-than-thirty-two-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }))
  app.get('/test/login/:companyName', (req, res) => {
    req.session.account = {
      homeAccountId: 'home-id',
      environment: 'login.microsoftonline.com',
      tenantId: 'tenant-id',
      username: 'admin@example.test',
      localAccountId: 'local-id',
    } satisfies AccountInfo
    req.session.user = {
      displayName: 'Test User',
      email: 'admin@example.test',
      companyName: req.params.companyName,
      jobTitle: 'Engineer',
    }
    res.sendStatus(204)
  })
  app.use(authRoutes)
  app.use('/email', createEmailRoutes(emailDependencies))
  app.use('/send-email', createSendEmailRoute(emailDependencies))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }),
  }
}

test('a rota de teste SMTP continua exigindo identidade administrativa', async () => {
  const api = await startApi({
    enviarEmail: async () => ({ messageId: 'test-message-id', accepted: [], rejected: [] }),
    verificarConexaoSmtp: async () => undefined,
  })

  const routes = ['/email/testar']

  try {
    for (const route of routes) {
      const anonymous = await fetch(`${api.baseUrl}${route}`, { method: 'POST' })
      assert.equal(anonymous.status, 401, `${route} deve rejeitar chamadas anônimas`)
    }

    const login = await fetch(`${api.baseUrl}/test/login/Cloud%20Core`)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    for (const route of routes) {
      const response: Response = await fetch(`${api.baseUrl}${route}`, {
        method: 'POST',
        headers: { cookie },
      })
      assert.equal(response.status, 403, `${route} deve rejeitar identidade sem acesso total`)
    }
  } finally {
    await api.close()
  }
})

test('cadastro e reenvio de convite aceitam chamadas sem sessão e validam os dados', async () => {
  const api = await startApi({
    enviarEmail: async () => ({ messageId: 'test-message-id', accepted: [], rejected: [] }),
    verificarConexaoSmtp: async () => undefined,
  })

  try {
    const cadastro = await fetch(`${api.baseUrl}/clientes/cadastrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(cadastro.status, 400, 'cadastro sem sessão deve chegar à validação')

    const reenvio = await fetch(`${api.baseUrl}/clientes/0/reenviar-convite`, {
      method: 'POST',
    })
    assert.equal(reenvio.status, 400, 'reenvio sem sessão deve chegar à validação do ID')
  } finally {
    await api.close()
  }
})

test('interpreta id_grupo como groupid_zabbix sem perda de precisão', () => {
  assert.equal(parseZabbixGroupId('173'), 173n)
  assert.equal(parseZabbixGroupId('9007199254740993'), 9007199254740993n)
  assert.equal(parseZabbixGroupId(Number.MAX_SAFE_INTEGER + 1), null)
  assert.equal(parseZabbixGroupId('0'), null)
  assert.equal(parseZabbixGroupId('-1'), null)
  assert.equal(parseZabbixGroupId('1.5'), null)
  assert.equal(parseZabbixGroupId('9223372036854775808'), null)
})

test('testar-envio permite chamada sem autenticação somente em desenvolvimento', async () => {
  for (const nodeEnv of ['production', 'test']) {
    let sendCalls = 0
    const api = await startApi({
      enviarEmail: async () => {
        sendCalls += 1
        return { messageId: 'test-message-id', accepted: [], rejected: [] }
      },
      verificarConexaoSmtp: async () => undefined,
    }, nodeEnv)

    try {
      const response = await fetch(`${api.baseUrl}/email/testar-envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinatario: 'destinatario@example.test',
          assunto: 'Teste SMTP',
          corpo: 'Conteúdo de teste',
        }),
      })
      assert.equal(response.status, 403)
      assert.equal(sendCalls, 0)
    } finally {
      await api.close()
    }
  }
})

test('endpoint de envio de teste valida o corpo antes de contactar o SMTP', async () => {
  let sendCalls = 0
  const api = await startApi({
    enviarEmail: async () => {
      sendCalls += 1
      return { messageId: 'test-message-id', accepted: [], rejected: [] }
    },
    verificarConexaoSmtp: async () => undefined,
  })
  try {
    const response: Response = await fetch(`${api.baseUrl}/email/testar-envio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinatario: 'destinatario-invalido',
        assunto: 'Teste',
        corpo: 'Conteúdo de teste',
      }),
    })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      sucesso: false,
      mensagem: 'Destinatário inválido.',
    })
    assert.equal(sendCalls, 0)
  } finally {
    await api.close()
  }
})

test('envia e-mail de teste em texto e HTML escapado sem autenticação em desenvolvimento', async () => {
  let sentMessage: { destinatario: string; assunto: string; html: string | undefined; texto: string } | undefined
  const api = await startApi({
    enviarEmail: async (destinatario, assunto, html, texto) => {
      sentMessage = { destinatario, assunto, html, texto }
      return { messageId: 'test-message-id', accepted: [], rejected: [] }
    },
    verificarConexaoSmtp: async () => undefined,
  })

  try {
    const response = await fetch(`${api.baseUrl}/email/testar-envio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinatario: '  destinatario@example.test ',
        assunto: ' Teste SMTP ',
        corpo: '<script>ok & seguro</script>',
      }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      sucesso: true,
      mensagem: 'E-mail de teste enviado com sucesso.',
      email: { enviado: true, destinatario: 'destinatario@example.test' },
    })
    assert.deepEqual(sentMessage, {
      destinatario: 'destinatario@example.test',
      assunto: 'Teste SMTP',
      html: '<div style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;">&lt;script&gt;ok &amp; seguro&lt;/script&gt;</div>',
      texto: '<script>ok & seguro</script>',
    })
  } finally {
    await api.close()
  }
})

test('retorna 502 sem expor detalhes quando o SMTP falha', async () => {
  const api = await startApi({
    enviarEmail: async () => {
      throw new Error('private SMTP details')
    },
    verificarConexaoSmtp: async () => undefined,
  })

  try {
    const response = await fetch(`${api.baseUrl}/email/testar-envio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinatario: 'destinatario@example.test',
        assunto: 'Teste SMTP',
        corpo: 'Conteúdo de teste',
      }),
    })

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      sucesso: false,
      mensagem: 'Não foi possível enviar o e-mail de teste.',
      email: { enviado: false },
    })
  } finally {
    await api.close()
  }
})

test('recusa credenciais SMTP e corpo acima do limite', async () => {
  let sendCalls = 0
  const api = await startApi({
    enviarEmail: async () => {
      sendCalls += 1
      return { messageId: 'test-message-id', accepted: [], rejected: [] }
    },
    verificarConexaoSmtp: async () => undefined,
  })
  try {
    for (const extra of [
      { EMAIL_SMTP_PASSWORD: 'must-not-be-accepted' },
      { corpo: 'x'.repeat(10_001) },
    ]) {
      const response: Response = await fetch(`${api.baseUrl}/email/testar-envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinatario: 'destinatario@example.test',
          assunto: 'Teste SMTP',
          corpo: 'Conteúdo de teste',
          ...extra,
        }),
      })
      assert.equal(response.status, 400)
    }
    assert.equal(sendCalls, 0)
  } finally {
    await api.close()
  }
})

test('POST /send-email aceita somente to, subject e text sem autenticação em qualquer ambiente', async () => {
  for (const nodeEnv of ['development', 'production', 'test']) {
    let sent: unknown[] | undefined
    const api = await startApi({
      enviarEmail: async (...args) => {
        sent = args
        return {
          messageId: 'test-message-id',
          accepted: ['ruan.oliveira@spsgroup.com.br'],
          rejected: [],
        }
      },
      verificarConexaoSmtp: async () => undefined,
    }, nodeEnv)

    try {
      const response = await fetch(`${api.baseUrl}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'ruan.oliveira@spsgroup.com.br',
          subject: 'teste e-mail',
          text: 'Conteúdo em texto simples',
        }),
      })

      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), {
        success: true,
        messageId: 'test-message-id',
        accepted: ['ruan.oliveira@spsgroup.com.br'],
        rejected: [],
      })
      assert.deepEqual(sent, [
        'ruan.oliveira@spsgroup.com.br',
        'teste e-mail',
        undefined,
        'Conteúdo em texto simples',
      ])
    } finally {
      await api.close()
    }
  }
})

test('POST /send-email retorna erros de validação sem contactar SMTP', async () => {
  let sendCalls = 0
  const api = await startApi({
    enviarEmail: async () => {
      sendCalls += 1
      return { messageId: 'test-message-id', accepted: [], rejected: [] }
    },
    verificarConexaoSmtp: async () => undefined,
  })

  try {
    const response = await fetch(`${api.baseUrl}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'inválido', subject: '', text: ' ' }),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'Validation error',
      details: [
        { field: 'to', message: 'Informe um endereço de e-mail válido.' },
        { field: 'subject', message: 'O assunto é obrigatório.' },
        { field: 'text', message: 'O texto é obrigatório.' },
      ],
    })
    assert.equal(sendCalls, 0)
  } finally {
    await api.close()
  }
})

test('POST /send-email retorna 500 sem expor detalhes SMTP', async () => {
  const api = await startApi({
    enviarEmail: async () => {
      throw new EmailServiceError('authentication')
    },
    verificarConexaoSmtp: async () => undefined,
  })

  try {
    const response = await fetch(`${api.baseUrl}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'ruan.oliveira@spsgroup.com.br',
        subject: 'teste e-mail',
        text: 'Conteúdo em texto simples',
      }),
    })

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'Falha ao enviar e-mail',
      details: 'Falha na autenticação SMTP.',
    })
  } finally {
    await api.close()
  }
})
