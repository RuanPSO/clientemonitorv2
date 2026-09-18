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
// TTLs — ajuste conforme a volatilidade dos dados
// =============================================================
const TTL = {
  GRUPOS:                5 * 60_000, // 5 min  — grupos do Zabbix raramente mudam
  HOSTS_DO_GRUPO:        60_000,     // 1 min  — lista de hosts do grupo
  HOST_DETAILS:          30_000,     // 30 s   — métricas do host (CPU, RAM, disco…)
  HOST_BASICO:           30_000,     // 30 s   — nome/status do host
  HOST_SERVICES:         30_000,     // 30 s   — serviços ON/OFF do host
  HOST_PROBLEMAS:        30_000,     // 30 s   — problemas recentes
  HOST_RELATORIO:        60_000,     // 1 min  — séries históricas
  HOST_SLA:              60_000,     // 1 min  — SLA agregado
  HOST_SERVICES_HISTORY: 60_000,     // 1 min
  HOST_TIMELINE:         60_000,     // 1 min
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

  /**
   * Dispatcher (opção B): recebe ID numérico ou nome, decide qual usar.
   * Retorna sempre no formato { tipo, chave, hosts }.
   */
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
  // DETALHES DO HOST (com classificação — opção B)
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

    // 1) Coleta tudo que é independente em paralelo
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
      MetricRepository.detectarTipoHost(hostIdBig),
      MetricRepository.detectarSo(hostIdBig),
      MetricRepository.getStatus(hostIdBig),
      MetricRepository.getCpu(hostIdBig),
      MetricRepository.getMemoria(hostIdBig),
      MetricRepository.getDiscos(hostIdBig),
      MetricRepository.getUptime(hostIdBig),
      TimelineRepository.getCurrentServiceStatus(hostIdBig),
      HostRepository.getTemplatesDoHost(hostIdBig),
      HostRepository.getGruposDoHost(hostIdBig),
      HostRepository.getInterfaceType(hostIdBig),
    ])

    const osInfo = tipoInfo ?? osDetectado

    // 2) Classificação visual (com os dados que já temos)
    const classificacao = HostClassifier.classify({
      hostid: hostIdBig,
      osData: osInfo && osInfo.type !== 'network' ? osInfo : null,
      templates,
      services: services.map((s) => s.name),
      groups: gruposHost,
      interfaceType,
    })

    // 3) Host de rede → payload simplificado
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

    // 4) Host de servidor → payload completo
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
  // COLETA COMPLETA (sem cache — pesado e raro)
  // ───────────────────────────────────────────────────────────

  static async coletarDadosCompletos(): Promise<ColetaCompleta> {
    // Lista hosts ATIVOS (status=0)
    const grupos = await ZabbixService.listarGrupos()
    const todos = new Map<string, HostResumo>()

    // Coleta de todos os grupos (evita host duplicado por estar em vários grupos)
    const hostsPorGrupo = await Promise.all(
      grupos.map((g) => HostRepository.getHostsDoGrupo(BigInt(g.groupid))),
    )
    for (const hosts of hostsPorGrupo) {
      for (const host of hosts) todos.set(host.hostid, host)
    }

    const hostsUnicos = Array.from(todos.values())

    const resultado = await Promise.all(
      hostsUnicos.map(async (h) => {
        const detalhes = await ZabbixService.getHostDetails(BigInt(h.hostid))
        const { hostid: _ignored, ...rest } = detalhes
        return { hostid: h.hostid, hostname: h.hostname, ...rest }
      }),
    )

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

  static async getHostsFullDoGrupo(chave: string): Promise<HostsFullResponse> {
    return cached(
      `grupo:${chave}:hosts-full`,
      async () => {
        // 1) Lista hosts do grupo
        const grupoResp = await HostRepository.getHostsPorChave(chave)
        const hosts = grupoResp.hosts

        if (hosts.length === 0) {
          return { grupo: chave, tipo: grupoResp.tipo, total: 0, hosts: [] }
        }

        const hostids = hosts.map((h) => BigInt(h.hostid))

        // 2) BATCH — 7 queries totais (independente do número de hosts)
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

        // 3) Monta o resultado
        const resultado: HostFull[] = hosts.map((h) => {
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

        return {
          grupo: chave,
          tipo: grupoResp.tipo,
          total: resultado.length,
          hosts: resultado,
        }
      },
      60_000, // ← AUMENTEI para 60s (era 30s). Ajuste conforme sua necessidade.
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
