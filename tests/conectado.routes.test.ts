import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import conectadoRoutes from '../routes/conectado.routes.js'

const portalUrl = 'http://10.86.26.18:8410/'
const portalHtml = '<!doctype html><html><body>Portal RDP</body></html>'

async function startApi() {
  const app = express()
  app.use(conectadoRoutes)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}/api/conectado`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

async function getConectado(url: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(url, { method: 'GET' }, (result) => {
      let body = ''
      result.setEncoding('utf8')
      result.on('data', (chunk: string) => { body += chunk })
      result.on('end', () => resolve({ status: result.statusCode ?? 0, body }))
    })
    request.on('error', reject)
    request.end()
  })
}

function setEnvironment(values: Record<string, string | undefined>) {
  const previous = new Map(
    Object.keys(values).map((name) => [name, process.env[name]]),
  )

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

test('GET local consulta diretamente a URL configurada do Portal RDP sem autenticação', async () => {
  const api = await startApi()
  const originalFetch = globalThis.fetch
  const restoreEnvironment = setEnvironment({
    GUACAMOLE_BASE_URL: portalUrl,
    GUACAMOLE_TIMEOUT_MS: '1000',
  })
  const calls: Array<{ input: URL | RequestInfo; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push(init === undefined ? { input } : { input, init })
    return htmlResponse(portalHtml)
  }

  try {
    const response = await getConectado(api.url)
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), { status: 'conectado' })

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.input, portalUrl)
    assert.equal(calls[0]?.init?.method, 'GET')
    assert.equal(calls[0]?.init?.redirect, 'manual')
    assert.equal(new Headers(calls[0]?.init?.headers).has('cookie'), false)
    assert.ok(calls[0]?.init?.signal)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
    await api.close()
  }
})

test('a rota local não aceita POST', async () => {
  const api = await startApi()

  try {
    const response = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(api.url, { method: 'POST' }, (result) => {
        result.resume()
        result.on('end', () => resolve(result.statusCode ?? 0))
      })
      request.on('error', reject)
      request.end()
    })

    assert.equal(response, 404)
  } finally {
    await api.close()
  }
})

test('erros HTTP e redirecionamentos do Portal não geram sucesso', async () => {
  const api = await startApi()
  const originalFetch = globalThis.fetch
  const restoreEnvironment = setEnvironment({
    GUACAMOLE_BASE_URL: portalUrl,
    GUACAMOLE_TIMEOUT_MS: '1000',
  })

  try {
    for (const status of [401, 403, 500, 503, 302]) {
      globalThis.fetch = async () => htmlResponse('', status)
      const portalError = await getConectado(api.url)
      assert.equal(portalError.status, 502, `status do Portal ${status}`)
    }
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
    await api.close()
  }
})

test('recusa resposta que não seja HTML', async () => {
  const api = await startApi()
  const originalFetch = globalThis.fetch
  const restoreEnvironment = setEnvironment({
    GUACAMOLE_BASE_URL: portalUrl,
    GUACAMOLE_TIMEOUT_MS: '1000',
  })

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'conectado' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const jsonResponse = await getConectado(api.url)
    assert.equal(jsonResponse.status, 502)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
    await api.close()
  }
})

test('falha de rede retorna 502 sem expor detalhes da exceção', async () => {
  const api = await startApi()
  const originalFetch = globalThis.fetch
  const restoreEnvironment = setEnvironment({
    GUACAMOLE_BASE_URL: portalUrl,
    GUACAMOLE_TIMEOUT_MS: '1000',
  })
  const originalConsoleError = console.error
  let logs = ''
  console.error = (...args: unknown[]) => { logs += args.join(' ') }
  globalThis.fetch = async () => {
    throw new Error('Falha de rede de teste')
  }

  try {
    const response = await getConectado(api.url)
    assert.equal(response.status, 502)
    assert.doesNotMatch(logs, /Falha de teste/)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
    restoreEnvironment()
    await api.close()
  }
})

test('timeout retorna 504', async () => {
  const api = await startApi()
  const originalFetch = globalThis.fetch
  const restoreEnvironment = setEnvironment({
    GUACAMOLE_BASE_URL: portalUrl,
    GUACAMOLE_TIMEOUT_MS: '20',
  })
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'))
    }, { once: true })
  })

  try {
    const response = await getConectado(api.url)
    assert.equal(response.status, 504)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
    await api.close()
  }
})
