// services/auth.service.ts
import { UsuarioRepository, type UsuarioPublico } from '../repositories/cliente/usuario.repository.js'
import { verificarSenhaWerkzeug } from '../utils/helpers.js'

export interface LoginResult {
  ok: true
  usuario: UsuarioPublico
}

export interface LoginError {
  ok: false
  motivo: 'credenciais_invalidas' | 'usuario_inativo' | 'erro_interno'
  mensagem: string
}

export class AuthService {
  /**
   * Tenta autenticar o usuário.
   * Retorna { ok: true, usuario } em caso de sucesso,
   * ou { ok: false, motivo, mensagem } em caso de falha.
   */
  static async login(email: string, senha: string): Promise<LoginResult | LoginError> {
    if (!email || !senha) {
      return { ok: false, motivo: 'credenciais_invalidas', mensagem: 'E-mail e senha obrigatórios' }
    }

    try {
      const usuario = await UsuarioRepository.findByEmailComGrupo(email.trim().toLowerCase())

      if (!usuario) {
        return { ok: false, motivo: 'credenciais_invalidas', mensagem: 'E-mail ou senha inválidos' }
      }

      // Se a query já filtra ativo=TRUE, essa checagem é redundante — mas fica como defesa.
      if (!usuario.ativo) {
        return { ok: false, motivo: 'usuario_inativo', mensagem: 'Usuário inativo' }
      }

      const senhaOk = verificarSenhaWerkzeug(senha, usuario.senha)
      if (!senhaOk) {
        return { ok: false, motivo: 'credenciais_invalidas', mensagem: 'E-mail ou senha inválidos' }
      }

      return { ok: true, usuario: UsuarioRepository.toPublico(usuario) }
    } catch (e) {
      console.error('[AuthService.login] erro:', e)
      return { ok: false, motivo: 'erro_interno', mensagem: 'Erro ao autenticar' }
    }
  }

  /**
   * Busca o usuário pelo ID (usado na rota /me).
   */
  static async getUsuarioPorId(id: number): Promise<UsuarioPublico | null> {
    const u = await UsuarioRepository.findByIdComGrupo(id)
    if (!u) return null
    return UsuarioRepository.toPublico(u)
  }
}