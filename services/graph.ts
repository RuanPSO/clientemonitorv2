import axios, { type AxiosError } from 'axios'
import { logger } from '../utils/logger.js'

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_TIMEOUT_MS = 10_000

export class GraphServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GraphServiceError'
  }
}

function graphError(error: unknown): GraphServiceError {
  if (!axios.isAxiosError(error)) {
    return new GraphServiceError('Falha ao consultar Microsoft Graph', 502)
  }

  const axiosError = error as AxiosError<{ error?: { message?: string } }>
  const status = axiosError.response?.status ?? 502
  const networkCode = axiosError.code
  const networkFailureCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT'])
  const message = axiosError.response?.data?.error?.message ??
    (networkCode && networkFailureCodes.has(networkCode)
      ? `Falha de conexão com Microsoft Graph (${networkCode}); verifique DNS e acesso HTTPS`
      : 'Falha ao consultar Microsoft Graph')

  if (!axiosError.response) {
    logger.error('Falha de rede ao consultar Microsoft Graph', {
      networkCode: networkCode ?? 'UNKNOWN',
    })
  }

  return new GraphServiceError(message, status)
}

function headers(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` }
}

export async function getGraphProfile(accessToken: string): Promise<Record<string, unknown>> {
  try {
    const response = await axios.get(`${GRAPH_BASE_URL}/me`, {
      headers: headers(accessToken),
      params: {
        $select: [
          'id', 'displayName', 'mail', 'companyName', 'jobTitle', 'department',
          'officeLocation', 'mobilePhone', 'businessPhones', 'preferredLanguage',
          'userPrincipalName',
        ].join(','),
      },
      timeout: GRAPH_TIMEOUT_MS,
    })
    logger.debug('Microsoft Graph profile payload', response.data)
    return response.data as Record<string, unknown>
  } catch (error) {
    throw graphError(error)
  }
}

export async function getGraphGroups(accessToken: string): Promise<unknown[]> {
  try {
    const groups: unknown[] = []
    let nextUrl: string | undefined = `${GRAPH_BASE_URL}/me/memberOf`

    while (nextUrl) {
      const response = await axios.get<{ value?: unknown[]; '@odata.nextLink'?: string }>(nextUrl, {
        headers: headers(accessToken),
        timeout: GRAPH_TIMEOUT_MS,
      })
      groups.push(...(response.data.value ?? []))
      const candidate = response.data['@odata.nextLink']
      if (!candidate) {
        nextUrl = undefined
      } else {
        const parsed = new URL(candidate)
        if (parsed.origin !== GRAPH_ORIGIN) {
          throw new GraphServiceError('Microsoft Graph retornou paginação inválida', 502)
        }
        nextUrl = parsed.toString()
      }
    }

    return groups
  } catch (error) {
    if (error instanceof GraphServiceError) throw error
    throw graphError(error)
  }
}

export async function getGraphPhoto(accessToken: string): Promise<Buffer> {
  try {
    const response = await axios.get<ArrayBuffer>(`${GRAPH_BASE_URL}/me/photo/$value`, {
      headers: headers(accessToken),
      responseType: 'arraybuffer',
      timeout: GRAPH_TIMEOUT_MS,
    })
    return Buffer.from(response.data)
  } catch (error) {
    throw graphError(error)
  }
}
