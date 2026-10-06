import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo, AuthenticationResult } from '@azure/msal-node'
import { createMicrosoftAuthRouter, type MicrosoftAuthDependencies } from '../routes/entra-auth.routes.js'
import { GraphServiceError } from '../services/graph.js'

const account: AccountInfo = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  username: 'user@example.com',
  localAccountId: 'local-id',
}
const tokenResult = {
  account,
  accessToken: 'mock-access-token',
} as AuthenticationResult

process.env.AZURE_TENANT_ID = 'test-tenant-id'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.NODE_ENV = 'test'

function dependencies(
  overrides: Partial<MicrosoftAuthDependencies> = {},
): MicrosoftAuthDependencies {
  return {
    getAuthUrl: async (_session, state) =>
      `https://login.microsoftonline.com/authorize?prompt=select_account&state=${state}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback`,
    acquireTokenByCode: async (_code, msalSession) => {
      msalSession.msalCache = 'session-cache'
      return tokenResult
    },
    acquireTokenSilent: async () => tokenResult,
    getGraphProfile: async () => ({
      id: 'user-id',
      displayName: 'Test User',
      mail: 'user@example.com',
      companyName: 'Example Co',
    }),
    getGraphGroups: async () => [{ id: 'group-id', displayName: 'Group 1' }],
    ...overrides,
  }
}

async function startApi(overrides: Partial<MicrosoftAuthDependencies> = {}) {
  const app = express()
  app.use(session({
    name: 'clientemonitor.sid',
    secret: 'test-session-secret-with-more-than-thirty-two-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }))
  app.use('/auth', createMicrosoftAuthRouter(dependencies(overrides)))
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

function sessionCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'esperava Set-Cookie na resposta')
  return cookie
}

async function login(api: Awaited<ReturnType<typeof startApi>>): Promise<string> {
  const loginResponse = await fetch(`${api.baseUrl}/auth/login`, { redirect: 'manual' })
  assert.equal(loginResponse.status, 302)
  const loginCookie = sessionCookie(loginResponse)
  const state = new URL(loginResponse.headers.get('location')!).searchParams.get('state')
  assert.ok(state)

  const callbackResponse = await fetch(
    `${api.baseUrl}/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: loginCookie }, redirect: 'manual' },
  )
  assert.equal(callbackResponse.status, 302)
  assert.equal(callbackResponse.headers.get('location'), 'http://localhost:5173/dashboard')
  return sessionCookie(callbackResponse)
}

test('callback trata code ausente e erros retornados pelo Entra', async () => {
  const api = await startApi()
  try {
    const missingCode = await fetch(`${api.baseUrl}/auth/callback`)
    assert.equal(missingCode.status, 400)
    assert.deepEqual(await missingCode.json(), { error: 'Código OAuth ausente' })

    const entraError = await fetch(
      `${api.baseUrl}/auth/callback?error=access_denied&error_description=do-not-return-this`,
    )
    assert.equal(entraError.status, 401)
    assert.deepEqual(await entraError.json(), { error: 'Autenticação Microsoft não concluída' })
  } finally {
    await api.close()
  }
})

test('callback salva sessão e /me retorna perfil Graph normalizado', async () => {
  let requestedCode = ''
  let requestedAccessToken = ''
  const api = await startApi({
    acquireTokenByCode: async (code, msalSession) => {
      requestedCode = code
      msalSession.msalCache = 'serialized-user-cache'
      return tokenResult
    },
    acquireTokenSilent: async () => tokenResult,
    getGraphProfile: async (accessToken) => {
      requestedAccessToken = accessToken
      return {
        id: 'user-id',
        displayName: 'Test User',
        userPrincipalName: 'user@example.com',
        companyName: 'Example Co',
      }
    },
    getGraphGroups: async () => [{ id: 'group-id' }],
  })
  try {
    const cookie = await login(api)
    const response = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal(response.status, 200)
    assert.equal(requestedCode, 'mock-code')
    assert.equal(requestedAccessToken, 'mock-access-token')
    assert.deepEqual(await response.json(), {
      user: {
        id: 'user-id',
        displayName: 'Test User',
        email: 'user@example.com',
        companyName: 'Example Co',
        jobTitle: '',
        department: '',
        officeLocation: '',
        mobilePhone: '',
        businessPhones: '',
        preferredLanguage: '',
        userPrincipalName: 'user@example.com',
        tenantId: 'tenant-id',
        raw: {
          id: 'user-id',
          displayName: 'Test User',
          userPrincipalName: 'user@example.com',
          companyName: 'Example Co',
        },
      },
      groups: [{ id: 'group-id' }],
      clientIp: '127.0.0.1',
      source: 'graph',
    })
  } finally {
    await api.close()
  }
})

test('middleware e /silent exigem sessão e sinalizam falha de token silencioso', async () => {
  const api = await startApi({
    acquireTokenSilent: async () => {
      throw new Error('no cached token')
    },
  })
  try {
    const noSession = await fetch(`${api.baseUrl}/auth/silent`)
    assert.equal(noSession.status, 401)
    assert.deepEqual(await noSession.json(), { needsLogin: true })
    const meNoSession = await fetch(`${api.baseUrl}/auth/me`)
    assert.equal(meNoSession.status, 401)
    assert.deepEqual(await meNoSession.json(), { needsLogin: true })

    const cookie = await login(api)
    const silentFailure = await fetch(`${api.baseUrl}/auth/silent`, { headers: { cookie } })
    assert.equal(silentFailure.status, 401)
    assert.deepEqual(await silentFailure.json(), { needsLogin: true })
  } finally {
    await api.close()
  }
})

test('erro do Graph preserva o status e logout destrói a sessão', async () => {
  const api = await startApi({
    getGraphGroups: async () => {
      throw new GraphServiceError('Permissão insuficiente', 403)
    },
  })
  try {
    const cookie = await login(api)
    const graphError = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal(graphError.status, 403)
    assert.deepEqual(await graphError.json(), { error: 'Permissão insuficiente' })

    const logout = await fetch(`${api.baseUrl}/auth/logout`, {
      headers: { cookie },
      redirect: 'manual',
    })
    assert.equal(logout.status, 302)
    const logoutUrl = new URL(logout.headers.get('location')!)
    assert.equal(logoutUrl.hostname, 'login.microsoftonline.com')
    assert.equal(
      logoutUrl.searchParams.get('post_logout_redirect_uri'),
      'http://localhost:5173/?signedOut=1',
    )
    assert.match(logout.headers.get('set-cookie') ?? '', /^clientemonitor\.sid=;/)
  } finally {
    await api.close()
  }
})
