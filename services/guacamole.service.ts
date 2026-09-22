// services/guacamole.service.ts
import 'dotenv/config'
import {
  GuacamoleRepository,
  type GuacToken,
  type HostResumo,
} from '../repositories/guacamole.repository.js'
import {
  extrairUsernameDoEmail,
  gerarUrlConexao,
  validarHostname,
  validarPorta,
} from '../utils/guacamole.js'
import { cached, invalidate } from '../lib/cache.js'

const PUBLIC_URL = process.env.GUAC_PUBLIC_URL

if (!PUBLIC_URL) {
  throw new Error('GUAC_PUBLIC_URL não definido no .env')
}

// =============================================================
// TIPOS
// =============================================================
export interface ConnectResult {
  url: string
  hostname: string
  porta: string
  connectionId: string
  username: string
}

// =============================================================
export class GuacamoleService {
  // ===========================================================
  // LISTAR HOSTS
  // ===========================================================
  static async listarHosts(): Promise<HostResumo[]> {
    return cached(
      'guac:hosts',
      async () => {
        const adminToken = await GuacamoleRepository.autenticarAdmin()
        return GuacamoleRepository.listarHosts(adminToken)
      },
      60_000,
    )
  }

  // ===========================================================
  // GERAR URL POR ID (fluxo simples)
  // ===========================================================
  static async gerarUrlPorConnectionId(connectionId: string): Promise<ConnectResult> {
    if (!connectionId) throw new Error('connectionId é obrigatório')

    const adminToken = await GuacamoleRepository.autenticarAdmin()
    const conexoes = await GuacamoleRepository.listarConexoes(adminToken)
    const conexao = conexoes[connectionId]

    if (!conexao) {
      throw new Error(`Conexão ${connectionId} não encontrada`)
    }

    const url = gerarUrlConexao(
      PUBLIC_URL!,
      connectionId,
      adminToken.dataSource,
      adminToken.authToken,
    )

    const params = (conexao.parameters ?? {}) as Record<string, string>

    console.log(`[guac] URL gerada (ID): ${conexao.name} → ${connectionId}`)

    return {
      url,
      hostname: conexao.name ?? '(sem nome)',
      porta: params.port ?? 'N/A',
      connectionId,
      username: adminToken.username,
    }
  }

  // ===========================================================
  // FLUXO COMPLETO (usuário + conexão + permissão)
  // ===========================================================
  static async conectarOuCriar(
    hostname: string,
    porta: number | string,
    email: string,
  ): Promise<ConnectResult> {
    if (!validarHostname(hostname)) throw new Error(`Hostname inválido: "${hostname}"`)
    if (!validarPorta(porta)) throw new Error(`Porta inválida: "${porta}"`)

    const username = extrairUsernameDoEmail(email)
    if (!username) throw new Error(`E-mail inválido: "${email}"`)

    const adminToken = await GuacamoleRepository.autenticarAdmin()
    await GuacamoleRepository.garantirUsuario(adminToken, username)

    let connectionId = await GuacamoleRepository.findConexaoPorNome(adminToken, hostname)
    if (!connectionId) {
      connectionId = await GuacamoleRepository.criarConexaoRdp(adminToken, hostname, porta)
    }

    await GuacamoleRepository.concederPermissaoConexao(adminToken, username, connectionId)

    const userToken = await GuacamoleRepository.autenticarUsuario(username)

    const url = gerarUrlConexao(
      PUBLIC_URL!,
      connectionId,
      userToken.dataSource,
      userToken.authToken,
    )

    console.log(`[guac] URL gerada (fluxo completo): ${username} → ${hostname}:${porta}`)

    return {
      url,
      hostname,
      porta: String(porta),
      connectionId,
      username,
    }
  }

  // ===========================================================
  // MANUTENÇÃO DE CONEXÕES
  // ===========================================================

  /**
   * Debug: retorna a conexão crua (todos os parâmetros).
   */
  static async debugConexao(connectionId: string): Promise<unknown> {
    const adminToken = await GuacamoleRepository.autenticarAdmin()
    const conexao = await GuacamoleRepository.obterConexao(adminToken, connectionId)
    if (!conexao) throw new Error(`Conexão ${connectionId} não encontrada`)
    return conexao
  }

  /**
   * Remove o campo "domain" da tela de conexão RDP.
   */
  static async removerCampoDominio(connectionId: string): Promise<void> {
    const adminToken = await GuacamoleRepository.autenticarAdmin()

    await GuacamoleRepository.atualizarParametrosConexao(adminToken, connectionId, {
      domain: '',
    })

    invalidate('guac:hosts')
    console.log(`[guac] Campo "domain" removido da conexão ${connectionId}`)
  }

  /**
   * Corrige o hostname e a porta de uma conexão.
   * Use quando a conexão estiver com o destino vazio/errado.
   */
  static async corrigirDestino(
    connectionId: string,
    hostname: string,
    porta: number | string = 3389,
  ): Promise<void> {
    if (!hostname) throw new Error('hostname é obrigatório')

    const adminToken = await GuacamoleRepository.autenticarAdmin()

    await GuacamoleRepository.atualizarParametrosConexao(adminToken, connectionId, {
      hostname,
      port: String(porta),
      'ignore-cert': 'true',
      security: 'any',
      domain: '',
    })

    invalidate('guac:hosts')
    console.log(`[guac] Conexão ${connectionId} corrigida → ${hostname}:${porta}`)
  }

  // ===========================================================
  // HELPERS
  // ===========================================================
  static async obterTokenAdmin(): Promise<GuacToken> {
    return GuacamoleRepository.autenticarAdmin()
  }
}