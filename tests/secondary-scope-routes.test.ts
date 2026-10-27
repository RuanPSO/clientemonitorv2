import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'
import jwt from 'jsonwebtoken'
import groupRoutes from '../routes/grupo.routes.js'
import hostRoutes from '../routes/host.routes.js'
import { ZabbixService } from '../services/zabbix.service.js'
import { resolveCompanyHostGroups } from '../config/company-host-groups.js'
import type { HostsFullResponse } from '../services/zabbix.service.js'

const account: AccountInfo = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  username: 'user@example.com',
  localAccountId: 'local-id',
}

const groups = [
  { groupid: '14', name: 'SPS_BH' },
  { groupid: '16', name: ' SPS_BH/Servidores ' },
  { groupid: '20', name: 'SPS_RJ' },
  { groupid: '21', name: 'SPS_BOLIVIA' },
  { groupid: '22', name: 'SPS_BHX' },
]

const fullStatuses: Awaited<ReturnType<typeof ZabbixService.getStatusPingUptimeAll>> = [
  {
    hostid: '101',
    status: 'UP',
    host_status: 'ENABLED',
    icmp_ping: 1,
    agent_ping: 1,
    ping_available: true,
    ping_source: 'icmpping',
    latency_ms: 1,
    uptime_seconds: 86400,
    uptime_days: 1,
    uptime_available: true,
  },
  {
    hostid: '202',
    status: 'DOWN',
    host_status: 'ENABLED',
    icmp_ping: 0,
    agent_ping: 0,
    ping_available: true,
    ping_source: 'icmpping',
    latency_ms: null,
    uptime_seconds: null,
    uptime_days: null,
    uptime_available: false,
  },
  {
    hostid: '303',
    status: 'UNKNOWN',
    host_status: 'ENABLED',
    icmp_ping: null,
    agent_ping: null,
    ping_available: false,
    ping_source: null,
    latency_ms: null,
    uptime_seconds: null,
    uptime_days: null,
    uptime_available: false,
  },
]

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}

test('secondary recebe somente dados de grupos e hosts autorizados; normal mantém payloads atuais', async () => {
  const originals = {
    listarGrupos: ZabbixService.listarGrupos,
    listarGruposComHosts: ZabbixService.listarGruposComHosts,
    listarGruposComHostsPorGrupos: ZabbixService.listarGruposComHostsPorGrupos,
    getHostsPorChave: ZabbixService.getHostsPorChave,
    getHostsFullDoGrupo: ZabbixService.getHostsFullDoGrupo,
    listarHostsIdsPorGrupos: ZabbixService.listarHostsIdsPorGrupos,
    getStatusPingUptimeAll: ZabbixService.getStatusPingUptimeAll,
    hostBelongsToGroups: ZabbixService.hostBelongsToGroups,
    getHostMetricsPayload: ZabbixService.getHostMetricsPayload,
    getHostBasico: ZabbixService.getHostBasico,
    getHostServices: ZabbixService.getHostServices,
    getActiveServices: ZabbixService.getActiveServices,
    getHostComIp: ZabbixService.getHostComIp,
  }
  const groupHostCalls: string[] = []
  const scopedGroupCalls: string[][] = []
  const scopedHostIdCalls: string[][] = []
  const hostMembershipCalls: string[] = []
  const detailCalls: string[] = []
  let normalAggregateCalls = 0
  let unfilteredStatusCalls = 0
  let guacamoleCalls = 0

  ZabbixService.listarGrupos = async () => groups
  ZabbixService.listarGruposComHosts = async () => {
    normalAggregateCalls += 1
    return [
      { groupid: '20', grupo: 'SPS_RJ', hosts: [{ hostid: '202', hostname: 'outside' }] },
      { groupid: '14', grupo: 'SPS_BH', hosts: [{ hostid: '101', hostname: 'server-bh' }] },
    ]
  }
  ZabbixService.listarGruposComHostsPorGrupos = async (selectedGroups) => {
    scopedGroupCalls.push(selectedGroups.map((group) => group.groupid))
    return selectedGroups.map((group) => ({
      groupid: group.groupid,
      grupo: group.name,
      hosts: [{
        hostid: group.groupid === '14' ? '101' : '102',
        hostname: group.groupid === '14' ? 'server-bh' : 'server-bh-child',
      }],
    }))
  }
  ZabbixService.getHostsPorChave = async (chave) => {
    groupHostCalls.push(chave)
    return { tipo: 'nome', chave, hosts: [{ hostid: '101', hostname: 'server-bh' }] }
  }
  ZabbixService.getHostsFullDoGrupo = async (chave) => {
    groupHostCalls.push(`full:${chave}`)
    const response: HostsFullResponse = {
      grupo: chave,
      tipo: 'nome',
      total: 1,
      hosts: [{
        hostid: '101',
        hostname: 'server-bh',
        details: {
          hostid: '101',
          status: 'UP',
          cpu: null,
          os: null,
          memoria: null,
          discos: [],
          uptime_fmt: '',
          services: [],
          classificacao: { categoria: 'server', icone: 'server', titulo: 'Server' },
        },
      }],
    }
    return response
  }
  ZabbixService.listarHostsIdsPorGrupos = async (groupids) => {
    scopedHostIdCalls.push(groupids)
    return ['101', '102']
  }
  ZabbixService.getStatusPingUptimeAll = async () => {
    unfilteredStatusCalls += 1
    return fullStatuses
  }
  ZabbixService.hostBelongsToGroups = async (hostid, groupids) => {
    hostMembershipCalls.push(hostid.toString())
    return ['101', '102'].includes(hostid.toString()) && groupids.includes('14')
  }
  ZabbixService.getHostMetricsPayload = async (hostid) => {
    detailCalls.push(`metrics:${hostid}`)
    return {
      hostid: hostid.toString(),
      nome: 'server-bh',
      ip: '192.0.2.10',
      porta_customizada: null,
      status: 'UP',
      host_status: 'ENABLED',
      icmp_ping: 1,
      agent_ping: 1,
      ping_available: true,
      ping_source: 'icmpping',
      latency_ms: 1,
      uptime_seconds: 86400,
      uptime_days: 1,
      cpu: null,
      memoria: null,
      discos: [],
      os: 'UNKNOWN',
      os_type: 'unknown',
      services: [],
    }
  }
  ZabbixService.getHostBasico = async (hostid) => {
    detailCalls.push(`basico:${hostid}`)
    return { hostid: hostid.toString(), host: 'server-bh', hostname: 'server-bh', status: 0 }
  }
  ZabbixService.getHostServices = async (hostid) => {
    detailCalls.push(`services:${hostid}`)
    return []
  }
  ZabbixService.getActiveServices = async (hostid) => {
    detailCalls.push(`active-services:${hostid}`)
    return []
  }
  ZabbixService.getHostComIp = async (hostid) => {
    detailCalls.push(`com-ip:${hostid}`)
    return { hostid: hostid.toString(), nome: 'server-bh', ip: '192.0.2.10', porta_customizada: null }
  }

  const app = express()
  app.use(express.json())
  app.use(session({
    name: 'clientemonitor.sid',
    secret: 'test-session-secret-with-more-than-thirty-two-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }))
  app.post('/test/session/:experience/:company', (req, res, next) => {
    Object.assign(req.session, { account, experience: req.params.experience })
    if (req.params.experience === 'secondary' && req.params.company !== 'missing-scope') {
      Object.assign(req.session, {
        allowedHostGroups: resolveCompanyHostGroups(req.params.company).allowedHostGroups,
      })
    }
    req.session.save((error) => {
      if (error) return next(error)
      return res.json({ ok: true })
    })
  })
  app.use(groupRoutes)
  app.use(hostRoutes)

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const secret = process.env.SECRET_KEY ?? process.env.APIKEY
  assert.ok(secret)
  const authorization = `Bearer ${jwt.sign({ origem: 'portal' }, secret, { algorithm: 'HS256' })}`

  const createSession = async (experience: 'normal' | 'secondary', company: string) => cookieFrom(
    await fetch(`${baseUrl}/test/session/${experience}/${encodeURIComponent(company)}`, { method: 'POST' }),
  )
  const get = (path: string, cookie: string) => fetch(`${baseUrl}${path}`, {
    headers: { cookie, authorization },
  })

  try {
    const secondaryCookie = await createSession('secondary', 'SPS BH')
    const aggregate = await get('/grupos/com-hosts', secondaryCookie)
    assert.equal(aggregate.status, 200)
    const aggregateBody = await aggregate.json()
    assert.deepEqual(aggregateBody.map((group: { grupo: string }) => group.grupo), [
      'SPS_BH',
      'SPS_BH/Servidores',
    ])
    assert.deepEqual(
      aggregateBody.flatMap((group: { hosts: Array<{ hostid: string }> }) =>
        group.hosts.map((host) => host.hostid)),
      ['101', '102'],
    )
    assert.deepEqual(scopedGroupCalls, [['14', '16']])
    assert.equal(JSON.stringify(aggregateBody).includes('SPS_BOLIVIA'), false)
    assert.equal(JSON.stringify(aggregateBody).includes('SPS_RJ'), false)

    const allowedFull = await get('/grupo/14/hosts-full', secondaryCookie)
    assert.equal(allowedFull.status, 200)
    assert.equal(groupHostCalls.includes('full:14'), true)
    const callsBeforeDeniedGroup = groupHostCalls.length
    const deniedFull = await get('/grupo/SPS_RJ/hosts-full', secondaryCookie)
    assert.equal(deniedFull.status, 403)
    assert.deepEqual(await deniedFull.json(), { erro: 'Grupo fora do escopo da empresa' })
    assert.equal(groupHostCalls.length, callsBeforeDeniedGroup)

    const statusResponse = await get('/hosts/status-ping-uptime', secondaryCookie)
    assert.equal(statusResponse.status, 200)
    assert.deepEqual((await statusResponse.json()).map((host: { hostid: string }) => host.hostid), ['101'])
    assert.deepEqual(scopedHostIdCalls, [['14', '16']])

    for (const path of [
      '/host/101/metrics',
      '/host/101/basico',
      '/host/101/services',
      '/host/101/active-services',
      '/host/101/com-ip',
    ]) {
      assert.equal((await get(path, secondaryCookie)).status, 200, path)
    }
    const detailCallsBeforeDeniedHost = detailCalls.length
    assert.equal((await get('/host/202/metrics', secondaryCookie)).status, 404)
    assert.equal(detailCalls.length, detailCallsBeforeDeniedHost)
    assert.ok(hostMembershipCalls.includes('101'))
    assert.ok(hostMembershipCalls.includes('202'))

    const emptyCookie = await createSession('secondary', 'Outra Empresa')
    assert.deepEqual(await (await get('/grupos/com-hosts', emptyCookie)).json(), [])
    assert.deepEqual(await (await get('/hosts/status-ping-uptime', emptyCookie)).json(), [])
    const emptyFull = await get('/grupo/SPS_BH/hosts-full', emptyCookie)
    assert.equal(emptyFull.status, 403)

    const missingScopeCookie = await createSession('secondary', 'missing-scope')
    assert.deepEqual(await (await get('/grupos/com-hosts', missingScopeCookie)).json(), [])
    assert.deepEqual(await (await get('/hosts/status-ping-uptime', missingScopeCookie)).json(), [])
    assert.equal((await get('/host/101/metrics', missingScopeCookie)).status, 404)

    const normalCookie = await createSession('normal', 'SPS Minas')
    const normalAggregate = await get('/grupos/com-hosts', normalCookie)
    assert.deepEqual(await normalAggregate.json(), [
      { groupid: '20', grupo: 'SPS_RJ', hosts: [{ hostid: '202', hostname: 'outside' }] },
      { groupid: '14', grupo: 'SPS_BH', hosts: [{ hostid: '101', hostname: 'server-bh' }] },
    ])
    const normalStatuses = await get('/hosts/status-ping-uptime', normalCookie)
    assert.deepEqual(await normalStatuses.json(), fullStatuses)
    assert.equal(normalAggregateCalls, 1)
    assert.equal(unfilteredStatusCalls, 2)
    assert.equal(hostMembershipCalls.filter((hostid) => hostid === '101').length, 5)

    const membershipCallsBeforeNormalDetails = hostMembershipCalls.length
    for (const path of [
      '/host/101/metrics',
      '/host/101/basico',
      '/host/101/services',
      '/host/101/active-services',
      '/host/101/com-ip',
    ]) {
      assert.equal((await get(path, normalCookie)).status, 200, path)
    }
    assert.equal(hostMembershipCalls.length, membershipCallsBeforeNormalDetails)
    assert.deepEqual(await (await get('/grupo/SPS_RJ/hosts-full', normalCookie)).json(), {
      grupo: 'SPS_RJ',
      tipo: 'nome',
      total: 1,
      hosts: [{
        hostid: '101',
        hostname: 'server-bh',
        details: {
          hostid: '101',
          status: 'UP',
          cpu: null,
          os: null,
          memoria: null,
          discos: [],
          uptime_fmt: '',
          services: [],
          classificacao: { categoria: 'server', icone: 'server', titulo: 'Server' },
        },
      }],
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    ZabbixService.listarGrupos = originals.listarGrupos
    ZabbixService.listarGruposComHosts = originals.listarGruposComHosts
    ZabbixService.listarGruposComHostsPorGrupos = originals.listarGruposComHostsPorGrupos
    ZabbixService.getHostsPorChave = originals.getHostsPorChave
    ZabbixService.getHostsFullDoGrupo = originals.getHostsFullDoGrupo
    ZabbixService.listarHostsIdsPorGrupos = originals.listarHostsIdsPorGrupos
    ZabbixService.getStatusPingUptimeAll = originals.getStatusPingUptimeAll
    ZabbixService.hostBelongsToGroups = originals.hostBelongsToGroups
    ZabbixService.getHostMetricsPayload = originals.getHostMetricsPayload
    ZabbixService.getHostBasico = originals.getHostBasico
    ZabbixService.getHostServices = originals.getHostServices
    ZabbixService.getActiveServices = originals.getActiveServices
    ZabbixService.getHostComIp = originals.getHostComIp
  }
})
