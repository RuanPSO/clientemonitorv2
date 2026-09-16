// repositories/report.repository.ts
import { prisma } from '../lib/prisma.js'
import { MetricRepository } from './metric.repository.js'
import { isoParaTimestamp, round2, toNumber } from '../utils/helpers.js'

export interface SeriePonto {
  data: string
  avg: number
  min: number
  max: number
}

export interface DiscoHistorico {
  mount: string
  name: string
  history: SeriePonto[]
  total_gb?: number
  free_gb?: number
  used_gb?: number
}

export interface Disponibilidade {
  uptime: number
  downtime: number
  availability: number
}

const GB = 1_073_741_824

export class ReportRepository {
  // ==========================================================
  // SÉRIES HISTÓRICAS (auxiliares internos)
  // ==========================================================

  /**
   * Série de history (valores float) agregada a cada 15 min.
   */
  static async _serieHistory(itemid: bigint, inicioTs: number, fimTs: number): Promise<SeriePonto[]> {
    const rows = await prisma.$queryRaw<
      Array<{ data: string; avg: string | number; min: string | number; max: string | number }>
    >`
      SELECT
        TO_CHAR(TO_TIMESTAMP(FLOOR(clock / 900) * 900), 'YYYY-MM-DD HH24:MI') AS data,
        ROUND(AVG(value)::numeric, 2) AS avg,
        ROUND(MIN(value)::numeric, 2) AS min,
        ROUND(MAX(value)::numeric, 2) AS max
      FROM history
      WHERE itemid = ${itemid}
        AND clock BETWEEN ${inicioTs} AND ${fimTs}
      GROUP BY 1
      ORDER BY 1
    `
    return rows.map((r) => ({
      data: r.data,
      avg: toNumber(r.avg),
      min: toNumber(r.min),
      max: toNumber(r.max),
    }))
  }

  /**
   * Série de history_uint (valores inteiros/bigint).
   */
  static async _serieHistoryUint(itemid: bigint, inicioTs: number, fimTs: number): Promise<SeriePonto[]> {
    const rows = await prisma.$queryRaw<
      Array<{ data: string; avg: string | number; min: string | number; max: string | number }>
    >`
      SELECT
        TO_CHAR(TO_TIMESTAMP(FLOOR(clock / 900) * 900), 'YYYY-MM-DD HH24:MI') AS data,
        ROUND(AVG(value)::numeric, 2) AS avg,
        MIN(value) AS min,
        MAX(value) AS max
      FROM history_uint
      WHERE itemid = ${itemid}
        AND clock BETWEEN ${inicioTs} AND ${fimTs}
      GROUP BY 1
      ORDER BY 1
    `
    return rows.map((r) => ({
      data: r.data,
      avg: toNumber(r.avg),
      min: toNumber(r.min),
      max: toNumber(r.max),
    }))
  }

  /**
   * Série da tabela trends (dados horários, agregados pelo próprio Zabbix).
   */
  static async _trends(itemid: bigint, inicioTs: number, fimTs: number): Promise<SeriePonto[]> {
    const rows = await prisma.$queryRaw<
      Array<{ data: string; avg: string | number; min: string | number; max: string | number }>
    >`
      SELECT
        TO_CHAR(TO_TIMESTAMP(clock), 'YYYY-MM-DD HH24:00') AS data,
        ROUND(AVG(value_avg)::numeric, 2) AS avg,
        ROUND(MIN(value_min)::numeric, 2) AS min,
        ROUND(MAX(value_max)::numeric, 2) AS max
      FROM trends
      WHERE itemid = ${itemid}
        AND clock BETWEEN ${inicioTs} AND ${fimTs}
      GROUP BY 1
      ORDER BY 1
    `
    return rows.map((r) => ({
      data: r.data,
      avg: toNumber(r.avg),
      min: toNumber(r.min),
      max: toNumber(r.max),
    }))
  }

  /**
   * Série da tabela trends_uint.
   */
  static async _trendsUint(itemid: bigint, inicioTs: number, fimTs: number): Promise<SeriePonto[]> {
    const rows = await prisma.$queryRaw<
      Array<{ data: string; avg: string | number; min: string | number; max: string | number }>
    >`
      SELECT
        TO_CHAR(TO_TIMESTAMP(clock), 'YYYY-MM-DD HH24:00') AS data,
        ROUND(AVG(value_avg)::numeric, 2) AS avg,
        ROUND(MIN(value_min)::numeric, 2) AS min,
        ROUND(MAX(value_max)::numeric, 2) AS max
      FROM trends_uint
      WHERE itemid = ${itemid}
        AND clock BETWEEN ${inicioTs} AND ${fimTs}
      GROUP BY 1
      ORDER BY 1
    `
    return rows.map((r) => ({
      data: r.data,
      avg: toNumber(r.avg),
      min: toNumber(r.min),
      max: toNumber(r.max),
    }))
  }

  // ==========================================================
  // CPU
  // ==========================================================
  static async getCpuHistory(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<SeriePonto[]> {
    const itemid = await MetricRepository.getCpuItemid(hostid)
    if (!itemid) return []

    const inicioTs = isoParaTimestamp(inicio)
    const fimTs = isoParaTimestamp(fim)

    return ReportRepository._serieHistory(itemid, inicioTs, fimTs)
  }

  // ==========================================================
  // MEMÓRIA
  // ==========================================================
  static async getMemoriaHistory(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<SeriePonto[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
      SELECT itemid
      FROM items
      WHERE hostid = ${hostIdBig}
        AND (key_ LIKE 'vm.memory.util%' OR key_ LIKE 'vm.memory.size[pused]%')
      LIMIT 1
    `
    if (rows.length === 0) return []

    const inicioTs = isoParaTimestamp(inicio)
    const fimTs = isoParaTimestamp(fim)

    return ReportRepository._serieHistory(rows[0].itemid, inicioTs, fimTs)
  }

  // ==========================================================
  // DISCOS
  // ==========================================================
  static async getDiscosHistory(
    hostid: bigint | number,
    inicio: string,
    fim: string,
  ): Promise<DiscoHistorico[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const inicioTs = isoParaTimestamp(inicio)
    const fimTs = isoParaTimestamp(fim)

    // 1. Itens de disco (pused) com dados no período
    const items = await prisma.$queryRaw<
      Array<{ itemid: bigint; name: string; key_: string; mount: string | null }>
    >`
      SELECT
        i.itemid,
        i.name,
        i.key_,
        SUBSTRING(i.key_ FROM 'vfs\\.fs\\.size\\[([^,]*),') AS mount
      FROM items i
      WHERE i.hostid = ${hostIdBig}
        AND (i.key_ LIKE 'vfs.fs.size[%,pused]' OR i.key_ LIKE 'vfs.fs.dependent.size[%,pused]')
        AND EXISTS (
          SELECT 1
          FROM history h
          WHERE h.itemid = i.itemid
            AND h.clock BETWEEN ${inicioTs} AND ${fimTs}
          LIMIT 1
        )
    `

    if (items.length === 0) return []

    const resultado: DiscoHistorico[] = []
    const mountsProcessados = new Set<string>()  // ← NOVO: controle de deduplicação

    for (const row of items) {
      let mount = row.mount
      if (!mount) {
        try {
          mount = row.key_.split('[')[1].split(',')[0]
        } catch {
          continue
        }
      }

      // ← NOVO: se já processamos esse mount, pula (evita duplicatas)
      if (mountsProcessados.has(mount)) continue

      const serie = await ReportRepository._serieHistory(row.itemid, inicioTs, fimTs)
      if (serie.length === 0) continue

      // ← NOVO: só marca como processado DEPOIS de validar que tem dados
      mountsProcessados.add(mount)

      const disco: DiscoHistorico = {
        mount,
        name: row.name,
        history: serie,
      }

      // Capacidade total
      const totalRows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
        SELECT itemid FROM items
        WHERE hostid = ${hostIdBig} AND key_ = ${`vfs.fs.size[${mount},total]`}
        LIMIT 1
      `
      if (totalRows.length > 0) {
        const totalBytes = await MetricRepository.getLastValue(totalRows[0].itemid, 'int')
        if (totalBytes !== null) {
          disco.total_gb = round2(Number(totalBytes) / GB)
        }
      }

      // Espaço livre
      const freeRows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
        SELECT itemid FROM items
        WHERE hostid = ${hostIdBig} AND key_ = ${`vfs.fs.size[${mount},free]`}
        LIMIT 1
      `
      if (freeRows.length > 0) {
        const freeBytes = await MetricRepository.getLastValue(freeRows[0].itemid, 'int')
        if (freeBytes !== null) {
          disco.free_gb = round2(Number(freeBytes) / GB)
        }
      }

      // Usado = total - livre
      if (disco.total_gb !== undefined && disco.free_gb !== undefined) {
        disco.used_gb = round2(disco.total_gb - disco.free_gb)
      }

      resultado.push(disco)
    }

    return resultado
  }

  // ==========================================================
  // DISPONIBILIDADE (ICMP)
  // ==========================================================
  static async getDisponibilidade(hostid: bigint | number): Promise<Disponibilidade> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const icmpRows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
      SELECT itemid FROM items
      WHERE hostid = ${hostIdBig} AND key_ = 'icmpping'
      LIMIT 1
    `
    if (icmpRows.length === 0) {
      return { uptime: 0, downtime: 0, availability: 0 }
    }

    const itemid = icmpRows[0].itemid

    const rows = await prisma.$queryRaw<Array<{ up: bigint; down: bigint; total: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE value = 1) AS up,
        COUNT(*) FILTER (WHERE value = 0) AS down,
        COUNT(*) AS total
      FROM history_uint
      WHERE itemid = ${itemid}
    `

    if (rows.length === 0) {
      return { uptime: 0, downtime: 0, availability: 0 }
    }

    const up = Number(rows[0].up ?? 0)
    const down = Number(rows[0].down ?? 0)
    const total = Number(rows[0].total ?? 0)
    const availability = total > 0 ? round2((up / total) * 100) : 0

    return { uptime: up, downtime: down, availability }
  }
}