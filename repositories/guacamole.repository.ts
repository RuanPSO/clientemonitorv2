// repositories/guacamole.repository.ts
import 'dotenv/config'
import { guacFetch } from '../lib/guacamole-client.js'
import { normalizarNomeHost } from '../utils/guacamole.js'

const API_URL = process.env.GUAC_PUBLIC_URL
const ADMIN_USER = process.env.GUAC_ADMIN_USER
const ADMIN_PASS = process.env.GUAC_ADMIN_PASSWORD
const TEMP_PASS = process.env.GUAC_TEMP_PASSWORD

if (!API_URL || !ADMIN_USER || !ADMIN_PASS || !TEMP_PASS) {
  throw new Error(
    'Variáveis GUAC_* não definidas no .env (GUAC_PUBLIC_URL, GUAC_ADMIN_USER, GUAC_ADMIN_PASSWORD, GUAC_TEMP_PASSWORD)',
  )
}

// =============================================================
// TIPOS
// =============================================================
export interface GuacToken {
  authToken: string
  dataSource: string
  username: string
}

export interface GuacConnection {
  identifier: string
  name: string
  protocol: string
  parameters: Record<string, string>
  parentIdentifier: string
  attributes?: Record<string, unknown>
}

export interface HostResumo {
  connectionId: string
  nome: string
  protocolo: string
  hostname: string
  porta: string | null
}

// =============================================================
export class GuacamoleRepository {
  // ===========================================================
  // AUTENTICAÇÃO
  // ===========================================================
  static async autenticarAdmin(): Promise<GuacToken> {
    const resp = await guacFetch(`${API_URL}/api/tokens`, {
      method: 'POST',
      form: {
        username: ADMIN_USER!,
        password: ADMIN_PASS!,
      },
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`Erro ao autenticar no Guacamole: ${resp.status} ${txt}`)
    }

    return (await resp.json()) as GuacToken
  }

  static async autenticarUsuario(username: string): Promise<GuacToken> {
    const resp = await guacFetch(`${API_URL}/api/tokens`, {
      method: 'POST',
      form: {
        username,
        password: TEMP_PASS!,
      },
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`Erro ao autenticar usuário ${username}: ${resp.status} ${txt}`)
    }

    return (await resp.json()) as GuacToken
  }

  // ===========================================================
  // CONEXÕES
  // ===========================================================
  static async listarConexoes(
    adminToken: GuacToken,
  ): Promise<Record<string, GuacConnection>> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/connections?token=${encodeURIComponent(adminToken.authToken)}`,
    )

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`Erro ao listar conexões: ${resp.status} ${txt}`)
    }

    return (await resp.json()) as Record<string, GuacConnection>
  }

  static async listarHosts(adminToken: GuacToken): Promise<HostResumo[]> {
    const conns = await GuacamoleRepository.listarConexoes(adminToken)

    return Object.entries(conns)
      .filter(([, c]) => c && typeof c === 'object')
      .filter(([, c]) => {
        const proto = c.protocol
        return typeof proto === 'string' && proto.length > 0
      })
      .map(([id, c]) => {
        const params = (c.parameters ?? {}) as Record<string, string>
        return {
          connectionId: id,
          nome: c.name ?? '(sem nome)',
          protocolo: c.protocol ?? 'unknown',
          hostname: params.hostname ?? '',
          porta: params.port ?? null,
        }
      })
  }

  static async obterConexao(
    adminToken: GuacToken,
    connectionId: string,
  ): Promise<GuacConnection | null> {
    const conexoes = await GuacamoleRepository.listarConexoes(adminToken)
    return conexoes[connectionId] ?? null
  }

  static async findConexaoPorNome(
    adminToken: GuacToken,
    nome: string,
  ): Promise<string | null> {
    const alvo = normalizarNomeHost(nome)
    const conns = await GuacamoleRepository.listarConexoes(adminToken)

    for (const [id, conn] of Object.entries(conns)) {
      if (normalizarNomeHost(conn.name) === alvo) return id
    }
    return null
  }

  static async criarConexaoRdp(
    adminToken: GuacToken,
    nomeHost: string,
    porta: number | string,
  ): Promise<string> {
    const nome = normalizarNomeHost(nomeHost)

    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/connections?token=${encodeURIComponent(adminToken.authToken)}`,
      {
        method: 'POST',
        json: {
          parentIdentifier: 'ROOT',
          name: nome,
          protocol: 'rdp',
          parameters: {
            hostname: 'ts.datacore.com.br',
            port: String(porta),
            security: 'any',
            'ignore-cert': 'true',
            domain: '',
          },
          attributes: {},
        },
      },
    )

    if (resp.status === 400) {
      const txt = await resp.text()
      if (txt.toLowerCase().includes('already exists')) {
        const existente = await GuacamoleRepository.findConexaoPorNome(adminToken, nome)
        if (existente) return existente
      }
      throw new Error(`Erro ao criar conexão: ${resp.status} ${txt}`)
    }

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`Erro ao criar conexão: ${resp.status} ${txt}`)
    }

    const data = (await resp.json()) as { identifier: string }
    return data.identifier
  }

  /**
   * Atualiza uma conexão existente (PUT completo).
   * O Guacamole exige que TODOS os campos sejam enviados de volta.
   */
  static async atualizarConexao(
    adminToken: GuacToken,
    connectionId: string,
    dados: GuacConnection,
  ): Promise<void> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/connections/${connectionId}?token=${encodeURIComponent(adminToken.authToken)}`,
      {
        method: 'PUT',
        json: dados,
      },
    )

    if (!resp.ok && resp.status !== 204) {
      const txt = await resp.text()
      throw new Error(`Erro ao atualizar conexão ${connectionId}: ${resp.status} ${txt}`)
    }
  }

  /**
   * Atualiza apenas alguns parâmetros da conexão, preservando o resto.
   */
  static async atualizarParametrosConexao(
    adminToken: GuacToken,
    connectionId: string,
    novosParametros: Record<string, string>,
  ): Promise<void> {
    const conexao = await GuacamoleRepository.obterConexao(adminToken, connectionId)
    if (!conexao) {
      throw new Error(`Conexão ${connectionId} não encontrada`)
    }

    const paramsAtuais = (conexao.parameters ?? {}) as Record<string, string>

    const dadosAtualizados: GuacConnection = {
      ...conexao,
      parameters: {
        ...paramsAtuais,
        ...novosParametros,
      },
    }

    await GuacamoleRepository.atualizarConexao(adminToken, connectionId, dadosAtualizados)
  }

  // ===========================================================
  // USUÁRIOS
  // ===========================================================
  static async usuarioExiste(adminToken: GuacToken, username: string): Promise<boolean> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/users/${encodeURIComponent(username)}?token=${encodeURIComponent(adminToken.authToken)}`,
    )
    return resp.ok
  }

  static async criarUsuario(adminToken: GuacToken, username: string): Promise<void> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/users?token=${encodeURIComponent(adminToken.authToken)}`,
      {
        method: 'POST',
        json: {
          username,
          password: TEMP_PASS!,
          attributes: {},
        },
      },
    )

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`Erro ao criar usuário ${username}: ${resp.status} ${txt}`)
    }
  }

  static async resetarSenhaUsuario(adminToken: GuacToken, username: string): Promise<void> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/users/${encodeURIComponent(username)}?token=${encodeURIComponent(adminToken.authToken)}`,
      {
        method: 'PUT',
        json: {
          username,
          password: TEMP_PASS!,
          attributes: {},
        },
      },
    )

    if (!resp.ok && resp.status !== 204) {
      const txt = await resp.text()
      throw new Error(`Erro ao resetar senha de ${username}: ${resp.status} ${txt}`)
    }
  }

  static async garantirUsuario(adminToken: GuacToken, username: string): Promise<void> {
    const existe = await GuacamoleRepository.usuarioExiste(adminToken, username)
    if (!existe) {
      await GuacamoleRepository.criarUsuario(adminToken, username)
    }
    await GuacamoleRepository.resetarSenhaUsuario(adminToken, username)
  }

  // ===========================================================
  // PERMISSÕES
  // ===========================================================
  static async concederPermissaoConexao(
    adminToken: GuacToken,
    username: string,
    connectionId: string,
  ): Promise<void> {
    const resp = await guacFetch(
      `${API_URL}/api/session/data/${adminToken.dataSource}/users/${encodeURIComponent(username)}/permissions?token=${encodeURIComponent(adminToken.authToken)}`,
      {
        method: 'PATCH',
        json: [
          {
            op: 'add',
            path: `/connectionPermissions/${connectionId}`,
            value: 'READ',
          },
        ],
      },
    )

    if (!resp.ok && resp.status !== 204 && resp.status !== 409) {
      const txt = await resp.text()
      throw new Error(`Erro ao conceder permissão: ${resp.status} ${txt}`)
    }
  }
}