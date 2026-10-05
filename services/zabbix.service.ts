// services/zabbix.service.ts
import { cached } from '../lib/cache.js'
import { prisma } from '../lib/prisma.js'

import { HostRepository, type HostResumo, type GrupoZabbix, type HostBasico } from '../repositories/host.repository.js'
import { MetricRepository } from '../repositories/metric.repository.js'
import { ServiceRepository, type HostService, type HostSlaSummary, type ServicesHistoryResult } from '../repositories/service.repository.js'
import { ReportRepository, type SeriePonto, type DiscoHistorico, type Disponibilidade } from '../repositories/report.repository.js'
import { TimelineRepository, type HostTimelineResult } from '../repositories/timeline.repository.js'
import { HostClassifier, type ClassificacaoHost } from './host-classifier.service.js'
import { obterSla, formatarTempo, categorizarServico, fmtUptime, type SlaStatus, type CategoriaServico } from '../utils/helpers.js'

// =============================================================
// TTLs
// =============================================================
const TTL = {
  GRUPOS:                5 * 60_000,
  HOSTS_DO_GRUPO:        60_000,
  HOST_DETAILS:          70_000,
  HOST_BASICO:           70_000,
  HOST_SERVICES:         70_000,
  HOST_PROBLEMAS:        30_000,
  HOST_RELATORIO:        60_000,
  HOST_SLA:              60_000,
  HOST_SERVICES_HISTORY: 60_000,
  HOST_TIMELINE:         60_000,
  HOSTS_COM_IP:          60_000,
  HOSTS_COM_IP_E_SO:     5 * 60_000,
  STATUS_ALL:            30_000,
  ACTIVE_SERVICES:       30_000,
  RELATORIO_PERIODO:     60_000,
  SERIE_POR_KEY:         60_000,
  HOST_COM_IP:           30_000,
  STATUS_PING_UPTIME:    70_000,
} as const

// =============================================================
// TIPOS PÚBLICOS
// =============================================================

export interface HostDetails {
  hostid: string
  status: 'UP' | 'DOWN'
  cpu: { used: number; free: number; total: number } | null
  os: { type: string; name: string } | null
  memoria: { percent: number; used_gb: number; total_gb: number; free_gb: number } | null
  discos: Array<{ mount: string; uso: number }>
  uptime_fmt: string
  services: HostService[]
  classificacao: ClassificacaoHost
}

export interface ColetaCompleta {
  total_hosts: number
  hosts: Array<{ hostid: string; hostname: string } & Omit<HostDetails, 'hostid'>>
  coletado_em: string
}

export interface ProblemaHost {
  eventid: string
  name: string
  severity: number
  data: string
}

export interface RelatorioHostInteligente {
  cpu: SeriePonto[]
  memoria: SeriePonto[]
  disponibilidade: Disponibilidade
  discos: DiscoHistorico[]
  services: Array<{
    name: string
    key: string
    availability: number
    unavailability: number
    uptime: string
    downtime: string
    period: string
    history: Array<{ data: string; value: number }>
    has_data: boolean
  }>
}

// =============================================================
// FACADE
// =============================================================
export class ZabbixService {

  // ───────────────────────────────────────────────────────────
  // GRUPOS E HOSTS
  // ───────────────────────────────────────────────────────────

  static async listarGrupos(): Promise<GrupoZabbix[]> {
    return cached(
      'grupos:all',
      () => HostRepository.listarGrupos(),
      TTL.GRUPOS,
    )
  }

  static async getHostsDoGrupo(groupid: bigint | number): Promise<HostResumo[]> {
    const id = groupid.toString()
    return cached(
      `grupo:${id}:hosts`,
      () => HostRepository.getHostsDoGrupo(groupid),
      TTL.HOSTS_DO_GRUPO,
    )
  }

  static async getHostsPorChave(chave: string): Promise<{
    tipo: 'id' | 'nome'
    chave: string
    hosts: HostResumo[]
  }> {
    return cached(
      `grupo:${chave}:hosts-por-chave`,
      () => HostRepository.getHostsPorChave(chave),
      TTL.HOSTS_DO_GRUPO,
    )
  }

  // ───────────────────────────────────────────────────────────
  // ✅ NOVO — GRUPOS COM HOSTS EM 2 QUERIES (era 1 + N)
  // Mesmo formato de resposta de /grupos/com-hosts atual.
  // ───────────────────────────────────────────────────────────
  static async listarGruposComHosts(): Promise<
    Array<{
      groupid: string
      grupo: string
      hosts: Array<{ hostid: string; hostname: string }>
    }>
  > {
    return cached(
      'grupos:com-hosts',
      async () => {
        const [grupos, hostsPorGrupo] = await Promise.all([
          ZabbixService.listarGrupos(),
          HostRepository.getHostsDeTodosGrupos(),
        ])
        return grupos.map((g) => ({
          groupid: g.groupid,
          grupo: g.name,
          hosts: (hostsPorGrupo.get(g.groupid) ?? []).map((h) => ({
            hostid: h.hostid,
            hostname: h.hostname,
          })),
        }))
      },
      TTL.HOSTS_DO_GRUPO,
    )
  }

  // ───────────────────────────────────────────────────────────
  // DETALHES DO HOST (com classificação)
  // ───────────────────────────────────────────────────────────

  static async getHostDetails(hostid: bigint | number): Promise<HostDetails> {
    const id = hostid.toString()
    return cached(
      `host:${id}:details`,
      () => ZabbixService._getHostDetailsUncached(hostid),
      TTL.HOST_DETAILS,
    )
  }

  private static async _getHostDetailsUncached(hostid: bigint | number): Promise<HostDetails> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const p = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const start = Date.now()
      try {
        const r = await fn()
        console.log(`[timing host=${hostIdBig}] ${label}: ${Date.now() - start}ms`)
        return r
      } catch (e) {
        console.log(`[timing host=${hostIdBig}] ${label} ERRO: ${(e as Error).message}`)
        throw e
      }
    }

    const [
      tipoInfo,
      osDetectado,
      status,
      cpu,
      memoria,
      discos,
      uptime,
      services,
      templates,
      gruposHost,
      interfaceType,
    ] = await Promise.all([
      p('detectarTipoHost', () => MetricRepository.detectarTipoHost(hostIdBig)),
      p('detectarSo', () => MetricRepository.detectarSo(hostIdBig)),
      p('getStatus', () => MetricRepository.getStatus(hostIdBig)),
      p('getCpu', () => MetricRepository.getCpu(hostIdBig)),
      p('getMemoria', () => MetricRepository.getMemoria(hostIdBig)),
      p('getDiscos', () => MetricRepository.getDiscos(hostIdBig)),
      p('getUptime', () => MetricRepository.getUptime(hostIdBig)),
      p('getCurrentServiceStatus', () => TimelineRepository.getCurrentServiceStatus(hostIdBig)),
      p('getTemplatesDoHost', () => HostRepository.getTemplatesDoHost(hostIdBig)),
      p('getGruposDoHost', () => HostRepository.getGruposDoHost(hostIdBig)),
      p('getInterfaceType', () => HostRepository.getInterfaceType(hostIdBig)),
    ])

    const osInfo = tipoInfo ?? osDetectado

    const classificacao = HostClassifier.classify({
      hostid: hostIdBig,
      osData: osInfo && osInfo.type !== 'network' ? osInfo : null,
      templates,
      services: services.map((s) => s.name),
      groups: gruposHost,
      interfaceType,
    })

    if (tipoInfo && tipoInfo.type === 'network') {
      return {
        hostid: hostIdBig.toString(),
        status,
        cpu: null,
        os: tipoInfo,
        memoria: null,
        discos: [],
        uptime_fmt: 'N/A',
        services: [],
        classificacao,
      }
    }

    return {
      hostid: hostIdBig.toString(),
      status,
      cpu,
      os: osInfo,
      memoria,
      discos: (discos ?? []).map((d) => ({ mount: d.mount, uso: d.uso })),
      uptime_fmt: uptime ?? 'N/A',
      services: services as unknown as HostService[],
      classificacao,
    }
  }

  // ───────────────────────────────────────────────────────────
  // ✅ NOVO — BATCH PRIVADO — reutilizado por getHostsFullDoGrupo
  // e por coletarDadosCompletos. 11 queries totais, independente de N.
  // ───────────────────────────────────────────────────────────
  private static async _montarHostsFullBatch(hosts: HostResumo[]): Promise<HostFull[]> {
    if (hosts.length === 0) return []

    const hostids = hosts.map((h) => BigInt(h.hostid))

    const [
      statusMap,
      cpuMap,
      memoriaMap,
      uptimeMap,
      osMap,
      discosMap,
      tipoMap,
      templatesMap,
      gruposMap,
      ifaceMap,
      servicesMap,
    ] = await Promise.all([
      MetricRepository.getStatusBatch(hostids),
      MetricRepository.getCpuBatch(hostids),
      MetricRepository.getMemoriaBatch(hostids),
      MetricRepository.getUptimeBatch(hostids),
      MetricRepository.getOsBatch(hostids),
      MetricRepository.getDiscosBatch(hostids),
      MetricRepository.getTipoHostBatch(hostids),
      HostRepository.getTemplatesBatch(hostids),
      HostRepository.getGruposBatch(hostids),
      HostRepository.getInterfaceTypeBatch(hostids),
      ServiceRepository.getServicesBatch(hostids),
    ])

    return hosts.map((h) => {
      const id = h.hostid
      const idBig = BigInt(id)

      const status = statusMap.get(id) ?? 'DOWN'
      const cpu = cpuMap.get(id) ?? null
      const memoria = memoriaMap.get(id) ?? null
      const uptimeSeg = uptimeMap.get(id) ?? null
      const os = osMap.get(id) ?? null
      const discos = discosMap.get(id) ?? []
      const tipo = tipoMap.get(id) ?? null
      const templates = templatesMap.get(id) ?? []
      const gruposHost = gruposMap.get(id) ?? []
      const interfaceType = ifaceMap.get(id) ?? null
      const services = servicesMap.get(id) ?? []

      const classificacao = HostClassifier.classify({
        hostid: idBig,
        osData: os && tipo !== 'network' ? os : null,
        templates,
        services: services.map((s) => s.name),
        groups: gruposHost,
        interfaceType,
      })

      const isNetwork = tipo === 'network'

      const details: HostDetails = isNetwork
        ? {
            hostid: id,
            status,
            cpu: null,
            os: { type: 'network', name: 'Link/VPN' },
            memoria: null,
            discos: [],
            uptime_fmt: 'N/A',
            services: [],
            classificacao,
          }
        : {
            hostid: id,
            status,
            cpu,
            os,
            memoria,
            discos,
            uptime_fmt: uptimeSeg !== null ? fmtUptime(uptimeSeg) : 'N/A',
            services: services as unknown as HostService[],
            classificacao,
          }

      return { hostid: id, hostname: h.hostname, details }
    })
  }

  // ───────────────────────────────────────────────────────────
  // COLETA COMPLETA (sem cache — pesado e raro)
  // ✅ Agora em BATCH — mesmo formato de saída.
  // ───────────────────────────────────────────────────────────
  static async coletarDadosCompletos(): Promise<ColetaCompleta> {
    const grupos = await ZabbixService.listarGrupos()
    const todos = new Map<string, HostResumo>()

    const hostsPorGrupo = await Promise.all(
      grupos.map((g) => HostRepository.getHostsDoGrupo(BigInt(g.groupid))),
    )
    for (const hosts of hostsPorGrupo) {
      for (const host of hosts) todos.set(host.hostid, host)
    }

    const hostsUnicos = Array.from(todos.values())
    const hostsFull = await ZabbixService._montarHostsFullBatch(hostsUnicos)

    // Achatamento mantendo o formato atual de ColetaCompleta
    const resultado = hostsFull.map(({ hostid, hostname, details }) => {
      const { hostid: _ignored, ...rest } = details
      return { hostid, hostname, ...rest }
    })

    return {
      total_hosts: resultado.length,
      hosts: resultado,
      coletado_em: new Date().toISOString(),
    }
  }

  // ───────────────────────────────────────────────────────────
  // PROBLEMAS DO HOST
  // ───────────────────────────────────────────────────────────

  static async getProblemasHost(hostid: bigint | number): Promise<ProblemaHost[]> {
    const id = hostid.toString()
    return cached(
      `host:${id}:problemas`,
      () => ZabbixService._getProblemasHostUncached(hostid),
      TTL.HOST_PROBLEMAS,
    )
  }

  private static async _getProblemasHostUncached(hostid: bigint | number): Promise<ProblemaHost[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ eventid: bigint; name: string; severity: number; data: Date }>
    >`
      SELECT
        p.eventid,
        p.name,
        p.severity,
        TO_TIMESTAMP(p.clock) AS data
      FROM problem p
      JOIN events e ON e.eventid = p.eventid
      JOIN triggers t ON t.triggerid = e.objectid
      JOIN functions f ON f.triggerid = t.triggerid
      JOIN items i ON i.itemid = f.itemid
      WHERE i.hostid = ${hostIdBig}
      ORDER BY p.clock DESC
      LIMIT 10
    `

    return rows.map((r) => ({
      eventid: r.eventid.toString(),
      name: r.name,
      severity: Number(r.severity),
      data: r.data instanceof Date ? r.data.toISOString() : String(r.data),
    }))
  }

  // ───────────────────────────────────────────────────────────
  // RELATÓRIO INTELIGENTE
  // ───────────────────────────────────────────────────────────

  static async getRelatorioHostInteligente(
    hostid: bigint | number,
    inicio: string,
    fim: string,
    agrupamento: string = '15min',
  ): Promise<RelatorioHostInteligente> {
    const id = hostid.toString()
    return cached(
      `host:${id}:relatorio:${inicio}:${fim}:${agrupamento}`,
      () => ZabbixService._getRelatorioHostInteligenteUncached(hostid, inicio, fim, agrupamento),
      TTL.HOST_RELATORIO,
    )
  }

  private static async _getRelatorioHostInteligenteUncached(
    hostid: bigint | number,
    inicio: string,
    fim: string,
    agrupamento: string,
  ): Promise<RelatorioHostInteligente> {
    const [cpu, memoria, disponibilidade, discos, services] = await Promise.all([
      ReportRepository.getCpuHistory(hostid, inicio, fim),
      ReportRepository.getMemoriaHistory(hostid, inicio, fim),
      ReportRepository.getDisponibilidade(hostid),
      ReportRepository.getDiscosHistory(hostid, inicio, fim),
      ServiceRepository.getServiceHistory(hostid, inicio, fim, agrupamento),
    ])

    return { cpu, memoria, disponibilidade, discos, services }
  }

  // ───────────────────────────────────────────────────────────
  // SLA DE HOST
  // ───────────────────────────────────────────────────────────

  static async getHostServicesSla(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<HostSlaSummary> {
    const id = hostid.toString()
    return cached(
      `host:${id}:sla:${inicio}:${fim}`,
      () => ServiceRepository.getHostSlaSummary(hostid, inicio, fim),
      TTL.HOST_SLA,
    )
  }

  // ───────────────────────────────────────────────────────────
  // HISTÓRICO E TIMELINE
  // ───────────────────────────────────────────────────────────

  static async getHostServicesHistory(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<ServicesHistoryResult> {
    const id = hostid.toString()
    return cached(
      `host:${id}:services-history:${inicioTs}:${fimTs}`,
      () => ServiceRepository.getServicesHistory(hostid, inicioTs, fimTs),
      TTL.HOST_SERVICES_HISTORY,
    )
  }

  static async getHostTimeline(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<HostTimelineResult> {
    const id = hostid.toString()
    return cached(
      `host:${id}:timeline:${inicioTs}:${fimTs}`,
      () => TimelineRepository.getHostTimeline(hostid, inicioTs, fimTs),
      TTL.HOST_TIMELINE,
    )
  }

  // ───────────────────────────────────────────────────────────
  // RELATÓRIO POR NOME (lookup interno)
  // ───────────────────────────────────────────────────────────

  static async getRelatorioPorNome(
    hostname: string,
    inicio: string,
    fim: string,
    agrupamento: string = '15min',
  ): Promise<RelatorioHostInteligente | null> {
    const hostid = await HostRepository.findHostidPorNome(hostname)
    if (!hostid) return null

    return ZabbixService.getRelatorioHostInteligente(hostid, inicio, fim, agrupamento)
  }

  // ───────────────────────────────────────────────────────────
  // GETTERS EXTRAS
  // ───────────────────────────────────────────────────────────

  static async getHostBasico(hostid: bigint | number): Promise<HostBasico | null> {
    const id = hostid.toString()
    return cached(
      `host:${id}:basico`,
      () => HostRepository.getHostBasico(hostid),
      TTL.HOST_BASICO,
    )
  }

  static async getHostServices(hostid: bigint | number): Promise<HostService[]> {
    const id = hostid.toString()
    return cached(
      `host:${id}:services`,
      () => ServiceRepository.getHostServices(hostid),
      TTL.HOST_SERVICES,
    )
  }

  // ───────────────────────────────────────────────────────────
  // HOSTS FULL DO GRUPO
  // ✅ Mesmo nome, mesmo formato. Agora usa _montarHostsFullBatch.
  // ───────────────────────────────────────────────────────────
  static async getHostsFullDoGrupo(chave: string): Promise<HostsFullResponse> {
    return cached(
      `grupo:${chave}:hosts-full`,
      async () => {
        const grupoResp = await HostRepository.getHostsPorChave(chave)
        const hosts = grupoResp.hosts

        if (hosts.length === 0) {
          return { grupo: chave, tipo: grupoResp.tipo, total: 0, hosts: [] }
        }

        const resultado = await ZabbixService._montarHostsFullBatch(hosts)

        return {
          grupo: chave,
          tipo: grupoResp.tipo,
          total: resultado.length,
          hosts: resultado,
        }
      },
      60_000,
    )
  }

  // ───────────────────────────────────────────────────────────
  // LISTAS E DIAGNÓSTICO (otimizados)
  // ───────────────────────────────────────────────────────────

  static async listarHostsComIp() {
    return cached('hosts:com-ip', () => HostRepository.listarHostsComIp(), TTL.HOSTS_COM_IP)
  }

  static async getHostComIp(hostid: bigint | number) {
    const id = hostid.toString()
    return cached(
      `host:${id}:com-ip`,
      () => HostRepository.getHostComIp(hostid),
      TTL.HOST_COM_IP,
    )
  }

  static async listarHostsComIpESo() {
    return cached(
      'hosts:com-ip-e-so',
      () => HostRepository.listarHostsComIpESo(),
      TTL.HOSTS_COM_IP_E_SO,
    )
  }

  static async getActiveServices(hostid: bigint | number) {
    const id = hostid.toString()
    return cached(
      `host:${id}:active-services`,
      () => MetricRepository.getActiveServices(hostid),
      TTL.ACTIVE_SERVICES,
    )
  }

  static async getStatusPingUptimeAll() {
    return cached(
      'hosts:status-ping-uptime:all',
      () => MetricRepository.getStatusPingUptimeAll(),
      TTL.STATUS_ALL,
    )
  }

  static async getSeriePorKey(
    hostid: bigint | number,
    itemKey: string,
    inicio: string,
    fim: string,
  ) {
    const id = hostid.toString()
    return cached(
      `host:${id}:serie:${itemKey}:${inicio}:${fim}`,
      () => MetricRepository.getSeriePorKey(hostid, itemKey, inicio, fim),
      TTL.SERIE_POR_KEY,
    )
  }

  // ───────────────────────────────────────────────────────────
  // ✅ getRelatorioPorPeriodo — sem cache duplicado.
  // getRelatorioHostInteligente já tem cache interno.
  // Mantém o mesmo nome e o mesmo retorno.
  // ───────────────────────────────────────────────────────────
  static async getRelatorioPorPeriodo(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ) {
    return ZabbixService.getRelatorioHostInteligente(hostid, inicio, fim)
  }

  static async getStatusPingUptime(hostid: bigint | number) {
    const id = hostid.toString()
    return cached(
      `host:${id}:status-ping-uptime`,
      () => MetricRepository.getStatusPingUptime(hostid),
      TTL.STATUS_PING_UPTIME,
    )
  }

  // ───────────────────────────────────────────────────────────
  // ✅ NOVO — Payload composto de /host/:hostid/metrics
  // Mesma saída que a rota já montava inline, agora cacheada.
  // ───────────────────────────────────────────────────────────
  static async getHostMetricsPayload(hostid: bigint | number) {
    const id = hostid.toString()
    return cached(
      `host:${id}:metrics-payload`,
      async () => {
        const [details, comIp, basico, statusInfo] = await Promise.all([
          ZabbixService.getHostDetails(hostid),
          ZabbixService.getHostComIp(hostid),
          ZabbixService.getHostBasico(hostid),
          ZabbixService.getStatusPingUptime(hostid),
        ])

        return {
          hostid: id,
          nome: basico?.host ?? null,
          ip: comIp?.ip ?? null,
          porta_customizada: comIp?.porta_customizada ?? null,

          status: statusInfo.status,
          host_status: statusInfo.host_status,
          icmp_ping: statusInfo.icmp_ping,
          latency_ms: statusInfo.latency_ms,
          uptime_seconds: statusInfo.uptime_seconds,
          uptime_days: statusInfo.uptime_days,

          cpu: details.cpu,
          memoria: details.memoria,
          discos: details.discos,
          os: details.os?.name ?? details.os?.type?.toUpperCase() ?? 'UNKNOWN',
          os_type: details.os?.type ?? 'unknown',
          services: details.services,
        }
      },
      30_000,
    )
  }
}

export interface HostFull {
  hostid: string
  hostname: string
  details: HostDetails
}

export interface HostsFullResponse {
  grupo: string
  tipo: 'id' | 'nome'
  total: number
  hosts: HostFull[]
}