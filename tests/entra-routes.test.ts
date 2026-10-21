import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo, AuthenticationResult } from '@azure/msal-node'
import jwt from 'jsonwebtoken'
import { createMicrosoftAuthRouter, type MicrosoftAuthDependencies } from '../routes/entra-auth.routes.js'
import {
  requireExperience,
  requireExperienceOrLegacyJwt,
} from '../middlewares/experience.middleware.js'
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
  app.get('/test/experience/normal', requireExperience('normal'), (_req, res) => {
    res.json({ experience: 'normal' })
  })
  app.get('/test/experience/secondary', requireExperience('secondary'), (_req, res) => {
    res.json({ experience: 'secondary' })
  })
  app.get('/test/legacy-jwt', requireExperienceOrLegacyJwt('normal'), (_req, res) => {
    res.json({ legacy: true })
  })
  app.get('/test/guarded-normal', requireExperienceOrLegacyJwt('normal'), (_req, res) => {
    res.json({ experience: 'normal' })
  })
  app.get('/test/scope', (req, res) => {
    res.json({ allowedHostGroups: req.session.allowedHostGroups ?? null })
  })
  app.post('/test/clear-experience', (req, res, next) => {
    delete req.session.experience
    req.session.save((error) => {
      if (error) return next(error)
      return res.json({ ok: true })
    })
  })
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
  const { cookie, state } = await beginLogin(api)
  const callbackResponse = await fetch(
    `${api.baseUrl}/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie }, redirect: 'manual' },
  )
  assert.equal(callbackResponse.status, 302)
  assert.equal(callbackResponse.headers.get('location'), 'http://localhost:5173/dashboard')
  return sessionCookie(callbackResponse)
}

async function beginLogin(api: Awaited<ReturnType<typeof startApi>>) {
  const loginResponse = await fetch(`${api.baseUrl}/auth/login`, { redirect: 'manual' })
  assert.equal(loginResponse.status, 302)
  const cookie = sessionCookie(loginResponse)
  const state = new URL(loginResponse.headers.get('location')!).searchParams.get('state')
  assert.ok(state)

  return { cookie, state }
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
      experience: 'secondary',
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

test('callback classifica as variantes autorizadas e redireciona somente para caminhos fixos', async () => {
  for (const companyName of ['datacore', 'Datacore', ' datacore ']) {
    const api = await startApi({
      getGraphProfile: async () => ({ companyName }),
    })
    try {
      await login(api)
    } finally {
      await api.close()
    }
  }

  const api = await startApi({
    getGraphProfile: async () => ({ companyName: 'datacore' }),
  })
  try {
    const loginResponse = await fetch(
      `${api.baseUrl}/auth/login?returnUrl=https%3A%2F%2Fevil.example`,
      { redirect: 'manual' },
    )
    const loginCookie = sessionCookie(loginResponse)
    const state = new URL(loginResponse.headers.get('location')!).searchParams.get('state')
    assert.ok(state)
    const callbackResponse = await fetch(
      `${api.baseUrl}/auth/callback?code=mock-code&state=${encodeURIComponent(state)}&returnUrl=https%3A%2F%2Fevil.example`,
      { headers: { cookie: loginCookie }, redirect: 'manual' },
    )
    assert.equal(callbackResponse.status, 302)
    assert.equal(callbackResponse.headers.get('location'), 'http://localhost:5173/dashboard')
  } finally {
    await api.close()
  }
})

test('company ausente, vazio ou não permitido sempre recebe experiência secondary', async () => {
  const profiles: Array<{ label: string; profile: Record<string, unknown> }> = [
    { label: 'outra empresa', profile: { companyName: 'Outra empresa' } },
    { label: 'vazio', profile: { companyName: '' } },
    { label: 'nulo', profile: { companyName: null } },
    { label: 'ausente', profile: {} },
    { label: 'match parcial com sufixo', profile: { companyName: 'datacore fake' } },
    { label: 'match parcial com prefixo', profile: { companyName: 'mydatacore' } },
  ]

  for (const { label, profile } of profiles) {
    const api = await startApi({ getGraphProfile: async () => profile })
    try {
      const cookie = await login(api)
      const response = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
      assert.equal(response.status, 200, label)
      assert.equal((await response.json()).experience, 'secondary', label)

      const normalApi = await fetch(`${api.baseUrl}/test/guarded-normal`, {
        headers: { cookie },
      })

      test('callback grava apenas o escopo da empresa quando a experiência é secondary', async () => {
        const mappedCompanies = [
          ['SPS Gestão', ['SPS_MATRIZ', 'SPS_INNO']],
          ['sps gestao', ['SPS_MATRIZ', 'SPS_INNO']],
          [' SPS  Gestão ', ['SPS_MATRIZ', 'SPS_INNO']],
          ['SPS Minas', ['SPS_BH']],
          ['SPS CWB', ['SPS_CURITIBA']],
          ['SPS RJ', ['SPS_RJ']],
        ] as const

        for (const [companyName, expectedGroups] of mappedCompanies) {
          const api = await startApi({ getGraphProfile: async () => ({ companyName }) })
          try {
            const cookie = await login(api)
            const response = await fetch(`${api.baseUrl}/test/scope`, { headers: { cookie } })
            assert.deepEqual((await response.json()).allowedHostGroups, expectedGroups)
          } finally {
            await api.close()
          }
        }

        for (const companyName of ['', null, 'Outra Empresa', 'SPS Gestão X']) {
          const api = await startApi({ getGraphProfile: async () => ({ companyName }) })
          try {
            const cookie = await login(api)
            const response = await fetch(`${api.baseUrl}/test/scope`, { headers: { cookie } })
            assert.deepEqual((await response.json()).allowedHostGroups, [])
          } finally {
            await api.close()
          }
        }

        const normalApi = await startApi({ getGraphProfile: async () => ({ companyName: 'Cloud Core' }) })
        try {
          const cookie = await login(normalApi)
          const response = await fetch(`${normalApi.baseUrl}/test/scope`, { headers: { cookie } })
          assert.equal((await response.json()).allowedHostGroups, null)
        } finally {
          await normalApi.close()
        }
      })
      assert.equal(normalApi.status, 403, label)
    } finally {
      await api.close()
    }
  }
})

test('falha no Graph não autentica a sessão nem concede experiência normal', async () => {
  const api = await startApi({
    getGraphProfile: async () => {
      throw new GraphServiceError('detalhe privado do Graph', 403)
    },
  })
  try {
    const { cookie, state } = await beginLogin(api)
    const callbackResponse = await fetch(
      `${api.baseUrl}/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: 'manual' },
    )
    assert.equal(callbackResponse.status, 502)
    assert.deepEqual(await callbackResponse.json(), {
      error: 'Não foi possível determinar a experiência do usuário no Microsoft Graph',
    })

    const me = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal(me.status, 401)
    assert.deepEqual(await me.json(), { needsLogin: true })
  } finally {
    await api.close()
  }
})

test('falha ao obter token não autentica a sessão', async () => {
  const api = await startApi({
    acquireTokenByCode: async () => {
      throw new Error('erro MSAL confidencial')
    },
  })
  try {
    const { cookie, state } = await beginLogin(api)
    const callbackResponse = await fetch(
      `${api.baseUrl}/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie }, redirect: 'manual' },
    )
    assert.equal(callbackResponse.status, 502)
    assert.deepEqual(await callbackResponse.json(), {
      error: 'Não foi possível obter token para consultar o perfil no Microsoft Graph',
    })

    const me = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal(me.status, 401)
  } finally {
    await api.close()
  }
})

test('middleware exige sessão, nega experiência oposta e permite a experiência correspondente', async () => {
  const api = await startApi()
  try {
    const noSession = await fetch(`${api.baseUrl}/test/experience/normal`)
    assert.equal(noSession.status, 401)

    const secondaryCookie = await login(api)
    const deniedNormal = await fetch(`${api.baseUrl}/test/experience/normal`, {
      headers: { cookie: secondaryCookie },
    })
    assert.equal(deniedNormal.status, 403)
    const deniedNormalRoute = await fetch(`${api.baseUrl}/test/guarded-normal`, {
      headers: { cookie: secondaryCookie },
    })
    assert.equal(deniedNormalRoute.status, 403)
    const allowedSecondary = await fetch(`${api.baseUrl}/test/experience/secondary`, {
      headers: { cookie: secondaryCookie },
    })
    assert.equal(allowedSecondary.status, 200)

    const normalApi = await startApi({
      getGraphProfile: async () => ({ companyName: 'Cloud Core' }),
    })
    try {
      const normalCookie = await login(normalApi)
      const allowedNormal = await fetch(`${normalApi.baseUrl}/test/experience/normal`, {
        headers: { cookie: normalCookie },
      })
      assert.equal(allowedNormal.status, 200)
      const deniedSecondary = await fetch(`${normalApi.baseUrl}/test/experience/secondary`, {
        headers: { cookie: normalCookie },
      })
      assert.equal(deniedSecondary.status, 403)
    } finally {
      await normalApi.close()
    }
  } finally {
    await api.close()
  }
})

test('JWT legado válido mantém acesso sem sessão Entra', async () => {
  const secret = process.env.SECRET_KEY ?? process.env.APIKEY
  assert.ok(secret)
  const token = jwt.sign({ origem: 'portal' }, secret, { algorithm: 'HS256' })
  const api = await startApi()
  try {
    const response = await fetch(`${api.baseUrl}/test/legacy-jwt`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { legacy: true })
  } finally {
    await api.close()
  }
})

test('/auth/me usa a decisão persistida e retorna secondary quando a sessão não tem classificação', async () => {
  let graphCompanyName = 'Cloud Core'
  const api = await startApi({
    getGraphProfile: async () => ({ companyName: graphCompanyName }),
  })
  try {
    const cookie = await login(api)
    graphCompanyName = 'Outra empresa'
    const current = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal((await current.json()).experience, 'normal')

    const clear = await fetch(`${api.baseUrl}/test/clear-experience`, {
      method: 'POST',
      headers: { cookie },
    })
    assert.equal(clear.status, 200)
    const missingExperience = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie } })
    assert.equal((await missingExperience.json()).experience, 'secondary')
  } finally {
    await api.close()
  }
})

test('logout seguido por login de outra empresa não reaproveita a decisão anterior', async () => {
  let graphCompanyName = 'datacore'
  const api = await startApi({
    getGraphProfile: async () => ({ companyName: graphCompanyName }),
  })
  try {
    const firstCookie = await login(api)
    const logout = await fetch(`${api.baseUrl}/auth/logout`, {
      headers: { cookie: firstCookie },
      redirect: 'manual',
    })
    assert.equal(logout.status, 302)

    graphCompanyName = 'Outra empresa'
    const secondCookie = await login(api)
    assert.notEqual(secondCookie, firstCookie)
    const response = await fetch(`${api.baseUrl}/auth/me`, { headers: { cookie: secondCookie } })
    assert.equal((await response.json()).experience, 'secondary')
  } finally {
    await api.close()
  }
})
