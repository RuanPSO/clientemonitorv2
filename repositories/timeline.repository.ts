// repositories/timeline.repository.ts
import { prisma } from '../lib/prisma.js'

// =============================================================
// TIPOS
// =============================================================
export interface ServiceBasic {
  itemid: bigint
  name: string
  key_: string
}

export interface CurrentServiceStatus {
  name: string
  status: 'ON' | 'OFF' | 'UNKNOWN'
  last_update: number | null
}

export interface TimelineSegment {
  start: number
  end: number
  value: number
  status: 'RUNNING' | 'STOPPED' | 'UNKNOWN'
}

export interface ServiceSegments {
  itemid: string
  service: string
  segments: TimelineSegment[]
}

export interface HostTimelineResult {
  hostid: string
  period: { start: number; end: number }
  total_services: number
  services: ServiceSegments[]
}

interface ChangeRow {
  itemid: bigint
  clock: number
  value: number
}

type LastStateMap = Map<string, { clock: number; value: number }>
type ChangesMap = Map<string, Array<{ clock: number; value: number }>>

// =============================================================
export class TimelineRepository {
  // ==========================================================
  // 1. SERVIÇOS DO HOST
  // ==========================================================
  static async getServices(hostid: bigint | number): Promise<ServiceBasic[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<Array<{ itemid: bigint; name: string; key_: string }>>`
      SELECT itemid, name, key_
      FROM items
      WHERE hostid = ${hostIdBig}
        AND (key_ LIKE 'service.info%' OR key_ LIKE 'systemd.unit%')
        AND key_ NOT LIKE 'proc.num%'
        AND name NOT LIKE 'State of service "{#SERVICE.NAME}" ({#SERVICE.DISPLAYNAME})%'
        AND name NOT LIKE 'Service GG%'
    `
    return rows
  }

  // ==========================================================
  // 2. ESTADO ANTERIOR AO PERÍODO
  // ==========================================================
  static async getLastStateBefore(
    hostid: bigint | number,
    inicioTs: number,
  ): Promise<LastStateMap> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ itemid: bigint; clock: number; value: number }>
    >`
      SELECT DISTINCT ON (h.itemid)
        h.itemid,
        h.clock,
        h.value
      FROM history_uint h
      JOIN items i ON i.itemid = h.itemid
      WHERE i.hostid = ${hostIdBig}
        AND h.clock < ${inicioTs}
        AND (i.key_ LIKE 'service.info%' OR i.key_ LIKE 'systemd.unit%')
      ORDER BY h.itemid, h.clock DESC
    `

    const map: LastStateMap = new Map()
    for (const r of rows) {
      map.set(r.itemid.toString(), { clock: Number(r.clock), value: Number(r.value) })
    }
    return map
  }

  // ==========================================================
  // 3. MUDANÇAS NO PERÍODO
  // ==========================================================
  static async getChanges(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<ChangeRow[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ itemid: bigint; clock: number; value: number }>
    >`
      SELECT
        h.itemid,
        h.clock,
        h.value
      FROM history_uint h
      JOIN items i ON i.itemid = h.itemid
      WHERE i.hostid = ${hostIdBig}
        AND h.clock BETWEEN ${inicioTs} AND ${fimTs}
        AND (i.key_ LIKE 'service.info%' OR i.key_ LIKE 'systemd.unit%')
      ORDER BY h.itemid, h.clock
    `

    return rows.map((r) => ({
      itemid: r.itemid,
      clock: Number(r.clock),
      value: Number(r.value),
    }))
  }

  // ==========================================================
  // 4. CONSTRUÇÃO DOS SEGMENTOS (puro, sem banco)
  // ==========================================================
  static buildSegments(
    services: Array<{ itemid: bigint; name: string }>,
    lastState: LastStateMap,
    changes: ChangeRow[],
    fimTs: number,
  ): ServiceSegments[] {
    // Agrupa mudanças por item
    const grouped: ChangesMap = new Map()
    for (const c of changes) {
      const key = c.itemid.toString()
      const arr = grouped.get(key) ?? []
      arr.push({ clock: c.clock, value: c.value })
      grouped.set(key, arr)
    }

    const result: ServiceSegments[] = []

    for (const svc of services) {
      const itemidStr = svc.itemid.toString()
      const serviceChanges = grouped.get(itemidStr) ?? []

      // Estado inicial
      let currentValue: number | null = null
      let currentClock: number | null = null

      if (lastState.has(itemidStr)) {
        const ls = lastState.get(itemidStr)!
        currentValue = ls.value
        currentClock = ls.clock
      }

      const segments: TimelineSegment[] = []

      // Se não tem estado anterior, usa primeira mudança
      if (currentClock === null && serviceChanges.length > 0) {
        currentClock = serviceChanges[0]!.clock
        currentValue = serviceChanges[0]!.value
      }

      for (const change of serviceChanges) {
        if (currentClock === null) {
          currentClock = change.clock
          currentValue = change.value
          continue
        }

        // Fecha segmento anterior
        segments.push({
          start: currentClock,
          end: change.clock,
          value: currentValue ?? 0,
          status: TimelineRepository._decodeStatus(currentValue),
        })

        currentClock = change.clock
        currentValue = change.value
      }

      // Fecha último segmento até fim do período
      if (currentClock !== null) {
        segments.push({
          start: currentClock,
          end: fimTs,
          value: currentValue ?? 0,
          status: TimelineRepository._decodeStatus(currentValue),
        })
      }

      result.push({
        itemid: itemidStr,
        service: svc.name,
        segments,
      })
    }

    return result
  }

  // ==========================================================
  // 5. DECODIFICA STATUS
  // ==========================================================
  static _decodeStatus(value: number | null | undefined): 'RUNNING' | 'STOPPED' | 'UNKNOWN' {
    if (value === 0) return 'RUNNING'
    if (value === 6) return 'STOPPED'
    return 'UNKNOWN'
  }

  // ==========================================================
  // 6. FUNÇÃO PRINCIPAL
  // ==========================================================
  static async getHostTimeline(
    hostid: bigint | number,
    inicioTs: number,
    fimTs: number,
  ): Promise<HostTimelineResult> {
    const servicesRaw = await TimelineRepository.getServices(hostid)
    const services = servicesRaw.map((s) => ({ itemid: s.itemid, name: s.name }))

    const [lastState, changes] = await Promise.all([
      TimelineRepository.getLastStateBefore(hostid, inicioTs),
      TimelineRepository.getChanges(hostid, inicioTs, fimTs),
    ])

    const timeline = TimelineRepository.buildSegments(services, lastState, changes, fimTs)

    return {
      hostid: hostid.toString(),
      period: { start: inicioTs, end: fimTs },
      total_services: timeline.length,
      services: timeline,
    }
  }

  // ==========================================================
  // 7. STATUS ATUAL DOS SERVIÇOS (ON/OFF)
  //    Otimizado: LIMIT + IN em vez de JOIN
  // ==========================================================
  static async getCurrentServiceStatus(
    hostid: bigint | number,
  ): Promise<CurrentServiceStatus[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{
        itemid: bigint
        name: string
        value: number | null
        clock: number | null
      }>
    >`
      WITH services AS (
        SELECT itemid, name, key_
        FROM items
        WHERE hostid = ${hostIdBig}
          AND (key_ LIKE 'service.info%' OR key_ LIKE 'systemd.unit%')
          AND key_ NOT LIKE 'proc.num%'
          AND name NOT LIKE 'State of service "{#SERVICE.NAME}" ({#SERVICE.DISPLAYNAME})%'
          AND name NOT LIKE 'Service GG%'
        ORDER BY itemid
        LIMIT 300
      ),
      last_values AS (
        SELECT DISTINCT ON (h.itemid)
          h.itemid, h.value, h.clock
        FROM history_uint h
        WHERE h.itemid IN (SELECT itemid FROM services)
        ORDER BY h.itemid, h.clock DESC
      )
      SELECT
        s.itemid,
        s.name,
        lv.value,
        lv.clock
      FROM services s
      LEFT JOIN last_values lv ON lv.itemid = s.itemid
      ORDER BY s.name
    `

    return rows.map((r) => {
      let status: CurrentServiceStatus['status'] = 'UNKNOWN'
      if (r.value !== null && r.value !== undefined) {
        const v = Number(r.value)
        if (v === 0) status = 'ON'
        else if (v === 6) status = 'OFF'
        else status = 'UNKNOWN'
      }
      return {
        name: r.name,
        status,
        last_update: r.clock !== null && r.clock !== undefined ? Number(r.clock) : null,
      }
    })
  }
}