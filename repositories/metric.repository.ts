// repositories/metric.repository.ts
import { prisma } from '../lib/prisma.js'
import { fmtUptime } from '../utils/helpers.js'

type HistoryType = 'float' | 'int' | 'str'

const HISTORY_TABLE: Record<HistoryType, string> = {
  float: 'history',
  int: 'history_uint',
  str: 'history_str',
}

export class MetricRepository {
  // ============================================================
  // Helper: último valor de um item
  // ============================================================
  static async getLastValue(itemid: bigint, type: HistoryType): Promise<number | string | null> {
    const table = HISTORY_TABLE[type]
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string | number | bigint }>>(
      `SELECT value FROM ${table} WHERE itemid = $1 ORDER BY clock DESC LIMIT 1`,
      itemid,
    )
    const row = rows[0]
    if (!row) return null
    const raw = row.value
    return type === 'str' ? String(raw) : Number(raw)
  }

  static async getLastValuesBatch(
    items: Array<{ itemid: bigint; type: HistoryType }>,
  ): Promise<Map<string, number | string | null>> {
    const result = new Map<string, number | string | null>()
    if (items.length === 0) return result

    const byType: Record<HistoryType, bigint[]> = { float: [], int: [], str: [] }
    for (const it of items) byType[it.type].push(it.itemid)

    for (const tipo of ['float', 'int', 'str'] as const) {
      const ids = byType[tipo]
      if (ids.length === 0) continue

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
      const table = HISTORY_TABLE[tipo]
      const rows = await prisma.$queryRawUnsafe<
        Array<{ itemid: bigint; value: string | number | bigint }>
      >(
        `SELECT DISTINCT ON (itemid) itemid, value
         FROM ${table}
         WHERE itemid IN (${placeholders})
         ORDER BY itemid, clock DESC`,
        ...ids,
      )

      for (const r of rows) {
        result.set(r.itemid.toString(), tipo === 'str' ? String(r.value) : Number(r.value))
      }
    }

    return result
  }

  // ============================================================
  // SISTEMA OPERACIONAL
  // ============================================================

  static async getSystemSwOs(hostid: bigint): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT hs.value
      FROM items i
      JOIN history_str hs ON hs.itemid = i.itemid
      WHERE i.hostid = ${hostid} AND i.key_ = 'system.sw.os'
      ORDER BY hs.clock DESC
      LIMIT 1
    `
    return rows[0]?.value ?? null
  }

  static async getSystemUname(hostid: bigint): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT hs.value
      FROM items i
      JOIN history_str hs ON hs.itemid = i.itemid
      WHERE i.hostid = ${hostid} AND i.key_ = 'system.uname'
      ORDER BY hs.clock DESC
      LIMIT 1
    `
    return rows[0]?.value ?? null
  }

  static async hasWindowsDisk(hostid: bigint): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok
      FROM items
      WHERE hostid = ${hostid} AND key_ LIKE 'vfs.fs.size[C:%]'
      LIMIT 1
    `
    return rows.length > 0
  }

  static async detectarSo(hostid: bigint): Promise<{ type: 'windows' | 'linux'; name: string }> {
    const rows = await prisma.$queryRaw<Array<{ key_: string; value: string | null }>>`
      SELECT i.key_, hs.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_str
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) hs ON true
      WHERE i.hostid = ${hostid}
        AND i.key_ IN ('system.sw.os', 'system.uname')
    `

    const swOs = rows.find((r) => r.key_ === 'system.sw.os')?.value ?? null
    const uname = rows.find((r) => r.key_ === 'system.uname')?.value ?? null

    if (swOs) {
      return {
        type: swOs.toLowerCase().includes('windows') ? 'windows' : 'linux',
        name: swOs,
      }
    }
    if (uname) {
      return { type: 'linux', name: 'Linux' }
    }

    if (await MetricRepository.hasWindowsDisk(hostid)) {
      return { type: 'windows', name: 'Windows' }
    }

    return { type: 'linux', name: 'Linux' }
  }

  // ============================================================
  // CPU
  // ============================================================

  static async getCpuItemid(hostid: bigint | number): Promise<bigint | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const item = await MetricRepository._getCpuItem(hostIdBig)
    return item ? item.itemid : null
  }

  static async _getCpuItem(hostid: bigint): Promise<{ itemid: bigint; key_: string } | null> {
    const rows = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT i.itemid, i.key_
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hf ON true
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hu ON true
      WHERE i.hostid = ${hostid}
        AND (
          i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
          OR i.key_ LIKE 'system.cpu.util%'
        )
        AND COALESCE(hf.value, hu.value) IS NOT NULL
      ORDER BY
        CASE
          WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
          WHEN i.key_ = 'system.cpu.util[,idle]' THEN 2
          WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 3
          ELSE 4
        END
      LIMIT 1
    `
    return rows[0] ?? null
  }

  static async getCpu(
    hostid: bigint,
  ): Promise<{ used: number; free: number; total: number } | null> {
    const rows = await prisma.$queryRaw<
      Array<{ itemid: bigint; key_: string; value: number | null }>
    >`
      SELECT i.itemid, i.key_, COALESCE(hf.value, hu.value) AS value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hf ON true
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hu ON true
      WHERE i.hostid = ${hostid}
        AND (
          i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
          OR i.key_ LIKE 'system.cpu.util%'
        )
        AND COALESCE(hf.value, hu.value) IS NOT NULL
      ORDER BY
        CASE
          WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
          WHEN i.key_ = 'system.cpu.util[,idle]' THEN 2
          WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 3
          ELSE 4
        END
      LIMIT 1
    `

    const row = rows[0]
    if (row === undefined || row.value === null) return null

    const numValue = Number(row.value)
    const used = row.key_.toLowerCase().includes('idle') ? 100 - numValue : numValue
    const clamped = Math.max(0, Math.min(100, used))

    return {
      used: Math.round(clamped * 10) / 10,
      free: Math.round((100 - clamped) * 10) / 10,
      total: 100,
    }
  }

  // ============================================================
  // MEMÓRIA — suporta Windows (util + used) e Linux (pused + available)
  // ============================================================

  static async getMemoria(
    hostid: bigint,
  ): Promise<{ percent: number; used_gb: number; total_gb: number; free_gb: number } | null> {
    const rows = await prisma.$queryRaw<
      Array<{ key_: string; value: number | bigint | null }>
    >`
      SELECT i.key_, COALESCE(hf.value, hu.value) AS value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hf ON true
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hu ON true
      WHERE i.hostid = ${hostid}
        AND i.key_ IN (
          'vm.memory.size[total]',
          'vm.memory.size[available]',
          'vm.memory.size[used]',
          'vm.memory.size[pused]',
          'vm.memory.util'
        )
        AND COALESCE(hf.value, hu.value) IS NOT NULL
    `

    return MetricRepository._montarMemoria(rows)
  }

  /**
   * Regra unificada para montar o objeto de memória:
   * - percent: pused (Linux) OU util (Windows)
   * - bytes usados: available (Linux) OU used (Windows)
   * - free = total - used
   */
  private static _montarMemoria(
    rows: Array<{ key_: string; value: number | bigint | null }>,
  ): { percent: number; used_gb: number; total_gb: number; free_gb: number } | null {
    const pick = (...keys: string[]): number | null => {
      for (const k of keys) {
        const row = rows.find((r) => r.key_ === k)
        if (row?.value != null) return Number(row.value)
      }
      return null
    }

    const total = pick('vm.memory.size[total]')
    const pused = pick('vm.memory.size[pused]', 'vm.memory.util')
    const availItem = pick('vm.memory.size[available]')
    const usedItem = pick('vm.memory.size[used]')

    if (total == null || pused == null) return null

    let used: number
    let avail: number
    if (availItem != null) {
      avail = availItem
      used = total - availItem
    } else if (usedItem != null) {
      used = usedItem
      avail = total - usedItem
    } else {
      return null
    }

    const GB = 1_073_741_824
    return {
      percent: Math.round(pused * 100) / 100,
      used_gb: Math.round((used / GB) * 100) / 100,
      total_gb: Math.round((total / GB) * 100) / 100,
      free_gb: Math.round((avail / GB) * 100) / 100,
    }
  }

  // ============================================================
  // STATUS (UP/DOWN)
  // ============================================================

  static async getStatus(hostid: bigint): Promise<'UP' | 'DOWN'> {
    const rows = await prisma.$queryRaw<Array<{ value: bigint | number | null }>>`
      SELECT u.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) u ON true
      WHERE i.hostid = ${hostid}
        AND i.key_ IN ('icmpping', 'agent.ping')
      ORDER BY CASE WHEN i.key_ = 'icmpping' THEN 1 ELSE 2 END
      LIMIT 1
    `

    const row = rows[0]
    if (row === undefined || row.value == null) return 'DOWN'
    return Number(row.value) === 1 ? 'UP' : 'DOWN'
  }

  // ============================================================
  // UPTIME
  // ============================================================

  static async getUptime(hostid: bigint): Promise<string> {
    const rows = await prisma.$queryRaw<Array<{ value: bigint | number | null }>>`
      SELECT u.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) u ON true
      WHERE i.hostid = ${hostid} AND i.key_ = 'system.uptime'
      LIMIT 1
    `
    const row = rows[0]
    if (row === undefined || row.value == null) return 'N/A'
    return fmtUptime(Number(row.value))
  }

  // ============================================================
  // DISCOS
  // ============================================================

  static async getDiscos(hostid: bigint) {
    const rows = await prisma.$queryRaw<
      Array<{ itemid: bigint; key_: string; value: number | null }>
    >`
      SELECT i.itemid, i.key_, h.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) h ON true
      WHERE i.hostid = ${hostid}
        AND (
          i.key_ LIKE 'vfs.fs.size[%,pused]'
          OR i.key_ LIKE 'vfs.fs.dependent.size[%,pused]'
        )
    `

    const discosPorMount: Record<string, { mount: string; uso: number }> = {}

    for (const item of rows) {
      if (item.value === null) continue
      try {
        const partes = item.key_.split('[')
        const conteudo = partes[1]
        if (!conteudo) continue

        const mount = conteudo.split(',')[0]
        if (!mount || mount in discosPorMount) continue

        discosPorMount[mount] = {
          mount,
          uso: Math.round(Number(item.value) * 100) / 100,
        }
      } catch {
        continue
      }
    }

    return Object.values(discosPorMount)
  }

  // ============================================================
  // TIPO DE HOST
  // ============================================================
  static async detectarTipoHost(hostid: bigint): Promise<{ type: string; name: string } | null> {
    const rows = await prisma.$queryRaw<
      Array<{
        system_items: bigint
        service_items: bigint
        process_items: bigint
        disk_items: bigint
        network_items: bigint
        ping_items: bigint
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE key_ LIKE 'system.%')  AS system_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'service.%') AS service_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'proc.%')    AS process_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'vfs.%')     AS disk_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'net.if.%')  AS network_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'icmpping%') AS ping_items
      FROM items
      WHERE hostid = ${hostid}
    `

    const r = rows[0]
    if (r === undefined) return { type: 'unknown', name: 'Desconhecido' }

    const s = Number(r.system_items)
    const svc = Number(r.service_items)
    const p = Number(r.process_items)
    const d = Number(r.disk_items)
    const n = Number(r.network_items)
    const ping = Number(r.ping_items)

    if (ping > 0 && s === 0 && svc === 0 && p === 0 && d === 0 && n === 0) {
      return { type: 'network', name: 'Link/VPN' }
    }
    return null
  }

  // ============================================================
  // HOST COMPLETO — 1 query com CTEs
  // ============================================================
  static async getHostCompleto(hostid: bigint): Promise<{
    status: 'UP' | 'DOWN'
    cpu: { used: number; free: number; total: number } | null
    memoria: { percent: number; used_gb: number; total_gb: number; free_gb: number } | null
    uptime_segundos: number | null
    os: { type: 'windows' | 'linux'; name: string } | null
    discos: Array<{ mount: string; uso: number }>
    services: Array<{ itemid: string; name: string; key_: string; status: string | null }>
  }> {
    const rows = await prisma.$queryRaw<Array<{
      status_item: { key: string; value: number } | null
      cpu_item: { key: string; value: number } | null
      mem_total: number | null
      mem_pused: number | null
      mem_util: number | null
      mem_avail: number | null
      mem_used: number | null
      uptime: number | null
      sw_os: string | null
      uname: string | null
      discos: Array<{ itemid: string; key_: string; value: number }>
      services: Array<{ itemid: string; name: string; key_: string; value: number | null }>
    }>>`
      WITH
      status_item AS (
        SELECT i.key_, u.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostid}
          AND i.key_ IN ('icmpping', 'agent.ping')
        ORDER BY CASE WHEN i.key_ = 'icmpping' THEN 1 ELSE 2 END
        LIMIT 1
      ),
      cpu_item AS (
        SELECT i.key_, COALESCE(hf.value, hu.value) AS value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hf ON true
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hu ON true
        WHERE i.hostid = ${hostid}
          AND (
            i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
            OR i.key_ LIKE 'system.cpu.util%'
          )
          AND COALESCE(hf.value, hu.value) IS NOT NULL
        ORDER BY
          CASE
            WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
            WHEN i.key_ = 'system.cpu.util[,idle]' THEN 2
            WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 3
            ELSE 4
          END
        LIMIT 1
      ),
      mem AS (
        SELECT
          MAX(CASE WHEN i.key_ = 'vm.memory.size[total]'     THEN COALESCE(hf.value, hu.value) END)::bigint  AS total,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[available]' THEN COALESCE(hf.value, hu.value) END)::bigint  AS avail,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[used]'      THEN COALESCE(hf.value, hu.value) END)::bigint  AS used,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[pused]'     THEN COALESCE(hf.value, hu.value) END)::numeric AS pused,
          MAX(CASE WHEN i.key_ = 'vm.memory.util'            THEN COALESCE(hf.value, hu.value) END)::numeric AS util
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hf ON true
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hu ON true
        WHERE i.hostid = ${hostid}
          AND i.key_ IN (
            'vm.memory.size[total]',
            'vm.memory.size[available]',
            'vm.memory.size[used]',
            'vm.memory.size[pused]',
            'vm.memory.util'
          )
      ),
      uptime AS (
        SELECT u.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostid} AND i.key_ = 'system.uptime'
        LIMIT 1
      ),
      os_info AS (
        SELECT i.key_, hs.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_str WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hs ON true
        WHERE i.hostid = ${hostid}
          AND i.key_ IN ('system.sw.os', 'system.uname')
      ),
      discos AS (
        SELECT json_agg(json_build_object(
          'itemid', i.itemid::text,
          'key_', i.key_,
          'value', h.value
        )) AS lista
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) h ON true
        WHERE i.hostid = ${hostid}
          AND (i.key_ LIKE 'vfs.fs.size[%,pused]' OR i.key_ LIKE 'vfs.fs.dependent.size[%,pused]')
          AND h.value IS NOT NULL
      ),
      services AS (
        SELECT json_agg(json_build_object(
          'itemid', i.itemid::text,
          'name', i.name,
          'key_', i.key_,
          'value', u.value
        )) AS lista
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostid}
          AND i.status = 0
          AND (i.key_ LIKE 'service.info%' OR i.key_ LIKE 'systemd.unit%')
          AND i.key_ NOT LIKE 'proc.num%'
          AND i.name NOT ILIKE '%discovery%'
          AND i.name NOT ILIKE '{#%'
      )
      SELECT
        (SELECT row_to_json(status_item) FROM status_item) AS status_item,
        (SELECT row_to_json(cpu_item) FROM cpu_item) AS cpu_item,
        (SELECT total FROM mem) AS mem_total,
        (SELECT pused FROM mem) AS mem_pused,
        (SELECT util  FROM mem) AS mem_util,
        (SELECT avail FROM mem) AS mem_avail,
        (SELECT used  FROM mem) AS mem_used,
        (SELECT value FROM uptime) AS uptime,
        (SELECT value FROM os_info WHERE key_ = 'system.sw.os') AS sw_os,
        (SELECT value FROM os_info WHERE key_ = 'system.uname') AS uname,
        (SELECT lista FROM discos) AS discos,
        (SELECT lista FROM services) AS services
    `

    const r = rows[0]
    if (!r) throw new Error('Host não encontrado')

    // Status
    let status: 'UP' | 'DOWN' = 'DOWN'
    if (r.status_item && r.status_item.value === 1) status = 'UP'

    // CPU
    let cpu = null
    if (r.cpu_item && r.cpu_item.value !== null) {
      const numValue = Number(r.cpu_item.value)
      const used = r.cpu_item.key.toLowerCase().includes('idle') ? 100 - numValue : numValue
      const clamped = Math.max(0, Math.min(100, used))
      cpu = {
        used: Math.round(clamped * 10) / 10,
        free: Math.round((100 - clamped) * 10) / 10,
        total: 100,
      }
    }

    // Memória — monta via helper unificado
    const memoria = MetricRepository._montarMemoria([
      { key_: 'vm.memory.size[total]',     value: r.mem_total },
      { key_: 'vm.memory.size[pused]',     value: r.mem_pused },
      { key_: 'vm.memory.util',            value: r.mem_util },
      { key_: 'vm.memory.size[available]', value: r.mem_avail },
      { key_: 'vm.memory.size[used]',      value: r.mem_used },
    ])

    // SO
    let os = null
    if (r.sw_os) {
      os = {
        type: r.sw_os.toLowerCase().includes('windows') ? 'windows' as const : 'linux' as const,
        name: r.sw_os,
      }
    } else if (r.uname) {
      os = { type: 'linux' as const, name: 'Linux' }
    }

    // Discos (deduplica por mount)
    const discosPorMount = new Map<string, { mount: string; uso: number }>()
    if (r.discos) {
      for (const d of r.discos) {
        try {
          const mount = d.key_.split('[')[1]?.split(',')[0]
          if (!mount || discosPorMount.has(mount)) continue
          discosPorMount.set(mount, {
            mount,
            uso: Math.round(Number(d.value) * 100) / 100,
          })
        } catch { continue }
      }
    }

    // Serviços
    const services = (r.services ?? []).map((s) => ({
      itemid: s.itemid,
      name: s.name,
      key_: s.key_,
      status: s.value !== null && s.value !== undefined
        ? (Number(s.value) > 0 ? 'ON' : 'OFF')
        : null,
    }))

    return {
      status,
      cpu,
      memoria,
      uptime_segundos: r.uptime !== null ? Number(r.uptime) : null,
      os,
      discos: Array.from(discosPorMount.values()),
      services,
    }
  }

  // ============================================================
  // BATCH
  // ============================================================

  static async getStatusBatch(hostids: bigint[]): Promise<Map<string, 'UP' | 'DOWN'>> {
    const result = new Map<string, 'UP' | 'DOWN'>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; value: number | bigint | null }>
    >(
      `SELECT DISTINCT ON (i.hostid)
        i.hostid, u.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint
        WHERE itemid = i.itemid
        ORDER BY clock DESC LIMIT 1
      ) u ON true
      WHERE i.hostid IN (${placeholders})
        AND i.key_ IN ('icmpping', 'agent.ping')
      ORDER BY i.hostid,
        CASE WHEN i.key_ = 'icmpping' THEN 1 ELSE 2 END`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, 'DOWN')
    for (const r of rows) {
      const v = r.value
      result.set(r.hostid.toString(), v != null && Number(v) === 1 ? 'UP' : 'DOWN')
    }

    return result
  }

  static async getCpuBatch(
    hostids: bigint[],
  ): Promise<Map<string, { used: number; free: number; total: number } | null>> {
    const result = new Map<string, { used: number; free: number; total: number } | null>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; key_: string; value: number | null }>
    >(
      `SELECT DISTINCT ON (i.hostid)
        i.hostid, i.key_, COALESCE(hf.value, hu.value) AS value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hf ON true
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hu ON true
      WHERE i.hostid IN (${placeholders})
        AND (
          i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
          OR i.key_ LIKE 'system.cpu.util%'
        )
        AND COALESCE(hf.value, hu.value) IS NOT NULL
      ORDER BY i.hostid,
        CASE
          WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
          WHEN i.key_ = 'system.cpu.util[,idle]' THEN 2
          WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 3
          ELSE 4
        END`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, null)
    for (const r of rows) {
      if (r.value === null) continue
      const numValue = Number(r.value)
      const used = r.key_.toLowerCase().includes('idle') ? 100 - numValue : numValue
      const clamped = Math.max(0, Math.min(100, used))
      result.set(r.hostid.toString(), {
        used: Math.round(clamped * 10) / 10,
        free: Math.round((100 - clamped) * 10) / 10,
        total: 100,
      })
    }
    return result
  }

  static async getMemoriaBatch(
    hostids: bigint[],
  ): Promise<Map<string, { percent: number; used_gb: number; total_gb: number; free_gb: number } | null>> {
    const result = new Map<string, { percent: number; used_gb: number; total_gb: number; free_gb: number } | null>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; key_: string; value: number | bigint | null }>
    >(
      `SELECT i.hostid, i.key_, COALESCE(hf.value, hu.value) AS value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history      WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hf ON true
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hu ON true
      WHERE i.hostid IN (${placeholders})
        AND i.key_ IN (
          'vm.memory.size[total]',
          'vm.memory.size[available]',
          'vm.memory.size[used]',
          'vm.memory.size[pused]',
          'vm.memory.util'
        )
        AND COALESCE(hf.value, hu.value) IS NOT NULL`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, null)

    const porHost = new Map<string, Array<{ key_: string; value: number | bigint | null }>>()
    for (const id of idsStr) porHost.set(id, [])
    for (const r of rows) {
      porHost.get(r.hostid.toString())?.push({ key_: r.key_, value: r.value })
    }

    for (const [id, arr] of porHost) {
      const m = MetricRepository._montarMemoria(arr)
      if (m) result.set(id, m)
    }
    return result
  }

  static async getUptimeBatch(hostids: bigint[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; value: bigint | number | null }>
    >(
      `SELECT DISTINCT ON (i.hostid)
        i.hostid, u.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint
        WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) u ON true
      WHERE i.hostid IN (${placeholders})
        AND i.key_ = 'system.uptime'
      ORDER BY i.hostid`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, null)
    for (const r of rows) {
      if (r.value !== null && r.value !== undefined) {
        result.set(r.hostid.toString(), Number(r.value))
      }
    }
    return result
  }

  static async getOsBatch(
    hostids: bigint[],
  ): Promise<Map<string, { type: 'windows' | 'linux'; name: string } | null>> {
    const result = new Map<string, { type: 'windows' | 'linux'; name: string } | null>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; key_: string; value: string | null }>
    >(
      `SELECT i.hostid, i.key_, hs.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_str
        WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) hs ON true
      WHERE i.hostid IN (${placeholders})
        AND i.key_ IN ('system.sw.os', 'system.uname')`,
      ...idsStr,
    )

    const porHost = new Map<string, { sw_os: string | null; uname: string | null }>()
    for (const id of idsStr) porHost.set(id, { sw_os: null, uname: null })
    for (const r of rows) {
      const cur = porHost.get(r.hostid.toString())
      if (!cur) continue
      if (r.key_ === 'system.sw.os') cur.sw_os = r.value
      if (r.key_ === 'system.uname') cur.uname = r.value
    }

    for (const [id, v] of porHost) {
      if (v.sw_os) {
        result.set(id, {
          type: v.sw_os.toLowerCase().includes('windows') ? 'windows' : 'linux',
          name: v.sw_os,
        })
      } else if (v.uname) {
        result.set(id, { type: 'linux', name: 'Linux' })
      } else {
        result.set(id, null)
      }
    }

    return result
  }

  static async getDiscosBatch(
    hostids: bigint[],
  ): Promise<Map<string, Array<{ mount: string; uso: number }>>> {
    const result = new Map<string, Array<{ mount: string; uso: number }>>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; key_: string; value: number | null }>
    >(
      `SELECT i.hostid, i.key_, h.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history
        WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
      ) h ON true
      WHERE i.hostid IN (${placeholders})
        AND (
          i.key_ LIKE 'vfs.fs.size[%,pused]'
          OR i.key_ LIKE 'vfs.fs.dependent.size[%,pused]'
        )
        AND h.value IS NOT NULL`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, [])
    const vistos = new Map<string, Set<string>>()
    for (const id of idsStr) vistos.set(id, new Set())

    for (const r of rows) {
      if (r.value === null) continue
      const id = r.hostid.toString()
      const vistosHost = vistos.get(id)!
      try {
        const mount = r.key_.split('[')[1]?.split(',')[0]
        if (!mount || vistosHost.has(mount)) continue
        vistosHost.add(mount)
        result.get(id)!.push({
          mount,
          uso: Math.round(Number(r.value) * 100) / 100,
        })
      } catch { continue }
    }

    return result
  }

  static async getTipoHostBatch(
    hostids: bigint[],
  ): Promise<Map<string, 'network' | null>> {
    const result = new Map<string, 'network' | null>()
    if (hostids.length === 0) return result

    const idsStr = hostids.map((h) => h.toString())
    const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        hostid: bigint
        system_items: bigint
        service_items: bigint
        process_items: bigint
        disk_items: bigint
        network_items: bigint
        ping_items: bigint
      }>
    >(
      `SELECT
        hostid,
        COUNT(*) FILTER (WHERE key_ LIKE 'system.%')  AS system_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'service.%') AS service_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'proc.%')    AS process_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'vfs.%')     AS disk_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'net.if.%')  AS network_items,
        COUNT(*) FILTER (WHERE key_ LIKE 'icmpping%') AS ping_items
      FROM items
      WHERE hostid IN (${placeholders})
      GROUP BY hostid`,
      ...idsStr,
    )

    for (const id of idsStr) result.set(id, null)
    for (const r of rows) {
      const s = Number(r.system_items)
      const svc = Number(r.service_items)
      const p = Number(r.process_items)
      const d = Number(r.disk_items)
      const n = Number(r.network_items)
      const ping = Number(r.ping_items)
      if (ping > 0 && s === 0 && svc === 0 && p === 0 && d === 0 && n === 0) {
        result.set(r.hostid.toString(), 'network')
      }
    }

    return result
  }

  // ==========================================================
  // ACTIVE SERVICES
  // ==========================================================
  static async getActiveServices(hostid: bigint | number): Promise<
    Array<{ id: string; description: string; severity: number }>
  > {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ triggerid: bigint; description: string; severity: number }>
    >`
      SELECT t.triggerid, t.description, t.priority AS severity
      FROM triggers t
      WHERE t.status = 0
        AND t.priority >= 2
        AND EXISTS (
          SELECT 1
          FROM functions f
          JOIN items i ON i.itemid = f.itemid
          WHERE f.triggerid = t.triggerid
            AND i.hostid = ${hostIdBig}
        )
      ORDER BY t.priority DESC, t.description
    `

    return rows.map((r) => ({
      id: r.triggerid.toString(),
      description: r.description,
      severity: Number(r.severity),
    }))
  }

  // ==========================================================
  // STATUS PING/UPTIME DE TODOS
  // ==========================================================
  static async getStatusPingUptimeAll(): Promise<
    Array<{
      hostid: string
      status: 'UP' | 'DOWN' | 'DISABLED' | 'UNKNOWN'
      host_status: 'ENABLED' | 'DISABLED'
      icmp_ping: number | null
      ping_available: boolean
      latency_ms: number | null
      uptime_seconds: number | null
      uptime_days: number | null
      uptime_available: boolean
    }>
  > {
    const rows = await prisma.$queryRaw<
      Array<{
        hostid: bigint
        host_status: number
        icmp_ping: number | null
        latency_seconds: number | null
        uptime_seconds: bigint | number | null
      }>
    >`
      WITH
      pings AS (
        SELECT i.hostid, u.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history_uint
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.key_ = 'icmpping'
      ),
      latencias AS (
        SELECT i.hostid, h.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) h ON true
        WHERE i.key_ = 'icmppingsec'
      ),
      uptimes AS (
        SELECT i.hostid, u.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history_uint
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.key_ = 'system.uptime'
      )
      SELECT
        h.hostid,
        h.status AS host_status,
        p.value AS icmp_ping,
        l.value AS latency_seconds,
        u.value AS uptime_seconds
      FROM hosts h
      LEFT JOIN pings p     ON p.hostid = h.hostid
      LEFT JOIN latencias l ON l.hostid = h.hostid
      LEFT JOIN uptimes u   ON u.hostid = h.hostid
      ORDER BY h.host
    `

    return rows.map((r) => {
      const hostEnabled = Number(r.host_status) === 0
      const icmp = r.icmp_ping !== null ? Number(r.icmp_ping) : null

      let status: 'UP' | 'DOWN' | 'DISABLED' | 'UNKNOWN'
      if (!hostEnabled) status = 'DISABLED'
      else if (icmp !== null) status = icmp === 1 ? 'UP' : 'DOWN'
      else status = 'UNKNOWN'

      const lat = r.latency_seconds !== null ? Number(r.latency_seconds) : null
      const up = r.uptime_seconds !== null ? Number(r.uptime_seconds) : null

      return {
        hostid: r.hostid.toString(),
        status,
        host_status: hostEnabled ? 'ENABLED' : 'DISABLED',
        icmp_ping: icmp,
        ping_available: icmp !== null,
        latency_ms: lat !== null ? Math.round(lat * 1000 * 100) / 100 : null,
        uptime_seconds: up,
        uptime_days: up !== null ? Math.round((up / 86400) * 100) / 100 : null,
        uptime_available: up !== null,
      }
    })
  }

  // ==========================================================
  // BUSCAR ITEMID + TYPE (com cache)
  // ==========================================================
  private static itemIdCache = new Map<string, { itemid: bigint; value_type: number } | null>()

  static async getItemIdAndType(
    hostid: bigint | number,
    itemKey: string,
  ): Promise<{ itemid: bigint; value_type: number } | null> {
    const cacheKey = `${hostid}:${itemKey}`
    if (MetricRepository.itemIdCache.has(cacheKey)) {
      return MetricRepository.itemIdCache.get(cacheKey)!
    }

    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ itemid: bigint; value_type: number }>
    >`
      SELECT itemid, value_type
      FROM items
      WHERE hostid = ${hostIdBig}
        AND key_ = ${itemKey}
      LIMIT 1
    `

    const result = rows[0]
      ? { itemid: rows[0].itemid, value_type: Number(rows[0].value_type) }
      : null

    MetricRepository.itemIdCache.set(cacheKey, result)
    return result
  }

  // ==========================================================
  // SÉRIE POR KEY
  // ==========================================================
  static async getSeriePorKey(
    hostid: bigint | number,
    itemKey: string,
    inicio: string,
    fim: string,
  ): Promise<Array<{ data: Date | string; value: number }>> {
    const { isoParaTimestamp } = await import('../utils/helpers.js')

    const item = await MetricRepository.getItemIdAndType(hostid, itemKey)
    if (!item) return []

    const inicioTs = isoParaTimestamp(inicio)
    const fimTs = isoParaTimestamp(fim)

    const tabela = item.value_type === 3 ? 'history_uint' : 'history'

    const rows = await prisma.$queryRawUnsafe<
      Array<{ data: Date | string; value: string | number | bigint }>
    >(
      `SELECT to_timestamp(clock) AS data, value
       FROM ${tabela}
       WHERE itemid = $1
         AND clock BETWEEN $2 AND $3
       ORDER BY clock`,
      item.itemid,
      inicioTs,
      fimTs,
    )

    return rows.map((r) => ({ data: r.data, value: Number(r.value) }))
  }

  // ==========================================================
  // RESUMO POR ITEM
  // ==========================================================
  static async getResumoPorItem(
    itemid: bigint,
    inicio: string,
    fim: string,
    tabela: 'history' | 'history_uint' = 'history',
  ): Promise<{ min: number | null; avg: number | null; max: number | null } | null> {
    const { isoParaTimestamp } = await import('../utils/helpers.js')
    const inicioTs = isoParaTimestamp(inicio)
    const fimTs = isoParaTimestamp(fim)

    const rows = await prisma.$queryRawUnsafe<
      Array<{ min: string | null; avg: string | null; max: string | null }>
    >(
      `SELECT
         MIN(value)::numeric AS min,
         AVG(value)::numeric AS avg,
         MAX(value)::numeric AS max
       FROM ${tabela}
       WHERE itemid = $1
         AND clock BETWEEN $2 AND $3`,
      itemid,
      inicioTs,
      fimTs,
    )

    const r = rows[0]
    if (!r) return null

    return {
      min: r.min !== null ? Math.round(Number(r.min) * 100) / 100 : null,
      avg: r.avg !== null ? Math.round(Number(r.avg) * 100) / 100 : null,
      max: r.max !== null ? Math.round(Number(r.max) * 100) / 100 : null,
    }
  }

  // ==========================================================
  // ITENS (amostra)
  // ==========================================================
  static async listarItensAmostra(
    hostid?: bigint | number,
    limit = 10,
  ): Promise<Array<{ host: string; item: string; key_: string }>> {
    if (hostid !== undefined) {
      const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
      const rows = await prisma.$queryRaw<
        Array<{ host: string; item: string; key_: string }>
      >`
        SELECT h.host, i.name AS item, i.key_
        FROM items i
        JOIN hosts h ON h.hostid = i.hostid
        WHERE i.status = 0
          AND i.hostid = ${hostIdBig}
        LIMIT ${limit}
      `
      return rows
    }

    const rows = await prisma.$queryRaw<
      Array<{ host: string; item: string; key_: string }>
    >`
      SELECT h.host, i.name AS item, i.key_
      FROM items i
      JOIN hosts h ON h.hostid = i.hostid
      WHERE i.status = 0
      LIMIT ${limit}
    `
    return rows
  }

  // ==========================================================
  // STATUS PING/UPTIME DE UM HOST
  // ==========================================================
  static async getStatusPingUptime(hostid: bigint | number): Promise<{
    hostid: string
    status: 'UP' | 'DOWN' | 'DISABLED' | 'UNKNOWN'
    host_status: 'ENABLED' | 'DISABLED'
    icmp_ping: number | null
    ping_available: boolean
    latency_ms: number | null
    uptime_seconds: number | null
    uptime_days: number | null
    uptime_available: boolean
  }> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{
        hostid: bigint
        host_status: number
        icmp_ping: number | null
        latency_seconds: number | null
        uptime_seconds: bigint | number | null
      }>
    >`
      WITH
      pings AS (
        SELECT u.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history_uint
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostIdBig}
          AND i.key_ = 'icmpping'
        LIMIT 1
      ),
      latencias AS (
        SELECT h.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) h ON true
        WHERE i.hostid = ${hostIdBig}
          AND i.key_ = 'icmppingsec'
        LIMIT 1
      ),
      uptimes AS (
        SELECT u.value
        FROM items i
        JOIN LATERAL (
          SELECT value FROM history_uint
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostIdBig}
          AND i.key_ = 'system.uptime'
        LIMIT 1
      )
      SELECT
        h.hostid,
        h.status AS host_status,
        (SELECT value FROM pings) AS icmp_ping,
        (SELECT value FROM latencias) AS latency_seconds,
        (SELECT value FROM uptimes) AS uptime_seconds
      FROM hosts h
      WHERE h.hostid = ${hostIdBig}
      LIMIT 1
    `

    const r = rows[0]
    if (!r) {
      return {
        hostid: hostIdBig.toString(),
        status: 'UNKNOWN',
        host_status: 'DISABLED',
        icmp_ping: null,
        ping_available: false,
        latency_ms: null,
        uptime_seconds: null,
        uptime_days: null,
        uptime_available: false,
      }
    }

    const hostEnabled = Number(r.host_status) === 0
    const icmp = r.icmp_ping !== null ? Number(r.icmp_ping) : null

    let status: 'UP' | 'DOWN' | 'DISABLED' | 'UNKNOWN'
    if (!hostEnabled) status = 'DISABLED'
    else if (icmp !== null) status = icmp === 1 ? 'UP' : 'DOWN'
    else status = 'UNKNOWN'

    const lat = r.latency_seconds !== null ? Number(r.latency_seconds) : null
    const up = r.uptime_seconds !== null ? Number(r.uptime_seconds) : null

    return {
      hostid: r.hostid.toString(),
      status,
      host_status: hostEnabled ? 'ENABLED' : 'DISABLED',
      icmp_ping: icmp,
      ping_available: icmp !== null,
      latency_ms: lat !== null ? Math.round(lat * 1000 * 100) / 100 : null,
      uptime_seconds: up,
      uptime_days: up !== null ? Math.round((up / 86400) * 100) / 100 : null,
      uptime_available: up !== null,
    }
  }
}