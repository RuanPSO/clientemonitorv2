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

  /**
   * Batch: últimos valores de vários items de uma vez.
   * Faz no máximo 3 queries (uma por tipo presente).
   * Retorna Map<itemidString, value>.
   */
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

  /**
   * Mantido para compatibilidade. Agora não é mais chamado internamente
   * (detectarSo unifica sw.os + uname em 1 query), mas outros módulos podem usar.
   */
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

  /**
   * Detecta SO unificando sw.os + uname em 1 query (antes eram 2-3).
   * Fallback para disco C: apenas se ambos vierem vazios.
   */
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

  /**
   * Retorna apenas o itemid da CPU (usado pelo ReportRepository).
   */
  static async getCpuItemid(hostid: bigint | number): Promise<bigint | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const item = await MetricRepository._getCpuItem(hostIdBig)
    return item ? item.itemid : null
  }

  /**
   * 1 query única para achar o item de CPU, respeitando prioridade
   * (Windows perf_counter > Linux system.cpu.util[all,,avg1] > fallback).
   */
  static async _getCpuItem(hostid: bigint): Promise<{ itemid: bigint; key_: string } | null> {
    const rows = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT i.itemid, i.key_
      FROM items i
      WHERE i.hostid = ${hostid}
        AND (
          i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
          OR i.key_ = 'system.cpu.util[all,,avg1]'
          OR i.key_ LIKE 'system.cpu.util%'
        )
      ORDER BY
        CASE
          WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
          WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 2
          ELSE 3
        END
      LIMIT 1
    `
    return rows[0] ?? null
  }

  /**
   * getCpu — 1 query única (antes: 3 buscando item + 1 valor).
   */
  static async getCpu(hostid: bigint) {
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
          i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
          OR i.key_ = 'system.cpu.util[all,,avg1]'
          OR i.key_ LIKE 'system.cpu.util%'
        )
      ORDER BY
        CASE
          WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
          WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 2
          ELSE 3
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
  // MEMÓRIA
  // ============================================================

  /**
   * getMemoria — 2 queries (antes: 3 buscando itemid + 3 valor).
   *  1ª: pused (float → history)
   *  2ª: total + available (int → history_uint)
   */
  static async getMemoria(hostid: bigint) {
    const pusedRows = await prisma.$queryRaw<Array<{ value: number | null }>>`
      SELECT h.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) h ON true
      WHERE i.hostid = ${hostid}
        AND i.key_ = 'vm.memory.size[pused]'
      LIMIT 1
    `

    const intRows = await prisma.$queryRaw<
      Array<{ key_: string; value: bigint | number | null }>
    >`
      SELECT i.key_, u.value
      FROM items i
      LEFT JOIN LATERAL (
        SELECT value FROM history_uint
        WHERE itemid = i.itemid
        ORDER BY clock DESC
        LIMIT 1
      ) u ON true
      WHERE i.hostid = ${hostid}
        AND i.key_ IN ('vm.memory.size[total]', 'vm.memory.size[available]')
    `

    const pused = pusedRows[0]?.value
    const total = intRows.find((r) => r.key_ === 'vm.memory.size[total]')?.value
    const avail = intRows.find((r) => r.key_ === 'vm.memory.size[available]')?.value

    if (pused == null || total == null || avail == null) return null

    const totalNum = Number(total)
    const availNum = Number(avail)
    const pusedNum = Number(pused)
    const used = totalNum - availNum
    const GB = 1_073_741_824

    return {
      percent: Math.round(pusedNum * 100) / 100,
      used_gb: Math.round((used / GB) * 100) / 100,
      total_gb: Math.round((totalNum / GB) * 100) / 100,
      free_gb: Math.round((availNum / GB) * 100) / 100,
    }
  }

  // ============================================================
  // STATUS (UP/DOWN)
  // ============================================================

  /**
   * getStatus — 1 query única (antes: 1-2 buscando itemid + 1-2 valor).
   * Prioridade: icmpping > agent.ping.
   */
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

  /**
   * getUptime — 1 query única (antes: 1 itemid + 1 valor).
   */
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

  /**
   * getDiscos — 1 query única (antes: 1 + até 2N).
   * Junta itens de disco + último valor de history via LATERAL.
   * Deduplica por mount (vfs.fs.size vs vfs.fs.dependent.size).
   */
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
  // TIPO DE HOST (network vs servidor)
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

  // repositories/metric.repository.ts — adicione este método

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
      mem_avail: number | null
      uptime: number | null
      sw_os: string | null
      uname: string | null
      discos: Array<{ itemid: string; key_: string; value: number }>
      services: Array<{ itemid: string; name: string; key_: string; value: number | null }>
    }>>`
      WITH
      -- Status (icmpping > agent.ping)
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
      -- CPU
      cpu_item AS (
        SELECT i.key_, h.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) h ON true
        WHERE i.hostid = ${hostid}
          AND (
            i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
            OR i.key_ = 'system.cpu.util[all,,avg1]'
            OR i.key_ LIKE 'system.cpu.util%'
          )
        ORDER BY
          CASE
            WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
            WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 2
            ELSE 3
          END
        LIMIT 1
      ),
      -- Memória
      mem AS (
        SELECT
          MAX(CASE WHEN i.key_ = 'vm.memory.size[total]' THEN u.value END)::bigint AS total,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[pused]' THEN h.value END)::numeric AS pused,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[available]' THEN u.value END)::bigint AS avail
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) h ON true
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostid}
          AND i.key_ IN ('vm.memory.size[total]', 'vm.memory.size[pused]', 'vm.memory.size[available]')
      ),
      -- Uptime
      uptime AS (
        SELECT u.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid = ${hostid} AND i.key_ = 'system.uptime'
        LIMIT 1
      ),
      -- SO
      os_info AS (
        SELECT i.key_, hs.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history_str WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) hs ON true
        WHERE i.hostid = ${hostid}
          AND i.key_ IN ('system.sw.os', 'system.uname')
      ),
      -- Discos (agregados em JSON)
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
      -- Serviços (agregados em JSON)
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
        (SELECT avail FROM mem) AS mem_avail,
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

    // Memória
    let memoria = null
    if (r.mem_total !== null && r.mem_pused !== null && r.mem_avail !== null) {
      const GB = 1_073_741_824
      const totalNum = Number(r.mem_total)
      const availNum = Number(r.mem_avail)
      const used = totalNum - availNum
      memoria = {
        percent: Math.round(Number(r.mem_pused) * 100) / 100,
        used_gb: Math.round((used / GB) * 100) / 100,
        total_gb: Math.round((totalNum / GB) * 100) / 100,
        free_gb: Math.round((availNum / GB) * 100) / 100,
      }
    }

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
    // BATCH — busca dados de MÚLTIPLOS hosts em poucas queries
    // ============================================================

    /**
     * STATUS em lote — 1 query para todos os hosts.
     * Retorna Map<hostidString, 'UP'|'DOWN'>
     */
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

      // Default: DOWN para todos
      for (const id of idsStr) result.set(id, 'DOWN')
      // Sobrescreve com valores encontrados
      for (const r of rows) {
        const v = r.value
        result.set(r.hostid.toString(), v != null && Number(v) === 1 ? 'UP' : 'DOWN')
      }

      return result
    }

    /**
     * CPU em lote — 1 query para todos os hosts.
     */
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
          i.hostid, i.key_, h.value
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history
          WHERE itemid = i.itemid
          ORDER BY clock DESC LIMIT 1
        ) h ON true
        WHERE i.hostid IN (${placeholders})
          AND (
            i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
            OR i.key_ = 'system.cpu.util[all,,avg1]'
            OR i.key_ LIKE 'system.cpu.util%'
          )
        ORDER BY i.hostid,
          CASE
            WHEN i.key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]' THEN 1
            WHEN i.key_ = 'system.cpu.util[all,,avg1]' THEN 2
            ELSE 3
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

    /**
     * MEMÓRIA em lote — 1 query para todos os hosts.
     */
    static async getMemoriaBatch(
      hostids: bigint[],
    ): Promise<Map<string, { percent: number; used_gb: number; total_gb: number; free_gb: number } | null>> {
      const result = new Map<string, any>()
      if (hostids.length === 0) return result

      const idsStr = hostids.map((h) => h.toString())
      const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

      const rows = await prisma.$queryRawUnsafe<
        Array<{
          hostid: bigint
          total: bigint | null
          pused: number | null
          avail: bigint | null
        }>
      >(
        `SELECT
          i.hostid,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[total]' THEN u.value END)::bigint AS total,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[pused]' THEN h.value END)::numeric AS pused,
          MAX(CASE WHEN i.key_ = 'vm.memory.size[available]' THEN u.value END)::bigint AS avail
        FROM items i
        LEFT JOIN LATERAL (
          SELECT value FROM history WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) h ON true
        LEFT JOIN LATERAL (
          SELECT value FROM history_uint WHERE itemid = i.itemid ORDER BY clock DESC LIMIT 1
        ) u ON true
        WHERE i.hostid IN (${placeholders})
          AND i.key_ IN ('vm.memory.size[total]', 'vm.memory.size[pused]', 'vm.memory.size[available]')
        GROUP BY i.hostid`,
        ...idsStr,
      )

      for (const id of idsStr) result.set(id, null)
      const GB = 1_073_741_824
      for (const r of rows) {
        if (r.total === null || r.pused === null || r.avail === null) continue
        const totalNum = Number(r.total)
        const availNum = Number(r.avail)
        const used = totalNum - availNum
        result.set(r.hostid.toString(), {
          percent: Math.round(Number(r.pused) * 100) / 100,
          used_gb: Math.round((used / GB) * 100) / 100,
          total_gb: Math.round((totalNum / GB) * 100) / 100,
          free_gb: Math.round((availNum / GB) * 100) / 100,
        })
      }
      return result
    }

    /**
     * UPTIME em lote — 1 query.
     */
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

    /**
     * SO em lote — 1 query.
     */
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

      // Agrupa por host
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

    /**
     * DISCOS em lote — 1 query.
     * Retorna Map<hostidString, Array<{ mount, uso }>>
     */
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
      const vistos = new Map<string, Set<string>>() // hostid -> set de mounts
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

    /**
     * TIPO DE HOST em lote — 1 query para todos.
     * Retorna Map<hostidString, 'network'|null>
     */
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
}
