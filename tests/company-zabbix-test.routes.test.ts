import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'
import companyZabbixTestRoutes from '../routes/company-zabbix-test.routes.js'

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
      username: 'user@example.com',
      localAccountId: 'local-id',
    } satisfies AccountInfo
    req.session.user = {
      displayName: 'Test User',
      email: 'user@example.com',
      companyName: req.params.companyName,
      jobTitle: 'Engineer',
    }
    res.sendStatus(204)
  })
  app.use('/admin', companyZabbixTestRoutes)
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

test('página diagnóstica mostra login anonimamente e serve seu script na mesma origem', async () => {
  const api = await startApi()
  try {
    const page = await fetch(`${api.baseUrl}/admin/company-zabbix-test`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /href="\/auth\/login"/)

    const script = await fetch(`${api.baseUrl}/admin/company-zabbix-test.js`)
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type') ?? '', /javascript/)
    assert.match(await script.text(), /fetch\('\/auth\/me'/)

    const stylesheet = await fetch(`${api.baseUrl}/admin/company-zabbix-test.css`)
    assert.equal(stylesheet.status, 200)
    assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/)

    const result = await fetch(`${api.baseUrl}/admin/company-zabbix-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(result.status, 401)
  } finally {
    await api.close()
  }
})

test('identidade do mapeamento vem da sessão; empresa simulada não a substitui', async () => {
  const api = await startApi()
  try {
    const loginResponse = await fetch(`${api.baseUrl}/test/login/Cloud%20Core`)
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const response = await fetch(`${api.baseUrl}/admin/company-zabbix-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        companyName: 'SPS Rio',
        simulateCompanyName: 'SPS Minas',
      }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), {
      diagnosticOnly: true,
      actual: {
        companyName: 'Cloud Core',
        groupName: null,
        groups: ['SPS_MATRIZ', 'SPS_BH', 'SPS_RJ', 'SPS_CURITIBA', 'SPS_BOLIVIA', 'SPS_INNO'],
        mapped: false,
        fallbackPolicy: 'all_groups',
      },
      simulation: {
        companyName: 'SPS Minas',
        groupName: 'SPS_BH',
        groups: ['SPS_BH'],
        mapped: true,
        fallbackPolicy: null,
      },
    })
  } finally {
    await api.close()
  }
})

test('sessões distintas não reutilizam o mapeamento de outra conta', async () => {
  const api = await startApi()
  try {
    const results: Array<[string, string | null]> = []
    for (const companyName of ['SPS Enterprise', 'SPS Minas']) {
      const loginResponse = await fetch(
        `${api.baseUrl}/test/login/${encodeURIComponent(companyName)}`,
      )
      const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
      assert.ok(cookie)

      const response = await fetch(`${api.baseUrl}/admin/company-zabbix-test/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({}),
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      results.push([result.actual.companyName, result.actual.groupName])
    }

    assert.deepEqual(results, [
      ['SPS Enterprise', 'SPS_MATRIZ'],
      ['SPS Minas', 'SPS_BH'],
    ])
  } finally {
    await api.close()
  }
})

test('session and simulation return the same all-groups fallback for an unmapped company', async () => {
  const api = await startApi()
  try {
    const loginResponse = await fetch(`${api.baseUrl}/test/login/Cloud%20Core`)
    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const response = await fetch(`${api.baseUrl}/admin/company-zabbix-test/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ simulateCompanyName: 'Cloud Core' }),
    })
    assert.equal(response.status, 200)

    const result = await response.json()
    assert.equal(result.actual.fallbackPolicy, 'all_groups')
    assert.deepEqual(result.simulation, result.actual)
    assert.deepEqual(result.actual.groups, [
      'SPS_MATRIZ',
      'SPS_BH',
      'SPS_RJ',
      'SPS_CURITIBA',
      'SPS_BOLIVIA',
      'SPS_INNO',
    ])
  } finally {
    await api.close()
  }
})
