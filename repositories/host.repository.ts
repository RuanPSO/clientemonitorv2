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

}