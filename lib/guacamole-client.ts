// lib/guacamole-client.ts
import 'dotenv/config'

const TIMEOUT_MS = Number(process.env.GUAC_TIMEOUT_MS) || 5000
const RETRY = Number(process.env.GUAC_RETRY) || 2

export interface GuacFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  json?: unknown
  form?: Record<string, string>
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Wrapper de fetch com timeout e retry exponencial para a API do Guacamole.
 */
export async function guacFetch(url: string, opts: GuacFetchOptions = {}): Promise<Response> {
  const { method = 'GET', headers = {}, json, form } = opts

  let body: string | undefined
  const finalHeaders: Record<string, string> = { ...headers }

  if (form) {
    body = new URLSearchParams(form).toString()
    finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (json !== undefined) {
    body = JSON.stringify(json)
    finalHeaders['Content-Type'] = 'application/json'
  }

  let ultimoErro: unknown

  for (let tentativa = 0; tentativa <= RETRY; tentativa++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Monta o RequestInit condicionalmente para respeitar exactOptionalPropertyTypes
    const init: RequestInit = {
      method,
      headers: finalHeaders,
      signal: controller.signal,
    }
    if (body !== undefined) {
      init.body = body
    }

    try {
      const resp = await fetch(url, init)
      clearTimeout(timer)
      return resp
    } catch (e) {
      clearTimeout(timer)
      ultimoErro = e
      console.warn(
        `[guac] Erro tentativa ${tentativa + 1}/${RETRY + 1}:`,
        (e as Error).message,
      )
      if (tentativa < RETRY) await sleep(500 * Math.pow(2, tentativa))
    }
  }

  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error('Erro desconhecido ao chamar Guacamole')
}