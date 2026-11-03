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

export interface UsuarioAtivacao {
  id: number
  nome: string
  email: string
  ativo: boolean
  token_expira: Date | null
}

export interface ConvitePendente {
  id: number
  nome: string
  email: string
  id_grupo: number
  grupo: string
  ativo: boolean
  token_expira: Date | null
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

  // ============================================================
  // CRIAR usuário (com token de ativação)
  // ============================================================
  static async criar(params: {
      nome: string
      email: string
      cargo: string | null
      id_grupo: number
      token_ativacao: string
      token_expira?: Date
    }): Promise<number> {
    const tokenExpira = params.token_expira ?? new Date(Date.now() + 24 * 60 * 60 * 1000)

    const rows = await prismaCliente.$queryRaw<Array<{ id: number }>>`
      INSERT INTO usuarios
        (nome, email, senha, cargo, id_grupo, ativo, data_criacao, token_ativacao, token_expira)
      VALUES
        (${params.nome}, ${params.email}, ${''}, ${params.cargo}, ${params.id_grupo}, false, NOW(), ${params.token_ativacao}, ${tokenExpira})
      RETURNING id
    `
    const row = rows[0]
    if (!row) throw new Error('Não foi possível criar o usuário')
    return Number(row.id)
  }

  static async findConvitePendenteById(id: number): Promise<ConvitePendente | null> {
    const rows = await prismaCliente.$queryRaw<Array<{
      id: number
      nome: string
      email: string
      id_grupo: number
      grupo: string
      ativo: boolean
      token_expira: Date | null
    }>>`
      SELECT
        u.id, u.nome, u.email, u.id_grupo, g.nome AS grupo, u.ativo,
        u.token_expira
      FROM usuarios u
      JOIN grupos_hosts g ON g.id = u.id_grupo
      WHERE u.id = ${id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: Number(row.id),
      nome: row.nome,
      email: row.email,
      id_grupo: Number(row.id_grupo),
      grupo: String(row.grupo).trim(),
      ativo: Boolean(row.ativo),
      token_expira: row.token_expira,
    }
  }

  static async emitirNovoConvite(
    id: number,
    token: string,
    tokenExpira: Date,
  ): Promise<ConvitePendente | null> {
    return prismaCliente.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw<Array<{ id: number; id_grupo: number }>>`
        SELECT id, id_grupo
        FROM usuarios
        WHERE id = ${id} AND ativo = false
        FOR UPDATE
      `
      const user = users[0]
      if (!user) return null

      const updated = await transaction.$queryRaw<Array<{
        id: number
        nome: string
        email: string
        id_grupo: number
        ativo: boolean
        token_expira: Date | null
      }>>`
        UPDATE usuarios
        SET token_ativacao = ${token},
            token_expira = ${tokenExpira}
        WHERE id = ${id} AND ativo = false
        RETURNING id, nome, email, id_grupo, ativo, token_expira
      `
      const pending = updated[0]
      if (!pending) return null

      const groups = await transaction.$queryRaw<Array<{ nome: string }>>`
        SELECT nome FROM grupos_hosts WHERE id = ${pending.id_grupo} LIMIT 1
      `
      const group = groups[0]
      if (!group) throw new Error('Grupo associado ao usuário não encontrado')

      return {
        id: Number(pending.id),
        nome: pending.nome,
        email: pending.email,
        id_grupo: Number(pending.id_grupo),
        grupo: String(group.nome).trim(),
        ativo: Boolean(pending.ativo),
        token_expira: pending.token_expira,
      }
    })
  }

    /**
     * Busca usuário pelo token de ativação (não valida expiração aqui).
     */
  static async findByTokenAtivacao(token: string): Promise<UsuarioAtivacao | null> {
    const rows = await prismaCliente.$queryRaw<
      Array<{
        id: number
        nome: string
        email: string
        ativo: boolean
        token_expira: Date | null
      }>
    >`
      SELECT id, nome, email, ativo, token_expira
      FROM usuarios
      WHERE token_ativacao = ${token}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: Number(row.id),
      nome: row.nome,
      email: row.email,
      ativo: Boolean(row.ativo),
      token_expira: row.token_expira,
    }
  }

    /**
     * Ativa o usuário: salva senha hasheada, marca como ativo, limpa token.
     */
  static async ativarComSenha(id: number, senhaHash: string): Promise<void> {
    await prismaCliente.$executeRaw`
      UPDATE usuarios
      SET senha = ${senhaHash},
          ativo = true,
          token_ativacao = NULL,
          token_expira = NULL
      WHERE id = ${id}
    `
  }

  /**
   * Atualização atômica: só ativa se o token ainda é válido e a conta não foi ativada antes.
   */
  static async ativarComSenhaSeValido(id: number, senhaHash: string, token: string): Promise<boolean> {
    const result = await prismaCliente.$executeRaw`
      UPDATE usuarios
      SET senha = ${senhaHash},
          ativo = true,
          token_ativacao = NULL,
          token_expira = NULL
      WHERE id = ${id}
        AND ativo = false
        AND token_ativacao = ${token}
        AND (token_expira IS NULL OR token_expira > NOW())
    `

    return Number(result) > 0
  }
}
