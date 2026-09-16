// services/zabbix.service.ts
import { HostRepository, type HostResumo, type GrupoZabbix, type HostBasico } from '../repositories/host.repository.js'
import { MetricRepository } from '../repositories/metric.repository.js'
import { ServiceRepository, type HostService, type HostSlaSummary, type ServicesHistoryResult } from '../repositories/service.repository.js'
import { ReportRepository, type SeriePonto, type DiscoHistorico, type Disponibilidade } from '../repositories/report.repository.js'
import { TimelineRepository, type HostTimelineResult } from '../repositories/timeline.repository.js'
import { HostClassifier, type ClassificacaoHost } from './host-classifier.service.js'
import { obterSla, formatarTempo, categorizarServico, type SlaStatus, type CategoriaServico } from '../utils/helpers.js'

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
  classificacao: ClassificacaoHost  // ← NOVO (opção B)
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
    return HostRepository.listarGrupos()
  }

  static async getHostsDoGrupo(groupid: bigint | number): Promise<HostResumo[]> {
    return HostRepository.getHostsDoGrupo(groupid)
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
    return HostRepository.getHostsPorChave(chave)
  }

  // ───────────────────────────────────────────────────────────
  // DETALHES DO HOST (com classificação — opção B)
  // ───────────────────────────────────────────────────────────

  static async getHostDetails(hostid: bigint | number): Promise<HostDetails> {
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
  // COLETA COMPLETA (cuidado: muitos hosts = muitas queries)
  // ───────────────────────────────────────────────────────────

  static async coletarDadosCompletos(): Promise<ColetaCompleta> {
    // Lista hosts ATIVOS (status=0)
    const grupos = await HostRepository.listarGrupos()
    const todos = new Map<string, HostResumo>()

    // Coleta de todos os grupos (evita host duplicado por estar em vários grupos)
    for (const g of grupos) {
      const hs = await HostRepository.getHostsDoGrupo(BigInt(g.groupid))
      for (const h of hs) todos.set(h.hostid, h)
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
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    // Implementação direta via prisma (equivalente ao SQL do zabbix.py)
    const { prisma } = await import('../lib/prisma.js')

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
    return ServiceRepository.getHostSlaSummary(hostid, inicio, fim)
  }

  // ───────────────────────────────────────────────────────────
  // HISTÓRICO E TIMELINE
  // ───────────────────────────────────────────────────────────

  static async getHostServicesHistory(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<ServicesHistoryResult> {
    return ServiceRepository.getServicesHistory(hostid, inicioTs, fimTs)
  }

  static async getHostTimeline(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<HostTimelineResult> {
    return TimelineRepository.getHostTimeline(hostid, inicioTs, fimTs)
  }

  // ───────────────────────────────────────────────────────────
  // GETTERS EXTRAS
  // ───────────────────────────────────────────────────────────

  static async getHostBasico(hostid: bigint | number): Promise<HostBasico | null> {
    return HostRepository.getHostBasico(hostid)
  }

  static async getHostServices(hostid: bigint | number): Promise<HostService[]> {
    return ServiceRepository.getHostServices(hostid)
  }
}