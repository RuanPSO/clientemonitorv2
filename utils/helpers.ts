//importacoes 
import crypto from 'node:crypto'

// utils/helpers.ts

// =============================================================
// TEMPO / FORMATAÇÃO
// =============================================================

export function fmtUptime(seconds: number | bigint | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'N/A'
  const s = Number(seconds)
  if (isNaN(s) || s <= 0) return 'N/A'

  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)

  return parts.length > 0 ? parts.join(' ') : 'menos de 1 minuto'
}

/**
 * Formatar_tempo
 * Formato curto: "2d 5h" | "5h 30min" | "45min"
 */
export function formatarTempo(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined) return 'N/A'

  let s = Math.floor(Number(segundos))
  const dias = Math.floor(s / 86400); s %= 86400
  const horas = Math.floor(s / 3600); s %= 3600
  const minutos = Math.floor(s / 60)

  if (dias > 0) return `${dias}d ${horas}h`
  if (horas > 0) return `${horas}h ${minutos}min`
  return `${minutos}min`
}

/**
 * Converte "YYYY-MM-DD HH:MM:SS" para "YYYY-MM-DDTHH:MM:SS".
 */
export function normalizarData(dataStr: string): string {
  if (!dataStr) return dataStr
  if (dataStr.includes(' ') && !dataStr.includes('T')) {
    return dataStr.replace(' ', 'T')
  }
  return dataStr
}

/**
 * Converte string ISO (com ou sem 'T') em Unix timestamp (segundos).
 * Aceita "YYYY-MM-DD HH:MM:SS" e "YYYY-MM-DDTHH:MM:SS".
 */
export function isoParaTimestamp(iso: string): number {
  const normalizado = normalizarData(iso)
  const ms = new Date(normalizado).getTime()
  if (isNaN(ms)) throw new Error(`Data inválida: "${iso}"`)
  return Math.floor(ms / 1000)
}

// =============================================================
// SLA
// =============================================================

export type SlaStatus = 'DENTRO DO SLA' | 'ATENÇÃO' | 'FORA DO SLA'

export function obterSla(valor: number): SlaStatus {
  if (valor >= 99.5) return 'DENTRO DO SLA'
  if (valor >= 99) return 'ATENÇÃO'
  return 'FORA DO SLA'
}

// =============================================================
// CATEGORIZAÇÃO DE SERVIÇOS
// =============================================================

export type CategoriaServico =
  | 'GO-Global'
  | 'Integrações SPS'
  | 'Beas'
  | 'Banco de Dados'
  | 'SAP Business One'
  | 'Serviços Aster'
  | 'Outros'

export function categorizarServico(nome: string): CategoriaServico {
  const n = (nome || '').toLowerCase()
  if (n.includes('goglobal') || n.includes('ggaps')) return 'GO-Global'
  if (n.includes('sps')) return 'Integrações SPS'
  if (n.includes('beas')) return 'Beas'
  if (n.includes('sql')) return 'Banco de Dados'
  if (n.includes('sap')) return 'SAP Business One'
  if (n.includes('ahs')) return 'Serviços Aster'
  return 'Outros'
}

// =============================================================
// NÚMEROS
// =============================================================

/**
 * Converte bigint | string | number vindo do driver `pg` para number.
 * O driver entrega `numeric`/`bigint` como string; isso normaliza.
 */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return Number(String(v))
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

const GB = 1_073_741_824

export function bytesParaGb(bytes: number | bigint | null | undefined): number {
  if (bytes === null || bytes === undefined) return 0
  return round2(Number(bytes) / GB)
}

// =============================================================
// AUTENTICAÇÃO — compatibilidade com werkzeug (Flask)
// =============================================================

/**
 * Verifica uma senha contra um hash do werkzeug (Flask).
 * Suporta formatos:
 *   - pbkdf2:sha256:600000$salt$hash
 *   - pbkdf2:sha256$salt$hash
 *   - scrypt:32768:8:1$salt$hash
 *
 * Compatível com check_password_hash() do werkzeug.
 */
export function verificarSenhaWerkzeug(senha: string, hashArmazenado: string): boolean {
  try {
    const parts = hashArmazenado.split('$')
    if (parts.length !== 3) return false

    const methodPart = parts[0]
    const salt = parts[1]
    const hashEsperado = parts[2]
    if (methodPart === undefined || salt === undefined || hashEsperado === undefined) return false

    const methodParts = methodPart.split(':')
    const metodo = methodParts[0]
    const keylen = hashEsperado.length / 2

    let derivado: Buffer

    if (metodo === 'pbkdf2') {
      const digest = methodParts[1] ?? 'sha256'
      const iterations = methodParts[2] ? parseInt(methodParts[2], 10) : 260000
      derivado = crypto.pbkdf2Sync(senha, salt, iterations, keylen, digest)
    } else if (metodo === 'scrypt') {
      const N = parseInt(methodParts[1] ?? '32768', 10)
      const r = parseInt(methodParts[2] ?? '8', 10)
      const p = parseInt(methodParts[3] ?? '1', 10)
      derivado = crypto.scryptSync(senha, salt, keylen, {
        N,
        r,
        p,
        maxmem: 128 * N * r * 2,
      })
    } else {
      console.warn(`[auth] Método de hash não suportado: ${metodo}`)
      return false
    }

    const esperado = Buffer.from(hashEsperado, 'hex')
    if (derivado.length !== esperado.length) return false

    return crypto.timingSafeEqual(derivado, esperado)
  } catch (e) {
    console.error('[auth] Erro ao verificar senha:', e)
    return false
  }
}

/**
 * Gera um hash de senha no formato werkzeug (Flask).
 *
 * Compatível com `generate_password_hash` do Python e verificado
 * por `check_password_hash`. Útil para:
 *   - Ativar contas (criar senha nova)
 *   - Criar usuários via API admin
 *   - Resetar senha
 *
 * Formato gerado: pbkdf2:sha256:600000$<salt>$<hex_hash>
 *  - Algoritmo: PBKDF2-HMAC-SHA256
 *  - Iterações: 600.000 (padrão werkzeug 3.x)
 *  - Salt: 16 caracteres alfanuméricos aleatórios
 *  - Hash: 32 bytes em hexadecimal
 */
export function gerarHashWerkzeug(senha: string): string {
  const iterations = 600_000
  const digest = 'sha256'
  const saltLength = 16
  const keylen = 32

  // Werkzeug usa salt alfanumérico (a-z A-Z 0-9)
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const saltBytes = crypto.randomBytes(saltLength)
  let salt = ''
  for (let i = 0; i < saltLength; i++) {
    const byte = saltBytes[i]
    if (byte === undefined) continue
    const char = chars[byte % chars.length]
    if (char === undefined) continue
    salt += char
  }

  const hash = crypto
    .pbkdf2Sync(senha, salt, iterations, keylen, digest)
    .toString('hex')

  return `pbkdf2:${digest}:${iterations}$${salt}$${hash}`
}

// utils/helpers.ts

/**
 * Gera a porta customizada a partir do IP, garantindo SEMPRE 5 dígitos.
 *
 * Regra:
 *  - O 3º octeto (C) é mantido como está (1, 2 ou 3 dígitos)
 *  - O 4º octeto (D) é preenchido com zeros à esquerda para completar 5 dígitos
 *  - Se D tiver mais dígitos que o disponível, é truncado (raro)
 *
 * Exemplos:
 *   10.86.23.168    → "23168"
 *   10.86.33.19     → "33019"
 *   10.86.18.2      → "18002"
 *   177.137.252.77  → "25277"
 */
export function gerarPortaDoIp(ip: string | null | undefined): string | null {
  if (!ip) return null

  const partes = ip.split('.')
  if (partes.length !== 4) return null

  const terceiro = partes[2]
  if (terceiro === undefined) return null

  const quarto = Number(partes[3])
  if (!Number.isInteger(quarto) || quarto < 0 || quarto > 255) return null

  const quartoStr = String(quarto)

  // Quantos dígitos o 3º octeto pode ter, deixando espaço para o 4º
  const maxDigitosC = 5 - quartoStr.length
  if (maxDigitosC <= 0) return null

  // Usa o C completo se couber; senão, pega os últimos dígitos que caibam
  const terceiroFmt =
    terceiro.length <= maxDigitosC ? terceiro : terceiro.slice(-maxDigitosC)

  // Preenche o D à esquerda para completar 5 dígitos
  const digitosParaPreencher = 5 - terceiroFmt.length
  const quartoFmt = quartoStr.padStart(digitosParaPreencher, '0')

  return terceiroFmt + quartoFmt
}