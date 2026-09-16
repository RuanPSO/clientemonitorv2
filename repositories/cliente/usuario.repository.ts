// repositories/cliente/usuario.repository.ts
import { prismaCliente } from '../../lib/prisma-cliente.js'

// =============================================================
// TIPOS
// =============================================================
export interface UsuarioComGrupo {
  id: number
  nome: string
  email: string
  senha: string          // hash werkzeug — NUNCA expor no JSON
  cargo: string | null
  ativo: boolean
  id_grupo: number
  grupo: string          // nome do grupo (ex.: "ACR")
  groupid_zabbix: string // ID do grupo no Zabbix
}

export interface UsuarioPublico {
  id: number
  nome: string
  email: string
  cargo: string | null
  grupo: string
  groupid_zabbix: string
}

// =============================================================
export class UsuarioRepository {
  /**
   * Busca um usuário ATIVO pelo e-mail, com dados do grupo já relacionados.
   * Equivalente à query do app.py (JOIN usuarios + grupos_hosts).
   */
  static async findByEmailComGrupo(email: string): Promise<UsuarioComGrupo | null> {
    const rows = await prismaCliente.$queryRaw<
      Array<{
        id: number
        nome: string
        email: string
        senha: string
        cargo: string | null
        ativo: boolean
        id_grupo: number
        grupo: string
        groupid_zabbix: string
      }>
    >`
      SELECT
        u.id,
        u.nome,
        u.email,
        u.senha,
        u.cargo,
        u.ativo,
        g.id AS id_grupo,
        g.nome AS grupo,
        g.groupid_zabbix
      FROM usuarios u
      JOIN grupos_hosts g ON g.id = u.id_grupo
      WHERE u.email = ${email}
        AND u.ativo = TRUE
      LIMIT 1
    `

    const r = rows[0]
    if (!r) return null

    return {
      id: Number(r.id),
      nome: r.nome,
      email: r.email,
      senha: r.senha,
      cargo: r.cargo,
      ativo: Boolean(r.ativo),
      id_grupo: Number(r.id_grupo),
      grupo: String(r.grupo).trim().toUpperCase(),
      groupid_zabbix: String(r.groupid_zabbix),
    }
  }

  /**
   * Busca um usuário pelo ID (útil para a rota /me).
   */
  static async findByIdComGrupo(id: number): Promise<UsuarioComGrupo | null> {
    const rows = await prismaCliente.$queryRaw<
      Array<{
        id: number
        nome: string
        email: string
        senha: string
        cargo: string | null
        ativo: boolean
        id_grupo: number
        grupo: string
        groupid_zabbix: string
      }>
    >`
      SELECT
        u.id, u.nome, u.email, u.senha, u.cargo, u.ativo,
        g.id AS id_grupo, g.nome AS grupo, g.groupid_zabbix
      FROM usuarios u
      JOIN grupos_hosts g ON g.id = u.id_grupo
      WHERE u.id = ${id}
      LIMIT 1
    `

    const r = rows[0]
    if (!r) return null

    return {
      id: Number(r.id),
      nome: r.nome,
      email: r.email,
      senha: r.senha,
      cargo: r.cargo,
      ativo: Boolean(r.ativo),
      id_grupo: Number(r.id_grupo),
      grupo: String(r.grupo).trim().toUpperCase(),
      groupid_zabbix: String(r.groupid_zabbix),
    }
  }

  /**
   * Remove a senha do objeto antes de devolver para o frontend.
   */
  static toPublico(u: UsuarioComGrupo): UsuarioPublico {
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      cargo: u.cargo,
      grupo: u.grupo,
      groupid_zabbix: u.groupid_zabbix,
    }
  }
}