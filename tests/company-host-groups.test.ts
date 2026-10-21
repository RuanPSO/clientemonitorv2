import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'
import jwt from 'jsonwebtoken'
import {
  companyHostGroups,
  loadCompanyHostGroups,
  normalizeScopeCompanyName,
  resolveCompanyHostGroups,
  validateCompanyHostGroups,
} from '../config/company-host-groups.js'
import hostRoutes from '../routes/host.routes.js'
import groupRoutes from '../routes/grupo.routes.js'
import { ZabbixService } from '../services/zabbix.service.js'

const account: AccountInfo = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  username: 'user@example.com',
  localAccountId: 'local-id',
}

test('resolve escopo com normalização exata e falha fechada', () => {
  for (const name of ['SPS Gestão', 'sps gestao', ' SPS  Gestão ']) {
    assert.deepEqual(resolveCompanyHostGroups(name).allowedHostGroups, ['SPS_MATRIZ', 'SPS_INNO'])
  }
  assert.deepEqual(resolveCompanyHostGroups('SPS Minas').allowedHostGroups, ['SPS_BH'])
  assert.deepEqual(resolveCompanyHostGroups('SPS BH').allowedHostGroups, ['SPS_BH'])
  assert.deepEqual(resolveCompanyHostGroups('SPS CWB').allowedHostGroups, ['SPS_CURITIBA'])
  assert.deepEqual(resolveCompanyHostGroups('SPS RJ').allowedHostGroups, ['SPS_RJ'])

  for (const name of ['', null, undefined, 'Outra Empresa', 'SPS', 'SPS Gestão X']) {
    assert.deepEqual(resolveCompanyHostGroups(name).allowedHostGroups, [])
  }
  assert.ok(companyHostGroups.companies.every((entry) => !entry.groups.includes('SPS_BOLIVIA')))
  assert.equal(normalizeScopeCompanyName('  SPS  Gestão '), 'sps gestao')
})

test('valida arquivo obrigatório e rejeita estrutura inválida e nomes duplicados normalizados', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'company-host-groups-'))
  const filePath = path.join(directory, 'mapping.json')
  try {
    assert.throws(() => loadCompanyHostGroups(path.join(directory, 'missing.json')), /Não foi possível carregar/)
    writeFileSync(filePath, '{')
    assert.throws(() => loadCompanyHostGroups(filePath), /JSON inválido/)
    assert.throws(() => validateCompanyHostGroups({ companies: 'invalid' }), /companies.*array/)
    assert.throws(
      () => validateCompanyHostGroups({
        companies: [
          { companyname: 'SPS Gestão', groups: ['SPS_MATRIZ'] },
          { companyname: ' sps gestao ', groups: ['SPS_INNO'] },
        ],
      }),
      /duplicado após normalização/,
    )
    assert.throws(
      () => validateCompanyHostGroups({ companies: [{ companyname: 'SPS RJ', groups: [' '] }] }),
      /groups deve conter textos não vazios/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function startApi() {
  const groups = [
    { groupid: '11', name: 'SPS_RJ' },
    { groupid: '12', name: ' SPS_RJ/Servidores ' },
    { groupid: '13', name: 'SPS_RJX' },
    { groupid: '14', name: 'SPS_BH' },
    { groupid: '15', name: 'SPS_BOLIVIA' },
    { groupid: '16', name: 'SPS_MATRIZ' },
  ]
  const originals = {
    listarGrupos: ZabbixService.listarGrupos,
    listarHostsComIp: ZabbixService.listarHostsComIp,
    listarHostsComIpPorGrupos: ZabbixService.listarHostsComIpPorGrupos,
    getHostsPorChave: ZabbixService.getHostsPorChave,
  }
  const scopedGroupIds: string[][] = []
  let unfilteredHostListCalls = 0
  let groupHostCalls = 0
  ZabbixService.listarGrupos = async () => groups
  ZabbixService.listarHostsComIp = async () => {
    unfilteredHostListCalls += 1
    return [{ hostid: 'normal-host', host: 'normal', ip: '192.0.2.1' }]
  }
  ZabbixService.listarHostsComIpPorGrupos = async (ids) => {
    scopedGroupIds.push(ids)
    return [{ hostid: 'scoped-host', host: 'scoped', ip: '192.0.2.2' }]
  }
  ZabbixService.getHostsPorChave = async (chave) => {
    groupHostCalls += 1
    return { tipo: 'nome', chave, hosts: [{ hostid: '1', hostname: 'host' }] }
  }

  const app = express()
  app.use(session({
    name: 'clientemonitor.sid',
    secret: 'test-session-secret-with-more-than-thirty-two-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }))
  app.post('/test/session/:experience/:scope', (req, res, next) => {
    Object.assign(req.session, { account, experience: req.params.experience })
    if (req.params.experience === 'secondary') {
      Object.assign(req.session, {
        allowedHostGroups: req.params.scope === 'rj' ? ['SPS_RJ'] : [],
      })
    }
    req.session.save((error) => {
      if (error) return next(error)
      return res.json({ ok: true })
    })
  })
  app.use(hostRoutes)
  app.use(groupRoutes)

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  const secret = process.env.SECRET_KEY ?? process.env.APIKEY
  assert.ok(secret)
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authorization: `Bearer ${jwt.sign({ origem: 'portal' }, secret, { algorithm: 'HS256' })}`,
    groups,
    scopedGroupIds,
    get unfilteredHostListCalls() { return unfilteredHostListCalls },
    get groupHostCalls() { return groupHostCalls },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
      ZabbixService.listarGrupos = originals.listarGrupos
      ZabbixService.listarHostsComIp = originals.listarHostsComIp
      ZabbixService.listarHostsComIpPorGrupos = originals.listarHostsComIpPorGrupos
      ZabbixService.getHostsPorChave = originals.getHostsPorChave
    },
  }
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}

async function createSession(
  api: Awaited<ReturnType<typeof startApi>>,
  experience: 'normal' | 'secondary',
  scope: 'rj' | 'empty',
): Promise<string> {
  return cookieFrom(await fetch(`${api.baseUrl}/test/session/${experience}/${scope}`, { method: 'POST' }))
}

test('secondary só consulta grupos e hosts do escopo; normal preserva respostas sem filtro', async () => {
  const api = await startApi()
  try {
    const secondaryCookie = await createSession(api, 'secondary', 'rj')
    const hostsResponse = await fetch(`${api.baseUrl}/hosts/com-ip`, {
      headers: { cookie: secondaryCookie, authorization: api.authorization },
    })
    assert.deepEqual(await hostsResponse.json(), [
      { hostid: 'scoped-host', host: 'scoped', ip: '192.0.2.2' },
    ])
    assert.deepEqual(api.scopedGroupIds[0], ['11', '12'])

    const groupsResponse = await fetch(`${api.baseUrl}/grupos`, {
      headers: { cookie: secondaryCookie, authorization: api.authorization },
    })
    assert.deepEqual(await groupsResponse.json(), [
      api.groups[0],
      { ...api.groups[1], name: api.groups[1]!.name.trim() },
    ])

    const deniedGroup = await fetch(`${api.baseUrl}/grupo/SPS_BH`, {
      headers: { cookie: secondaryCookie, authorization: api.authorization },
    })
    assert.equal(deniedGroup.status, 403)
    assert.equal(api.groupHostCalls, 0)
    const allowedGroup = await fetch(`${api.baseUrl}/grupo/SPS_RJ`, {
      headers: { cookie: secondaryCookie, authorization: api.authorization },
    })
    assert.equal(allowedGroup.status, 200)
    assert.equal(api.groupHostCalls, 1)

    const emptyCookie = await createSession(api, 'secondary', 'empty')
    assert.deepEqual(await (await fetch(`${api.baseUrl}/hosts/com-ip`, {
      headers: { cookie: emptyCookie, authorization: api.authorization },
    })).json(), [])
    assert.deepEqual(await (await fetch(`${api.baseUrl}/grupos`, {
      headers: { cookie: emptyCookie, authorization: api.authorization },
    })).json(), [])
    assert.equal(api.scopedGroupIds.length, 1)

    const normalCookie = await createSession(api, 'normal', 'empty')
    assert.deepEqual(await (await fetch(`${api.baseUrl}/hosts/com-ip`, {
      headers: { cookie: normalCookie, authorization: api.authorization },
    })).json(), [{ hostid: 'normal-host', host: 'normal', ip: '192.0.2.1' }])
    assert.deepEqual(await (await fetch(`${api.baseUrl}/grupos`, {
      headers: { cookie: normalCookie, authorization: api.authorization },
    })).json(), api.groups)
    assert.equal(api.unfilteredHostListCalls, 1)
  } finally {
    await api.close()
  }
})
