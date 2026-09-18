// lib/cache.ts
import { LRUCache } from 'lru-cache'

interface Entry<T> {
  value: T
}

// Store interno — TTL configurado por entrada ao chamar `cached()`
const store = new LRUCache<string, Entry<unknown>>({
  max: 2000,           // no máximo 2000 entradas
  ttl: 60_000,         // 60s default (pode ser sobrescrito)
  updateAgeOnGet: false,
  updateAgeOnHas: false,
})
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Executa `fn` se o cache estiver vazio ou expirado.
 * Caso contrário, retorna o valor em cache.
 *
 * @param key     Chave única (ex.: "host:11325:details")
 * @param fn      Função que produz o valor (só chamada em miss)
 * @param ttlMs   Tempo de vida em ms (default: 60s)
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 60_000,
): Promise<T> {
  const hit = store.get(key)
  if (hit !== undefined) {
    if (process.env.CACHE_DEBUG === '1') console.log(`[cache] HIT  ${key}`)
    return hit.value as T
  }

  const pending = inFlight.get(key)
  if (pending !== undefined) return pending as Promise<T>

  if (process.env.CACHE_DEBUG === '1') console.log(`[cache] MISS ${key}`)
  const request = fn()
    .then((value) => {
      store.set(key, { value }, { ttl: ttlMs })
      return value
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

/**
 * Invalida entradas cujo prefixo case com `prefix`.
 * Ex.: invalidate('host:11325') remove host:11325:details, host:11325:relatorio, etc.
 * Retorna o número de entradas removidas.
 */
export function invalidate(prefix: string): number {
  let count = 0
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      count++
    }
  }
  return count
}

/**
 * Limpa todo o cache.
 */
export function invalidateAll(): void {
  store.clear()
  inFlight.clear()
}

/**
 * Estatísticas do cache (útil em /health).
 */
export function cacheStats() {
  return {
    size: store.size,
    max: store.max,
  }
}