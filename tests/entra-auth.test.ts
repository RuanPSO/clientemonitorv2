import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Session } from 'express-session'
import type { Request } from 'express'
import type { TokenCacheContext } from '@azure/msal-node'
import { createSessionCachePlugin, getAuthUrl, SCOPES } from '../config/msal.js'
import { normalizeUserProfile } from '../mappers/userMapper.js'
import { getClientIp } from '../utils/clientIp.js'

test('getAuthUrl solicita seleção de conta, scopes e callback Web', async () => {
  process.env.AZURE_CLIENT_ID = 'test-client-id'
  process.env.AZURE_CLIENT_SECRET = 'test-client-secret'
  process.env.AZURE_TENANT_ID = 'test-tenant-id'
  process.env.AZURE_REDIRECT_URI = 'http://localhost:3000/auth/callback'
  const fakeSession = {} as Session

  const authUrl = new URL(await getAuthUrl(fakeSession, 'state-test'))

  assert.equal(authUrl.searchParams.get('prompt'), 'select_account')
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/callback')
  assert.equal(authUrl.searchParams.get('state'), 'state-test')
  const scopes = authUrl.searchParams.get('scope')?.split(' ') ?? []
  assert.deepEqual(scopes.slice(0, SCOPES.length), SCOPES)
})

test('cache MSAL restaura dados por sessão e salva quando alterado', async () => {
  const sessionState = { msalCache: 'cache-anterior', save: (callback: (error?: Error) => void) => callback() }
  const session = sessionState as unknown as Session
  const plugin = createSessionCachePlugin(session)
  let restored: string | undefined
  const tokenCache = {
    deserialize: async (cache: string) => { restored = cache },
    serialize: () => 'cache-atualizado',
  }
  await plugin.beforeCacheAccess({ tokenCache } as unknown as TokenCacheContext)
  await plugin.afterCacheAccess({
    tokenCache,
    hasChanged: true,
  } as unknown as TokenCacheContext)

  assert.equal(restored, 'cache-anterior')
  assert.equal(sessionState.msalCache, 'cache-atualizado')
})

test('normaliza perfil com fallback de email e strings vazias', () => {
  const raw = { userPrincipalName: 'pessoa@example.com', tid: 'tenant-from-graph' }
  const user = normalizeUserProfile(raw, 'tenant-from-account')

  assert.equal(user.email, 'pessoa@example.com')
  assert.equal(user.tenantId, 'tenant-from-graph')
  assert.equal(user.companyName, '')
  assert.equal(user.businessPhones, '')
  assert.equal(user.raw, raw)
})

test('resolve o primeiro IP válido e remove IPv4-mapped IPv6', () => {
  const req = {
    get: (name: string) => name === 'x-forwarded-for'
      ? 'invalid, ::ffff:192.0.2.4'
      : name === 'x-real-ip' ? '198.51.100.3' : undefined,
    socket: { remoteAddress: '203.0.113.10' },
    ip: '203.0.113.11',
  } as unknown as Request

  assert.equal(getClientIp(req), '192.0.2.4')
})
