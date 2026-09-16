// routes/_helpers.ts
import { isoParaTimestamp } from '../utils/helpers.js'

/**
 * Valida e converte um parâmetro de rota em BigInt.
 * Lança erro se não for numérico.
 */
export function parseHostid(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`hostid inválido: "${raw}" (deve ser numérico)`)
  }
  return BigInt(raw)
}

/**
 * Extrai início/fim/agrupamento dos query params, com defaults.
 * Retorna strings no formato "YYYY-MM-DD HH:MM:SS" e o agrupamento.
 */
export function parsePeriodo(
  query: Record<string, unknown>,
  defaultDias = 30,
): { inicio: string; fim: string; agrupamento: string } {
  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

  const agora = new Date()
  const fimDefault = fmt(agora)
  const inicioDefault = fmt(new Date(agora.getTime() - defaultDias * 86400_000))

  let inicio = (query.inicio as string | undefined)?.replace('T', ' ') ?? inicioDefault
  let fim = (query.fim as string | undefined)?.replace('T', ' ') ?? fimDefault
  const agrupamento = (query.agrupamento as string | undefined) ?? '15min'

  return { inicio, fim, agrupamento }
}

/**
 * Converte query params inicio/fim (strings ISO) em timestamps.
 */
export function parsePeriodoTimestamps(
  query: Record<string, unknown>,
  defaultDias = 30,
): { inicioTs: number; fimTs: number } {
  const { inicio, fim } = parsePeriodo(query, defaultDias)
  return { inicioTs: isoParaTimestamp(inicio), fimTs: isoParaTimestamp(fim) }
}