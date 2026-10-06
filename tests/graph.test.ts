import assert from 'node:assert/strict'
import axios, {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from 'axios'
import { test } from 'node:test'
import { getGraphGroups, getGraphProfile, GraphServiceError } from '../services/graph.js'

test('Graph aplica timeout, seleciona companyName e percorre paginação de grupos', async () => {
  const requests: InternalAxiosRequestConfig[] = []
  const originalAdapter = axios.defaults.adapter!
  axios.defaults.adapter = async (config) => {
    requests.push(config)
    const data = config.url?.includes('/memberOf')
      ? config.url.includes('$skiptoken')
        ? { value: [{ id: 'group-2' }] }
        : {
            value: [{ id: 'group-1' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=next',
          }
      : { id: 'profile-id', companyName: 'Example Co' }

    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    }
  }

  try {
    const profile = await getGraphProfile('mock-token')
    const groups = await getGraphGroups('mock-token')

    assert.equal(profile.companyName, 'Example Co')
    assert.deepEqual(groups, [{ id: 'group-1' }, { id: 'group-2' }])
    assert.equal(requests.length, 3)
    assert.ok(requests.every((request) => request.timeout === 10_000))
    assert.match(String(requests[0]?.params?.$select), /companyName/)
    assert.ok(requests.every((request) =>
      request.headers.get('Authorization') === 'Bearer mock-token'))
  } finally {
    axios.defaults.adapter = originalAdapter
  }
})

test('Graph mantém status original em falhas Axios', async () => {
  const originalAdapter = axios.defaults.adapter!
  axios.defaults.adapter = async (config) => {
    throw new AxiosError(
      'Graph error',
      undefined,
      config,
      undefined,
      {
        data: { error: { message: 'Permissão negada' } },
        status: 403,
        statusText: 'Forbidden',
        headers: new AxiosHeaders(),
        config,
      },
    )
  }

  try {
    await assert.rejects(
      getGraphProfile('mock-token'),
      (error: unknown) =>
        error instanceof GraphServiceError &&
        error.status === 403 &&
        error.message === 'Permissão negada',
    )
  } finally {
    axios.defaults.adapter = originalAdapter
  }
})

test('Graph informa erro de DNS sem expor detalhes da requisição', async () => {
  const originalAdapter = axios.defaults.adapter!
  axios.defaults.adapter = async (config) => {
    throw new AxiosError(
      'getaddrinfo ENOTFOUND graph.microsoft.com',
      'ENOTFOUND',
      config,
    )
  }

  try {
    await assert.rejects(
      getGraphProfile('mock-token'),
      (error: unknown) =>
        error instanceof GraphServiceError &&
        error.status === 502 &&
        error.message.includes('ENOTFOUND') &&
        error.message.includes('verifique DNS'),
    )
  } finally {
    axios.defaults.adapter = originalAdapter
  }
})
