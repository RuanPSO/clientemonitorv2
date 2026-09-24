// repositories/host.repository.ts
import { prisma } from '../lib/prisma.js'

export interface GrupoZabbix {
  groupid: string
  name: string
}

export interface HostResumo {
  hostid: string
  hostname: string
}

export interface HostBasico {
  hostid: string
  host: string
  hostname: string
  status: number
}

export class HostRepository {
  // ==========================================================
  // GRUPOS (hstgrp)
  // ==========================================================
  static async listarGrupos(): Promise<GrupoZabbix[]> {
    const rows = await prisma.$queryRaw<Array<{ groupid: bigint; name: string }>>`
      SELECT groupid, name
      FROM hstgrp
      ORDER BY name
    `
    return rows.map((r) => ({ groupid: r.groupid.toString(), name: r.name }))
  }

  static async getGrupoPorNome(nome: string): Promise<GrupoZabbix | null> {
    const rows = await prisma.$queryRaw<Array<{ groupid: bigint; name: string }>>`
      SELECT groupid, name
      FROM hstgrp
      WHERE name = ${nome}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { groupid: row.groupid.toString(), name: row.name }
  }

  // ==========================================================
  // HOSTS POR GRUPO — por ID
  // ==========================================================
  static async getHostsDoGrupo(groupid: bigint | number): Promise<HostResumo[]> {
    const groupIdBig = typeof groupid === 'bigint' ? groupid : BigInt(groupid)
    const rows = await prisma.$queryRaw<Array<{ hostid: bigint; hostname: string }>>`
      SELECT h.hostid, h.name AS hostname
      FROM hosts h
      JOIN hosts_groups hg ON hg.hostid = h.hostid
      WHERE hg.groupid = ${groupIdBig}
        AND h.status = 0
      ORDER BY h.name
    `
    return rows.map((r) => ({ hostid: r.hostid.toString(), hostname: r.hostname }))
  }

  // ==========================================================
  // HOSTS POR GRUPO — por NOME (NOVO)
  // ==========================================================
  static async getHostsPorNomeDoGrupo(nome: string): Promise<HostResumo[]> {
    const rows = await prisma.$queryRaw<Array<{ hostid: bigint; hostname: string }>>`
      SELECT h.hostid, h.name AS hostname
      FROM hosts h
      JOIN hosts_groups hg ON hg.hostid = h.hostid
      JOIN hstgrp g       ON g.groupid = hg.groupid
      WHERE g.name = ${nome}
        AND h.status = 0
      ORDER BY h.name
    `
    return rows.map((r) => ({ hostid: r.hostid.toString(), hostname: r.hostname }))
  }

  // ==========================================================
  // DISPATCHER (opção B): ID ou NOME na mesma rota
  // ==========================================================
  static async getHostsPorChave(chave: string): Promise<{
    tipo: 'id' | 'nome'
    chave: string
    hosts: HostResumo[]
  }> {
    // Se for só dígitos → busca por ID
    if (/^\d+$/.test(chave)) {
      const hosts = await HostRepository.getHostsDoGrupo(BigInt(chave))
      return { tipo: 'id', chave, hosts }
    }
    // Senão, busca por nome
    const hosts = await HostRepository.getHostsPorNomeDoGrupo(chave)
    return { tipo: 'nome', chave, hosts }
  }

  // ==========================================================
  // INFO BÁSICA DO HOST
  // ==========================================================
  static async getHostBasico(hostid: bigint | number): Promise<HostBasico | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const rows = await prisma.$queryRaw<
      Array<{ hostid: bigint; host: string; name: string; status: number }>
    >`
      SELECT hostid, host, name, status
      FROM hosts
      WHERE hostid = ${hostIdBig}
      LIMIT 1
    `
    const r = rows[0]
    if (!r) return null
    return {
      hostid: r.hostid.toString(),
      host: r.host,
      hostname: r.name,
      status: r.status,
    }
  }

  // ==========================================================
  // HELPERS PARA O HOST CLASSIFIER
  // ==========================================================

  /**
   * Retorna os NOMES dos templates aplicados ao host.
   * Templates no Zabbix são "hosts" com status=3 (TEMPLATE).
   */
  static async getTemplatesDoHost(hostid: bigint | number): Promise<string[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT t.host AS name
      FROM hosts_templates ht
      JOIN hosts t ON t.hostid = ht.templateid
      WHERE ht.hostid = ${hostIdBig}
        AND t.status = 3
    `
    return rows.map((r) => r.name)
  }

  /**
   * Retorna os NOMES dos grupos aos quais o host pertence.
   */
  static async getGruposDoHost(hostid: bigint | number): Promise<string[]> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT g.name
      FROM hosts_groups hg
      JOIN hstgrp g ON g.groupid = hg.groupid
      WHERE hg.hostid = ${hostIdBig}
    `
    return rows.map((r) => r.name)
  }

  /**
   * Retorna 'SNMP' se o host tiver ao menos uma interface SNMP (type=2).
   * Retorna null caso contrário.
   */
  static async getInterfaceType(hostid: bigint | number): Promise<string | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)
    const rows = await prisma.$queryRaw<Array<{ type: number }>>`
      SELECT type
      FROM interface
      WHERE hostid = ${hostIdBig}
        AND type = 2
      LIMIT 1
    `
    return rows.length > 0 ? 'SNMP' : null
  }

    // ============================================================
    // BATCH — metadata de múltiplos hosts em 1 query
    // ============================================================

    static async getTemplatesBatch(hostids: bigint[]): Promise<Map<string, string[]>> {
      const result = new Map<string, string[]>()
      if (hostids.length === 0) return result
      const idsStr = hostids.map((h) => h.toString())
      const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

      const rows = await prisma.$queryRawUnsafe<
        Array<{ hostid: bigint; name: string }>
      >(
        `SELECT ht.hostid, t.host AS name
        FROM hosts_templates ht
        JOIN hosts t ON t.hostid = ht.templateid
        WHERE ht.hostid IN (${placeholders})
          AND t.status = 3`,
        ...idsStr,
      )

      for (const id of idsStr) result.set(id, [])
      for (const r of rows) {
        result.get(r.hostid.toString())!.push(r.name)
      }
      return result
    }

    static async getGruposBatch(hostids: bigint[]): Promise<Map<string, string[]>> {
      const result = new Map<string, string[]>()
      if (hostids.length === 0) return result
      const idsStr = hostids.map((h) => h.toString())
      const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

      const rows = await prisma.$queryRawUnsafe<
        Array<{ hostid: bigint; name: string }>
      >(
        `SELECT hg.hostid, g.name
        FROM hosts_groups hg
        JOIN hstgrp g ON g.groupid = hg.groupid
        WHERE hg.hostid IN (${placeholders})`,
        ...idsStr,
      )

      for (const id of idsStr) result.set(id, [])
      for (const r of rows) {
        result.get(r.hostid.toString())!.push(r.name)
      }
      return result
    }

    static async getInterfaceTypeBatch(
      hostids: bigint[],
    ): Promise<Map<string, string | null>> {
      const result = new Map<string, string | null>()
      if (hostids.length === 0) return result
      const idsStr = hostids.map((h) => h.toString())
      const placeholders = idsStr.map((_, i) => `$${i + 1}`).join(', ')

      const rows = await prisma.$queryRawUnsafe<
        Array<{ hostid: bigint }>
      >(
        `SELECT DISTINCT hostid
        FROM interface
        WHERE hostid IN (${placeholders})
          AND type = 2`,
        ...idsStr,
      )

      for (const id of idsStr) result.set(id, null)
      for (const r of rows) {
        result.set(r.hostid.toString(), 'SNMP')
      }
      return result
    }

  // ==========================================================
  // BUSCAR HOST POR NOME (para o lookup de relatório)
  // ==========================================================
  /**
   * Busca o hostid pelo nome técnico (`hosts.host`), case-insensitive.
   * Prioriza hosts habilitados (status=0) quando há duplicados.
   * Retorna null se não encontrar.
   */
  static async findHostidPorNome(nome: string): Promise<bigint | null> {
    const rows = await prisma.$queryRaw<Array<{ hostid: bigint }>>`
      SELECT hostid
      FROM hosts
      WHERE LOWER(host) = LOWER(${nome})
      ORDER BY (status = 0) DESC
      LIMIT 1
    `
    return rows[0]?.hostid ?? null
  }

  // ==========================================================
  // LISTAR HOSTS COM IP — 1 query
  // ==========================================================
  static async listarHostsComIp(): Promise<
    Array<{ hostid: string; host: string; ip: string | null }>
  > {
    const rows = await prisma.$queryRaw<
      Array<{ hostid: bigint; host: string; ip: string | null }>
    >`
      SELECT h.hostid, h.host, i.ip
      FROM hosts h
      LEFT JOIN interface i
        ON i.hostid = h.hostid
       AND i.main = 1
      WHERE h.status = 0
      ORDER BY h.host
    `

    return rows.map((r) => ({
      hostid: r.hostid.toString(),
      host: r.host,
      ip: r.ip ?? null,
    }))
  }

  // ==========================================================
  // HOST POR ID COM IP + PORTA — 1 query
  // ==========================================================
  static async getHostComIp(hostid: bigint | number): Promise<{
    hostid: string
    nome: string
    ip: string | null
    porta_customizada: string | null
  } | null> {
    const hostIdBig = typeof hostid === 'bigint' ? hostid : BigInt(hostid)

    const rows = await prisma.$queryRaw<
      Array<{ hostid: bigint; nome: string; ip: string | null }>
    >`
      SELECT h.hostid, h.host AS nome, i.ip
      FROM hosts h
      LEFT JOIN interface i
        ON h.hostid = i.hostid
       AND i.main = 1
      WHERE h.hostid = ${hostIdBig}
      LIMIT 1
    `

    const r = rows[0]
    if (!r) return null

    const { gerarPortaDoIp } = await import('../utils/helpers.js')

    return {
      hostid: r.hostid.toString(),
      nome: r.nome,
      ip: r.ip ?? null,
      porta_customizada: gerarPortaDoIp(r.ip),
    }
  }

  // ==========================================================
  // HOSTS + IP + SO — 3 queries totais (era 1 + N)
  // ==========================================================
  /**
   * Otimização chave: a detecção de SO é feita em BATCH para todos os hosts
   * com 2 queries únicas (uma para sw.os/uname, outra para os fallbacks).
   */
  static async listarHostsComIpESo(): Promise<
    Array<{
      groupid: string
      nome_grupo: string
      hostid: string
      nome_host: string
      ip: string | null
      port: number | null
      porta_customizada: string | null
      os: { type: string; name: string | null } | null
    }>
  > {
    const { gerarPortaDoIp } = await import('../utils/helpers.js')

    // ─── 1) Hosts + grupos + IP ───
    const rows = await prisma.$queryRaw<
      Array<{
        groupid: bigint
        nome_grupo: string
        hostid: bigint
        nome_host: string
        ip: string | null
        port: number | null
      }>
    >`
      SELECT
        g.groupid, g.name AS nome_grupo,
        h.hostid, h.host AS nome_host,
        i.ip, i.port
      FROM hstgrp g
      JOIN hosts_groups hg ON g.groupid = hg.groupid
      JOIN hosts h ON hg.hostid = h.hostid
      LEFT JOIN interface i
        ON h.hostid = i.hostid
       AND i.main = 1
      WHERE h.status = 0
        AND h.flags = 0
      ORDER BY g.name, h.host
    `

    if (rows.length === 0) return []

    // IDs únicos (alguns hosts podem aparecer em vários grupos)
    const hostidsUnicos = Array.from(new Set(rows.map((r) => r.hostid.toString())))
    const placeholders = hostidsUnicos.map((_, i) => `$${i + 1}`).join(', ')

    // ─── 2) SO em BATCH — sw.os + uname para todos de uma vez ───
    const soRows = await prisma.$queryRawUnsafe<
      Array<{ hostid: bigint; key_: string; value: string | null }>
    >(
      `SELECT i.hostid, i.key_, hs.value
       FROM items i
       LEFT JOIN LATERAL (
         SELECT value FROM history_str
         WHERE itemid = i.itemid
         ORDER BY clock DESC LIMIT 1
       ) hs ON true
       WHERE i.hostid IN (${placeholders})
         AND i.key_ IN ('system.sw.os', 'system.uname')`,
      ...hostidsUnicos,
    )

    // Agrupa resultado por hostid
    const soMap = new Map<string, { sw_os: string | null; uname: string | null }>()
    for (const r of soRows) {
      const id = r.hostid.toString()
      const cur = soMap.get(id) ?? { sw_os: null, uname: null }
      if (r.key_ === 'system.sw.os') cur.sw_os = r.value
      if (r.key_ === 'system.uname') cur.uname = r.value
      soMap.set(id, cur)
    }

    // ─── 3) Fallback: hosts que não têm sw.os nem uname ───
    // Descobre se tem item Windows (perf_counter, vfs.fs.size[C:]) ou Linux (system.cpu, vm.memory)
    const hostidsSemSo = hostidsUnicos.filter((id) => {
      const s = soMap.get(id)
      return !s || (!s.sw_os && !s.uname)
    })

    let fallbackMap = new Map<string, { type: string; name: string | null }>()

    if (hostidsSemSo.length > 0) {
      const placeholdersFb = hostidsSemSo.map((_, i) => `$${i + 1}`).join(', ')

      const fbRows = await prisma.$queryRawUnsafe<
        Array<{ hostid: bigint; is_windows: number; is_linux: number }>
      >(
        `SELECT
           hostid,
           MAX(CASE WHEN (
             key_ LIKE 'vfs.fs.size[C:%'
             OR key_ LIKE 'perf_counter[%'
             OR key_ LIKE 'perf_counter_en[%'
           ) THEN 1 ELSE 0 END) AS is_windows,
           MAX(CASE WHEN (
             key_ LIKE 'system.cpu%'
             OR key_ LIKE 'vfs.fs%'
             OR key_ LIKE 'vm.memory%'
           ) THEN 1 ELSE 0 END) AS is_linux
         FROM items
         WHERE hostid IN (${placeholdersFb})
         GROUP BY hostid`,
        ...hostidsSemSo,
      )

      fallbackMap = new Map<string, { type: string; name: string | null }>(
        fbRows.map((r) => {
          const id = r.hostid.toString()
          if (Number(r.is_windows) === 1) {
            return [id, { type: 'windows', name: 'Windows' }] as const
          }
          if (Number(r.is_linux) === 1) {
            return [id, { type: 'linux', name: 'Linux' }] as const
          }
          return [id, { type: 'unknown', name: null }] as const
        }),
      )
    }

    // ─── 4) Monta o resultado final ───
    return rows.map((r) => {
      const id = r.hostid.toString()
      const soInfo = soMap.get(id)
      let os: { type: string; name: string | null } | null = null

      if (soInfo?.sw_os) {
        os = {
          type: soInfo.sw_os.toLowerCase().includes('windows') ? 'windows' : 'linux',
          name: soInfo.sw_os,
        }
      } else if (soInfo?.uname) {
        os = { type: 'linux', name: 'Linux' }
      } else {
        const fb = fallbackMap.get(id)
        os = fb ?? { type: 'unknown', name: null }
      }

      return {
        groupid: r.groupid.toString(),
        nome_grupo: r.nome_grupo,
        hostid: id,
        nome_host: r.nome_host,
        ip: r.ip ?? null,
        port: r.port ?? null,
        porta_customizada: gerarPortaDoIp(r.ip),
        os,
      }
    })
  }
}