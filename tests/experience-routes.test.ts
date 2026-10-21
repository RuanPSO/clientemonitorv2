import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import session from 'express-session'
import type { AccountInfo } from '@azure/msal-node'
import jwt from 'jsonwebtoken'
import hostRoutes from '../routes/host.routes.js'
import groupRoutes from '../routes/grupo.routes.js'
import incidentRoutes from '../routes/incidentes.routes.js'
import { IncidentesService } from '../services/incidentes.service.js'
import { ZabbixService } from '../services/zabbix.service.js'

const account: AccountInfo = {
  homeAccountId: 'home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  username: 'user@example.com',
  localAccountId: 'local-id',
}

const allowedRoutes = [
  '/hosts/com-ip',
  '/hosts/status-ping-uptime',
  '/grupos',
  '/grupos/com-hosts',
  '/grupo/team-a',
  '/grupo/team-a/hosts-full',
]

const normalOnlyRoutes = [
  '/hosts/com-ip-e-so',
  '/host/123/problemas',
  '/incidentes/ativos',
  '/incidentes/hosts-totais',
  '/incidentes/problemas-24h',
  '/incidentes/dashboard',
]

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'esperava Set-Cookie na resposta')
  return cookie
}

test('política das rotas de hosts e grupos por experiência', async () => {
  const originals = {
    listarHostsComIp: ZabbixService.listarHostsComIp,
    listarHostsComIpPorGrupos: ZabbixService.listarHostsComIpPorGrupos,
    listarHostsComIpESo: ZabbixService.listarHostsComIpESo,
    getStatusPingUptimeAll: ZabbixService.getStatusPingUptimeAll,
    getProblemasHost: ZabbixService.getProblemasHost,
    listarGrupos: ZabbixService.listarGrupos,
    getHostsPorChave: ZabbixService.getHostsPorChave,
    getHostsFullDoGrupo: ZabbixService.getHostsFullDoGrupo,
    listarGruposComHosts: ZabbixService.listarGruposComHosts,
    listarGruposComHostsPorGrupos: ZabbixService.listarGruposComHostsPorGrupos,
    listarHostsIdsPorGrupos: ZabbixService.listarHostsIdsPorGrupos,
    getIncidentesAtivosDoDia: IncidentesService.getIncidentesAtivosDoDia,
    getHostsTotais: IncidentesService.getHostsTotais,
    getProblemas24h: IncidentesService.getProblemas24h,
  }

  ZabbixService.listarHostsComIp = async () => []
  ZabbixService.listarHostsComIpPorGrupos = async () => []
  ZabbixService.listarHostsComIpESo = async () => []
  ZabbixService.getStatusPingUptimeAll = async () => []
  ZabbixService.getProblemasHost = async () => []
  ZabbixService.listarGrupos = async () => []
  ZabbixService.getHostsPorChave = async (chave) => ({ tipo: 'nome', chave, hosts: [] })
  ZabbixService.getHostsFullDoGrupo = async (chave) => ({
    grupo: chave,
    tipo: 'nome',
    total: 0,
    hosts: [],
  })
  ZabbixService.listarGruposComHosts = async () => []
  ZabbixService.listarGruposComHostsPorGrupos = async () => []
  IncidentesService.getIncidentesAtivosDoDia = async () => []
  IncidentesService.getHostsTotais = async () => ({
    online: 0,
    offline: 0,
    sem_acesso: 0,
    manutencao: 0,
  })
  IncidentesService.getProblemas24h = async () => []

  const app = express()
  app.use(session({
    name: 'clientemonitor.sid',
    secret: 'test-session-secret-with-more-than-thirty-two-characters',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }))
  app.post('/test/session/:experience', (req, res, next) => {
    Object.assign(req.session, { account })
    if (req.params.experience !== 'missing') {
      Object.assign(req.session, { experience: req.params.experience })
    }
    if (req.params.experience === 'secondary') {
      Object.assign(req.session, { allowedHostGroups: ['team-a'] })
    }
    req.session.save((error) => {
      if (error) return next(error)
      return res.json({ ok: true })
    })
  })
  app.use(hostRoutes)
  app.use(groupRoutes)
  app.use(incidentRoutes)

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const secret = process.env.SECRET_KEY ?? process.env.APIKEY
  assert.ok(secret)
  const authorization = `Bearer ${jwt.sign({ origem: 'portal' }, secret, { algorithm: 'HS256' })}`

  try {
    const noSessionStatuses = await Promise.all(
      [...allowedRoutes, ...normalOnlyRoutes].map(async (path) => {
        const response = await fetch(`${baseUrl}${path}`)
        return response.status
      }),
    )
    assert.deepEqual(noSessionStatuses, Array(noSessionStatuses.length).fill(401))

    const missingClassification = await fetch(`${baseUrl}/test/session/missing`, { method: 'POST' })
    const missingClassificationCookie = cookieFrom(missingClassification)
    assert.equal(
      (await fetch(`${baseUrl}/grupos`, {
        headers: { cookie: missingClassificationCookie, authorization },
      })).status,
      401,
    )

    const invalidClassification = await fetch(`${baseUrl}/test/session/unexpected`, { method: 'POST' })
    const invalidClassificationCookie = cookieFrom(invalidClassification)
    assert.equal(
      (await fetch(`${baseUrl}/grupos`, {
        headers: { cookie: invalidClassificationCookie, authorization },
      })).status,
      403,
    )

    const secondarySession = await fetch(`${baseUrl}/test/session/secondary`, { method: 'POST' })
    const secondaryCookie = cookieFrom(secondarySession)
    const secondaryAllowedStatuses = await Promise.all(
      allowedRoutes.map(async (path) => (
        await fetch(`${baseUrl}${path}`, { headers: { cookie: secondaryCookie, authorization } })
      ).status),
    )
    assert.deepEqual(secondaryAllowedStatuses, Array(allowedRoutes.length).fill(200))

    const secondaryDeniedStatuses = await Promise.all(
      normalOnlyRoutes.map(async (path) => (
        await fetch(`${baseUrl}${path}`, { headers: { cookie: secondaryCookie, authorization } })
      ).status),
    )
    assert.deepEqual(secondaryDeniedStatuses, Array(normalOnlyRoutes.length).fill(403))

    const normalSession = await fetch(`${baseUrl}/test/session/normal`, { method: 'POST' })
    const normalCookie = cookieFrom(normalSession)
    const normalStatuses = await Promise.all(
      [...allowedRoutes, ...normalOnlyRoutes].map(async (path) => (
        await fetch(`${baseUrl}${path}`, { headers: { cookie: normalCookie, authorization } })
      ).status),
    )
    assert.deepEqual(normalStatuses, Array(normalStatuses.length).fill(200))
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    ZabbixService.listarHostsComIp = originals.listarHostsComIp
    ZabbixService.listarHostsComIpPorGrupos = originals.listarHostsComIpPorGrupos
    ZabbixService.listarHostsComIpESo = originals.listarHostsComIpESo
    ZabbixService.getStatusPingUptimeAll = originals.getStatusPingUptimeAll
    ZabbixService.getProblemasHost = originals.getProblemasHost
    ZabbixService.listarGrupos = originals.listarGrupos
    ZabbixService.getHostsPorChave = originals.getHostsPorChave
    ZabbixService.getHostsFullDoGrupo = originals.getHostsFullDoGrupo
    ZabbixService.listarGruposComHosts = originals.listarGruposComHosts
    ZabbixService.listarGruposComHostsPorGrupos = originals.listarGruposComHostsPorGrupos
    ZabbixService.listarHostsIdsPorGrupos = originals.listarHostsIdsPorGrupos
    IncidentesService.getIncidentesAtivosDoDia = originals.getIncidentesAtivosDoDia
    IncidentesService.getHostsTotais = originals.getHostsTotais
    IncidentesService.getProblemas24h = originals.getProblemas24h
  }
})
