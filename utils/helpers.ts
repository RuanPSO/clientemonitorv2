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