import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'

process.env.DATABASE_CLIENTE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.SECRET_KEY ??= 'test-secret-key-for-email-admin-routes'

const { default: authRoutes } = await import('../routes/auth.routes.js')

async function startApi() {
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
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

test('cadastro, reenvio e teste SMTP exigem identidade administrativa', async () => {
  const api = await startApi()
  const routes = [
    '/clientes/cadastrar',
    '/clientes/123/reenviar-convite',
    '/email/testar',
  ]

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
