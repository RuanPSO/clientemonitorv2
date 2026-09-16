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
  // Helper: último valor de um item (substitui get_last_value do Python)
  // Precisa de $queryRawUnsafe porque o nome da tabela é dinâmico.
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
    const swOs = await MetricRepository.getSystemSwOs(hostid)
    if (swOs) {
      return { type: swOs.toLowerCase().includes('windows') ? 'windows' : 'linux', name: swOs }
    }

    const uname = await MetricRepository.getSystemUname(hostid)
    if (uname) return { type: 'linux', name: 'Linux' }

    if (await MetricRepository.hasWindowsDisk(hostid)) {
      return { type: 'windows', name: 'Windows' }
    }

    return { type: 'linux', name: 'Linux' }
  }

  // retorna { itemid, key_ }
  static async getCpuItemid(hostid: bigint | number): Promise<bigint | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const item = await MetricRepository._getCpuItem(hostIdBig)
    return item ? item.itemid : null
  }  
  // ============================================================
  // CPU
  // ============================================================
  static async _getCpuItem(hostid: bigint): Promise<{ itemid: bigint; key_: string } | null> {
    // Windows (atenção aos escapes das barras invertidas)
    let rows = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT itemid, key_
      FROM items
      WHERE hostid = ${hostid}
        AND key_ = 'perf_counter[\\Processor Information(_Total)\\% Processor Utility]'
      LIMIT 1
    `
    const windowsItem = rows[0]
    if (windowsItem) return windowsItem

    // Linux padrão
    rows = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT itemid, key_
      FROM items
      WHERE hostid = ${hostid} AND key_ = 'system.cpu.util[all,,avg1]'
      LIMIT 1
    `
    const linuxItem = rows[0]
    if (linuxItem) return linuxItem

    // Fallback
    rows = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT itemid, key_
      FROM items
      WHERE hostid = ${hostid} AND key_ LIKE 'system.cpu.util%'
      LIMIT 1
    `
    return rows[0] ?? null
  }

  static async getCpu(hostid: bigint) {
    const item = await MetricRepository._getCpuItem(hostid)
    if (!item) return null

    const value = await MetricRepository.getLastValue(item.itemid, 'float')
    if (value === null) return null

    const numValue = Number(value)
    const used = item.key_.toLowerCase().includes('idle') ? 100 - numValue : numValue
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
  static async getMemoria(hostid: bigint) {
    const keys = {
      total: 'vm.memory.size[total]',
      pused: 'vm.memory.size[pused]',
      avail: 'vm.memory.size[available]',
    }

    const itemids: Partial<Record<keyof typeof keys, bigint>> = {}
    for (const nome of ['total', 'pused', 'avail'] as const) {
      const key = keys[nome]
      const rows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
        SELECT itemid FROM items WHERE hostid = ${hostid} AND key_ = ${key} LIMIT 1
      `
      const row = rows[0]
      if (!row) return null
      itemids[nome] = row.itemid
    }

    const totalItemid = itemids.total
    const pusedItemid = itemids.pused
    const availItemid = itemids.avail

    if (totalItemid === undefined || pusedItemid === undefined || availItemid === undefined) {
      return null
    }

    const total = await MetricRepository.getLastValue(totalItemid, 'int')
    const pused = await MetricRepository.getLastValue(pusedItemid, 'float')
    const avail = await MetricRepository.getLastValue(availItemid, 'int')

    if (total === null || pused === null || avail === null) return null

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
  static async getStatus(hostid: bigint): Promise<'UP' | 'DOWN'> {
    for (const key of ['icmpping', 'agent.ping']) {
      const rows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
        SELECT itemid FROM items WHERE hostid = ${hostid} AND key_ = ${key} LIMIT 1
      `
      const row = rows[0]
      if (row) {
        const valor = await MetricRepository.getLastValue(row.itemid, 'int')
        if (valor !== null) return Number(valor) === 1 ? 'UP' : 'DOWN'
      }
    }
    return 'DOWN'
  }

  // ============================================================
  // UPTIME
  // ============================================================
  static async getUptime(hostid: bigint): Promise<string> {
    const rows = await prisma.$queryRaw<Array<{ itemid: bigint }>>`
      SELECT itemid FROM items WHERE hostid = ${hostid} AND key_ = 'system.uptime' LIMIT 1
    `
    const row = rows[0]
    if (!row) return 'N/A'
    const valor = await MetricRepository.getLastValue(row.itemid, 'int')
    return fmtUptime(valor as number | null)
  }

  // ============================================================
  // DISCOS
  // ============================================================
  static async getDiscos(hostid: bigint) {
    const items = await prisma.$queryRaw<Array<{ itemid: bigint; key_: string }>>`
      SELECT itemid, key_
      FROM items
      WHERE hostid = ${hostid}
        AND (key_ LIKE 'vfs.fs.size[%,pused]' OR key_ LIKE 'vfs.fs.dependent.size[%,pused]')
    `

    const discosPorMount: Record<string, { mount: string; uso: number }> = {}

    for (const item of items) {
      try {
        const partes = item.key_.split('[')
        const conteudo = partes[1]

        if (!conteudo) continue

        const mount = conteudo.split(',')[0]

        if (!mount || mount in discosPorMount) continue

        const valor = await MetricRepository.getLastValue(item.itemid, 'float')
        if (valor === null) continue

        discosPorMount[mount] = {
          mount,
          uso: Math.round(Number(valor) * 100) / 100,
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

    if (rows.length === 0) return { type: 'unknown', name: 'Desconhecido' }

    const r = rows[0]

    if (!r) {
      return { type: 'unknown', name: 'Desconhecido' }
    }

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
}