// repositories/service.repository.ts
import { prisma } from '../lib/prisma.js'
import { MetricRepository } from './metric.repository.js'
import { normalizarData, isoParaTimestamp } from '../utils/helpers.js'

// =============================================================
// TIPOS
// =============================================================
export interface ServicoItem {
  itemid: bigint
  name: string
  key_: string
}

export interface HostService {
  name: string
  status: 'ON' | 'OFF'
  last_update: number | null
}

export interface PontoServico {
  data: string
  value: number
}

export interface ServicoHistorico {
  name: string
  key: string
  availability: number
  unavailability: number
  uptime: string
  downtime: string
  period: string
  history: PontoServico[]
  has_data: boolean
}

export interface ServicoKpi {
  name: string
  availability: number
  unavailability: number
  uptime: string
  downtime: string
  up_samples: number
  down_samples: number
  total_samples: number
  current_status: 'ON' | 'OFF'
}

export interface HostSlaSummary {
  total_services: number
  avg_availability: number
  worst_service: { name: string; availability: number } | null
  best_service: { name: string; availability: number } | null
  services: ServicoKpi[]
}

export interface TimelineEvent {
  clock: number
  timestamp: string
  value: number
  status: 'RUNNING' | 'STOPPED' | 'UNKNOWN'
}

export interface ServiceTimeline {
  itemid: string
  service: string
  key: string
  timeline: TimelineEvent[]
}

export interface ServicesHistoryResult {
  hostid: string
  total_services: number
  services: ServiceTimeline[]
}

// =============================================================
export class ServiceRepository {
  static readonly STATUS_MAP: Record<number, string> = {
    0: 'RUNNING',
    1: 'PAUSED',
    2: 'START_PENDING',
    3: 'PAUSE_PENDING',
    4: 'CONTINUE_PENDING',
    5: 'STOP_PENDING',
    6: 'STOPPED',
  }

  // ==========================================================
  // AUXILIARES
  // ==========================================================

  /**
   * Formata segundos em "Xd Xh" ou "Xh Xmin".
   * Preserva o formato exato do Python ServiceRepository.fmt_tempo.
   */
  static fmtTempo(segundos: number | null | undefined): string {
    if (segundos === null || segundos === undefined) return 'N/A'
    const s = Math.floor(Number(segundos))
    const dias = Math.floor(s / 86400)
    const horas = Math.floor((s % 86400) / 3600)
    const minutos = Math.floor((s % 3600) / 60)

    if (dias > 0) return `${dias}d ${horas}h`
    return `${horas}h ${minutos}m`
  }

  /**
   * Extrai um nome legível para o serviço a partir de `name` e `key_`.
   * Réplica fiel do `_extrair_nome_servico` do Python.
   */
  static _extrairNomeServico(name: string, key: string): string {
    // 1. Tenta extrair da key: ["nome"]
    let match = key.match(/\["([^"]+)"/)
    const nomeDaKey = match?.[1]
    if (nomeDaKey !== undefined) return nomeDaKey.trim()

    // 2. Tenta extrair do name: "nome"
    match = name.match(/"([^"]+)"/)
    const nomeDoName = match?.[1]
    if (nomeDoName !== undefined) return nomeDoName.trim()

    // 3. Remove prefixos comuns
    let limpo = name.replace(/^State of service\s*/i, '')
    limpo = limpo.replace(/\s*\(.*?\)\s*$/, '').trim()

    return limpo || name
  }

  // ==========================================================
  // PONTOS HISTÓRICOS DE UM SERVIÇO
  // (equivalente a _obter_pontos_servico)
  // ==========================================================
  static async _obterPontosServico(
    itemid: bigint,
    inicioTs: number,
    fimTs: number,
    agrupamento: string = '15min',
  ): Promise<PontoServico[]> {
    // Configura o agrupamento
    const cfg =
      agrupamento === 'hora'
        ? { groupExpr: 'FLOOR(clock / 3600) * 3600', dateFormat: 'YYYY-MM-DD HH24:00' }
        : agrupamento === 'dia'
          ? { groupExpr: 'FLOOR(clock / 86400) * 86400', dateFormat: 'YYYY-MM-DD' }
          : { groupExpr: 'FLOOR(clock / 900) * 900', dateFormat: 'YYYY-MM-DD HH24:MI' }

    // 1) Tenta history_uint
    const sqlHistory = `
      SELECT
        TO_CHAR(TO_TIMESTAMP(${cfg.groupExpr}), '${cfg.dateFormat}') AS data,
        MAX(value) AS valor
      FROM history_uint
      WHERE itemid = $1 AND clock BETWEEN $2 AND $3
      GROUP BY ${cfg.groupExpr}
      ORDER BY ${cfg.groupExpr}
    `
    const rowsHistory = await prisma.$queryRawUnsafe<
      Array<{ data: string; valor: string | number | bigint | null }>
    >(sqlHistory, itemid, inicioTs, fimTs)

    if (rowsHistory.length > 0) {
      return rowsHistory.map((r) => ({
        data: r.data,
        value: Number(r.valor ?? 0),
      }))
    }

    // 2) Fallback: trends_uint (agrupamento diário)
    const rowsTrends = await prisma.$queryRawUnsafe<
      Array<{ data: string; valor: string | number | bigint | null }>
    >(
      `SELECT
        TO_CHAR(TO_TIMESTAMP(clock), 'YYYY-MM-DD') AS data,
        MAX(value_avg) AS valor
      FROM trends_uint
      WHERE itemid = $1 AND clock BETWEEN $2 AND $3
      GROUP BY clock
      ORDER BY clock`,
      itemid,
      inicioTs,
      fimTs,
    )

    return rowsTrends.map((r) => ({
      data: r.data,
      value: Number(r.valor ?? 0),
    }))
  }

  // ==========================================================
  // SERVIÇOS BÁSICOS
  // ==========================================================

  /**
   * Lista de serviços REAIS (systemd ou service.info) sem placeholders.
   * Equivalente a `ServiceRepository.get_services`.
   */
  static async getServices(hostid: bigint | number): Promise<ServicoItem[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<Array<{ itemid: bigint; name: string; key_: string }>>`
      SELECT itemid, name, key_
      FROM items
      WHERE hostid = ${hostIdBig}
        AND status = 0
        AND (
          (key_ LIKE 'systemd.unit.info[%'
            AND key_ NOT LIKE '%,%'
            AND key_ NOT LIKE '%{#%')
          OR
          (key_ LIKE 'service.info[%'
            AND key_ NOT LIKE '%,%'
            AND key_ NOT LIKE '%{#%')
        )
        AND name NOT ILIKE '%discovery%'
        AND name NOT ILIKE '%descoberta%'
        AND name NOT ILIKE '{#%'
        AND name NOT ILIKE '%LoadState%'
        AND name NOT ILIKE '%SubState%'
        AND name NOT ILIKE '%UnitFileState%'
        AND name NOT ILIKE '%Habilitado no boot%'
        AND name NOT ILIKE '%Estado de carga%'
        AND name NOT ILIKE '%sub-estado%'
      ORDER BY name
    `
    return rows
  }

  /**
   * Último valor (0/1) de um item.
   * Wrapper em cima de MetricRepository.getLastValue para manter fidelidade.
   */
  static async getServiceStatus(itemid: bigint): Promise<number | null> {
    const v = await MetricRepository.getLastValue(itemid, 'int')
    return v === null ? null : Number(v)
  }

  /**
   * Lista de serviços com status tratado (ON/OFF) e nome limpo.
   * Equivalente a `ServiceRepository.get_host_services`.
   */
  static async getHostServices(hostid: bigint | number): Promise<HostService[]> {
    const services = await ServiceRepository.getServices(hostid)
    const resultado: HostService[] = []

    for (const service of services) {
      const statusValue = await ServiceRepository.getServiceStatus(service.itemid)
      const status: 'ON' | 'OFF' = statusValue !== null && statusValue > 0 ? 'ON' : 'OFF'

      const nome = ServiceRepository._extrairNomeServico(service.name, service.key_)
      const nomeLower = (nome || '').toLowerCase()
      if (!nome || nomeLower.includes('discovery') || nome.includes('{#')) continue

      resultado.push({ name: nome, status, last_update: null })
    }

    return resultado
  }

  // ==========================================================
  // HISTÓRICO DE SERVIÇOS (relatórios / gráficos)
  // ==========================================================

  /**
   * Histórico de serviços de um host em um período, com disponibilidade calculada.
   * Equivalente a `ServiceRepository.get_service_history`.
   */
  static async getServiceHistory(
    hostid: bigint | number,
    inicio: string,
    fim: string,
    agrupamento: string = '15min',
  ): Promise<ServicoHistorico[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const inicioIso = normalizarData(inicio)
    const fimIso = normalizarData(fim)
    const inicioTs = isoParaTimestamp(inicioIso)
    const fimTs = isoParaTimestamp(fimIso)
    const periodoSegundos = fimTs - inicioTs

    const services = await prisma.$queryRaw<Array<{ itemid: bigint; name: string; key_: string }>>`
      SELECT itemid, name, key_
      FROM items
      WHERE hostid = ${hostIdBig}
        AND (key_ LIKE 'service.info%' OR key_ LIKE 'systemd.unit%' OR key_ LIKE 'proc.num%')
      ORDER BY name
    `

    const resultado: ServicoHistorico[] = []

    for (const svc of services) {
      const pontos = await ServiceRepository._obterPontosServico(
        svc.itemid,
        inicioTs,
        fimTs,
        agrupamento,
      )
      const hasData = pontos.length > 0
      const up = pontos.filter((p) => p.value > 0).length
      const total = pontos.length
      const down = total - up

      let availability = 0
      let unavailability = 0
      let uptimeSegundos = 0
      let downtimeSegundos = 0

      if (hasData) {
        availability = Math.round((up / total) * 10000) / 100
        unavailability = Math.round((100 - availability) * 10000) / 100
        uptimeSegundos = periodoSegundos * (availability / 100)
        downtimeSegundos = periodoSegundos * (unavailability / 100)
      }

      resultado.push({
        name: ServiceRepository._extrairNomeServico(svc.name, svc.key_),
        key: svc.key_,
        availability,
        unavailability,
        uptime: ServiceRepository.fmtTempo(uptimeSegundos),
        downtime: ServiceRepository.fmtTempo(downtimeSegundos),
        period: `${Math.floor(periodoSegundos / 86400)} dias`,
        history: pontos,
        has_data: hasData,
      })
    }

    return resultado
  }

  // ==========================================================
  // KPI DE SERVIÇOS (SLA)
  // ==========================================================

  /**
   * KPI de cada serviço do host (apenas service.info).
   * Equivalente a `ServiceRepository.get_service_kpi`.
   */
  static async getServiceKpi(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<ServicoKpi[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const inicioIso = normalizarData(inicio)
    const fimIso = normalizarData(fim)
    const inicioTs = isoParaTimestamp(inicioIso)
    const fimTs = isoParaTimestamp(fimIso)
    const periodoSegundos = fimTs - inicioTs

    const services = await prisma.$queryRaw<Array<{ itemid: bigint; name: string; key_: string }>>`
      SELECT i.itemid, i.name, i.key_
      FROM items i
      WHERE i.hostid = ${hostIdBig}
        AND i.key_ LIKE 'service.info%'
        AND i.status = 0
    `

    const kpis: ServicoKpi[] = []

    for (const svc of services) {
      const pontos = await ServiceRepository._obterPontosServico(
        svc.itemid,
        inicioTs,
        fimTs,
        '15min',
      )
      const total = pontos.length
      const up = pontos.filter((p) => p.value > 0).length
      const down = total - up

      let availability = 0
      let unavailability = 0
      let uptimeSegundos = 0
      let downtimeSegundos = 0

      if (total > 0) {
        availability = Math.round((up / total) * 10000) / 100
        unavailability = Math.round((100 - availability) * 10000) / 100
        uptimeSegundos = periodoSegundos * (availability / 100)
        downtimeSegundos = periodoSegundos * (unavailability / 100)
      }

      // Status atual
      const lastRows = await prisma.$queryRaw<Array<{ value: bigint | number | string }>>`
        SELECT value FROM history_uint
        WHERE itemid = ${svc.itemid}
        ORDER BY clock DESC
        LIMIT 1
      `
      const lastRow = lastRows[0]
      const currentStatus: 'ON' | 'OFF' =
        lastRow !== undefined && Number(lastRow.value) > 0 ? 'ON' : 'OFF'

      kpis.push({
        name: ServiceRepository._extrairNomeServico(svc.name, svc.key_),
        availability,
        unavailability,
        uptime: ServiceRepository.fmtTempo(uptimeSegundos),
        downtime: ServiceRepository.fmtTempo(downtimeSegundos),
        up_samples: up,
        down_samples: down,
        total_samples: total,
        current_status: currentStatus,
      })
    }

    return kpis
  }

  /**
   * Sumário de SLA para o host.
   * Equivalente a `ServiceRepository.get_host_sla_summary`.
   */
  static async getHostSlaSummary(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<HostSlaSummary> {
    const kpis = await ServiceRepository.getServiceKpi(hostid, inicio, fim)
    const validos = kpis.filter((s) => s.total_samples > 0)

    if (validos.length === 0) {
      return {
        total_services: 0,
        avg_availability: 0,
        worst_service: null,
        best_service: null,
        services: [],
      }
    }

    const avgAvail = validos.reduce((acc, s) => acc + s.availability, 0) / validos.length

    const worst = validos.reduce((a, b) => (a.availability < b.availability ? a : b))
    const best = validos.reduce((a, b) => (a.availability > b.availability ? a : b))

    return {
      total_services: validos.length,
      avg_availability: Math.round(avgAvail * 10000) / 10000,
      worst_service: { name: worst.name, availability: worst.availability },
      best_service: { name: best.name, availability: best.availability },
      services: validos,
    }
  }

  // ==========================================================
  // HISTÓRICO DE MUDANÇAS DE ESTADO (timeline)
  // ==========================================================

  /**
   * Histórico agregado de mudanças de estado dos serviços do host.
   * Equivalente a `ServiceRepository.get_services_history`.
   */
  static async getServicesHistory(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<ServicesHistoryResult> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{
        itemid: bigint
        service: string
        key_: string
        timeline: TimelineEvent[]
      }>
    >`
      WITH mudancas AS (
        SELECT
          i.itemid,
          i.name,
          i.key_,
          h.clock,
          h.value,
          LAG(h.value) OVER (PARTITION BY h.itemid ORDER BY h.clock) AS prev_val
        FROM items i
        JOIN history_uint h ON h.itemid = i.itemid
        WHERE i.hostid = ${hostIdBig}
          AND (i.key_ LIKE 'service.info%' OR i.key_ LIKE 'systemd.unit%')
          AND i.key_ NOT LIKE 'proc.num%'
          AND i.name NOT ILIKE '%processos ativos%'
          AND i.name NOT ILIKE '%number of processes%'
          AND i.name NOT ILIKE '{#SERVICE.NAME}%'
          AND h.clock BETWEEN ${inicioTs} AND ${fimTs}
      )
      SELECT
        itemid,
        name AS service,
        key_,
        json_agg(
          json_build_object(
            'clock', clock,
            'timestamp', to_timestamp(clock),
            'value', value,
            'status', CASE
              WHEN value = 0 THEN 'RUNNING'
              WHEN value = 6 THEN 'STOPPED'
              ELSE 'UNKNOWN'
            END
          ) ORDER BY clock
        ) AS timeline
      FROM mudancas
      WHERE prev_val IS NULL OR prev_val <> value
      GROUP BY itemid, name, key_
      ORDER BY name
    `

    const services: ServiceTimeline[] = rows.map((r) => ({
      itemid: r.itemid.toString(),
      service: ServiceRepository._extrairNomeServico(r.service, r.key_),
      key: r.key_,
      timeline: (r.timeline ?? []).map((t) => ({
        clock: Number(t.clock),
        timestamp: String(t.timestamp),
        value: Number(t.value),
        status: t.status as TimelineEvent['status'],
      })),
    }))

    return {
      hostid: hostid.toString(),
      total_services: services.length,
      services,
    }
  }
}