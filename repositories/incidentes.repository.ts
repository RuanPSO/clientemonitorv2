// repositories/incidentes.repository.ts
import { prisma } from '../lib/prisma.js'

// =============================================================
// TIPOS
// =============================================================

export interface IncidenteAtivo {
  eventid: string
  hora_inicio: string
  host: string
  incidente: string
  severidade: number
  duracao_segundos: number
  duracao: string // "HH:MM:SS"
}

export interface HostsTotais {
  online: number
  offline: number
  sem_acesso: number
  manutencao: number
}

export interface Problema24h {
  problema: string
  total_ocorrencias: number
  porcentagem: number
}

// =============================================================
export class IncidentesRepository {
  /**
   * Busca incidentes ativos do dia (problemas não resolvidos).
   * Equivalente a `buscar_incidentes_ativos_do_dia`.
   */
  static async getIncidentesAtivosDoDia(): Promise<IncidenteAtivo[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        eventid: bigint
        hora_inicio: Date
        host: string
        incidente: string
        severidade: number
        duracao_segundos: number | bigint
      }>
    >`
      SELECT
        p.eventid,
        to_timestamp(MAX(p.clock)) AS hora_inicio,
        MAX(h.host) AS host,
        MAX(t.description) AS incidente,
        MAX(t.priority) AS severidade,
        ROUND(EXTRACT(EPOCH FROM NOW()) - MAX(p.clock)) AS duracao_segundos
      FROM problem p
      JOIN events e ON e.eventid = p.eventid
      JOIN triggers t ON t.triggerid = e.objectid
      JOIN functions f ON f.triggerid = t.triggerid
      JOIN items i ON i.itemid = f.itemid
      JOIN hosts h ON h.hostid = i.hostid
      WHERE p.r_eventid IS NULL
        AND p.clock >= EXTRACT(EPOCH FROM CURRENT_DATE)
      GROUP BY p.eventid
      ORDER BY hora_inicio DESC
    `

    return rows.map((r) => {
      const duracao = Number(r.duracao_segundos ?? 0)
      const h = Math.floor(duracao / 3600)
      const m = Math.floor((duracao % 3600) / 60)
      const s = duracao % 60

      return {
        eventid: r.eventid.toString(),
        hora_inicio:
          r.hora_inicio instanceof Date
            ? r.hora_inicio.toISOString()
            : String(r.hora_inicio),
        host: r.host,
        incidente: r.incidente,
        severidade: Number(r.severidade),
        duracao_segundos: duracao,
        duracao: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      }
    })
  }

  /**
   * Total de hosts por status.
   * Equivalente a `get_hosts_totais`.
   *
   * Mapeamento de status do Zabbix:
   *   0 = monitored (habilitado)
   *   1 = unmonitored (desabilitado)
   *   3 = template (não usado aqui, mas mantido no Python)
   *   5 = maintenance (manutenção)
   */
  static async getHostsTotais(): Promise<HostsTotais> {
    const rows = await prisma.$queryRaw<
      Array<{
        online: bigint
        offline: bigint
        sem_acesso: bigint
        manutencao: bigint
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE status = 0) AS online,
        COUNT(*) FILTER (WHERE status = 1) AS offline,
        COUNT(*) FILTER (WHERE status = 3) AS sem_acesso,
        COUNT(*) FILTER (WHERE status = 5) AS manutencao
      FROM hosts
    `

    const r = rows[0]
    return {
      online: Number(r?.online ?? 0),
      offline: Number(r?.offline ?? 0),
      sem_acesso: Number(r?.sem_acesso ?? 0),
      manutencao: Number(r?.manutencao ?? 0),
    }
  }

  /**
   * Top 10 problemas nas últimas 24h.
   * Equivalente a `get_problemas_24h`.
   */
  static async getProblemas24h(): Promise<Problema24h[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        problema: string
        total_ocorrencias: bigint
        porcentagem: number | null
      }>
    >`
      SELECT
        t.description AS problema,
        COUNT(e.eventid) AS total_ocorrencias,
        ROUND(
          (COUNT(e.eventid)::numeric / NULLIF(SUM(COUNT(e.eventid)) OVER (), 0)) * 100,
          2
        ) AS porcentagem
      FROM events e
      JOIN triggers t ON e.objectid = t.triggerid
      WHERE e.source = 0
        AND e.object = 0
        AND e.value = 1
        AND e.clock >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '24 hours'))
      GROUP BY t.description
      ORDER BY total_ocorrencias DESC
      LIMIT 10
    `

    return rows.map((r) => ({
      problema: r.problema,
      total_ocorrencias: Number(r.total_ocorrencias),
      porcentagem: r.porcentagem != null ? Number(r.porcentagem) : 0,
    }))
  }
}