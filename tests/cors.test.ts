import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import { createCorsMiddleware } from '../config/cors.js'
import { getSessionCookieOptions } from '../config/session.js'

async function startCorsApi() {
  const app = express()
  app.use(createCorsMiddleware('http://localhost:5173'))
  app.get('/private', (_req, res) => res.status(200).json({ ok: true }))
  app.post('/private', (_req, res) => res.status(200).json({ ok: true }))
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

test('CORS permite a origem configurada com credenciais', async () => {
  const api = await startCorsApi()
  try {
    const response = await fetch(`${api.baseUrl}/private`, {
      credentials: 'include',
      headers: { origin: 'http://localhost:5173' },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  } finally {
    await api.close()
  }
})

test('CORS responde preflight para POST com os headers usados pelo frontend', async () => {
  const api = await startCorsApi()
  try {
    const response = await fetch(`${api.baseUrl}/private`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
    assert.deepEqual(
      response.headers.get('access-control-allow-methods')?.split(',').map((method) => method.trim()),
      ['GET', 'HEAD', 'POST'],
    )
    assert.deepEqual(
      response.headers.get('access-control-allow-headers')?.split(',').map((header) => header.trim().toLowerCase()),
      ['authorization', 'content-type'],
    )
  } finally {
    await api.close()
  }
})

test('CORS não concede acesso à origem não permitida', async () => {
  const api = await startCorsApi()
  try {
    const response = await fetch(`${api.baseUrl}/private`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://untrusted.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    assert.equal(response.headers.get('access-control-allow-origin'), null)
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
  } finally {
    await api.close()
  }
})

test('cookie de sessão preserva defaults locais e permite configuração cross-site segura', () => {
  const names = ['NODE_ENV', 'SESSION_COOKIE_SAME_SITE', 'SESSION_COOKIE_DOMAIN'] as const
  const previous = new Map(names.map((name) => [name, process.env[name]]))

  try {
    process.env.NODE_ENV = 'development'
    delete process.env.SESSION_COOKIE_SAME_SITE
    delete process.env.SESSION_COOKIE_DOMAIN
    assert.deepEqual(getSessionCookieOptions(), {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    })

    process.env.NODE_ENV = 'production'
    process.env.SESSION_COOKIE_SAME_SITE = 'none'
    process.env.SESSION_COOKIE_DOMAIN = '.example.com'
    assert.deepEqual(getSessionCookieOptions(), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      domain: '.example.com',
    })
  } finally {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
