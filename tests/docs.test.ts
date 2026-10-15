import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import docsRoutes from '../routes/docs.routes.js'
import { apiOperations, openApiDocument } from '../routes/docs.openapi.js'

async function startDocumentationApi() {
  const app = express()
  app.use(docsRoutes)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

test('OpenAPI deriva versão, caminhos e operações do catálogo confirmado', () => {
  assert.equal(openApiDocument.openapi, '3.0.3')
  assert.match(openApiDocument.info.version, /^\d+\.\d+\.\d+/)
  assert.equal(
    Object.values(openApiDocument.paths).reduce(
      (total, methods) => total + Object.keys(methods).length,
      0,
    ),
    apiOperations.length,
  )

  const operationIds = apiOperations.map((operation) => operation.operationId)
  assert.equal(new Set(operationIds).size, operationIds.length)
  for (const [path, methods] of Object.entries(openApiDocument.paths)) {
    for (const operation of Object.values(methods)) {
      assert.ok(operation?.tags.length)
      assert.ok(operation?.responses['200'] || operation?.responses['201'] || operation?.responses['302'])
      for (const name of path.matchAll(/\{([^}]+)\}/g)) {
        assert.ok(operation?.parameters?.some(
          (parameter) => parameter.in === 'path' && parameter.name === name[1] && parameter.required,
        ))
      }
    }
  }
  assert.ok(openApiDocument.paths['/host/{hostid}/serie']?.get?.parameters?.some(
    (parameter) => parameter.name === 'key' && parameter.required,
  ))
  assert.ok(openApiDocument.paths['/host/{hostid}/relatorio']?.post?.requestBody)
  assert.deepEqual(
    openApiDocument.paths['/host/{hostid}/metrics']?.get?.security,
    [{ bearerAuth: [] }],
  )
  assert.equal(openApiDocument.paths['/auth/me']?.get?.security?.[0]?.microsoftSession?.length, 0)

  const documentedPaths = Object.keys(openApiDocument.paths)
  assert.ok(!documentedPaths.includes('/auth/token'))
  assert.ok(!documentedPaths.some((path) => /\/(admin|debug|fix-domain|fix-target)(\/|$)/.test(path)))
})

test('Express serve a página, os recursos estáticos e OpenAPI sem autenticação', async () => {
  const api = await startDocumentationApi()
  try {
    const page = await fetch(`${api.baseUrl}/docs`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await page.text(), /Documentação da API/)

    const stylesheet = await fetch(`${api.baseUrl}/docs/docs.css`)
    assert.equal(stylesheet.status, 200)
    assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/)

    const script = await fetch(`${api.baseUrl}/docs/docs.js`)
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type') ?? '', /javascript/)

    const specification = await fetch(`${api.baseUrl}/docs/openapi.json`)
    assert.equal(specification.status, 200)
    assert.match(specification.headers.get('content-type') ?? '', /application\/json/)
    const document = await specification.json()
    assert.equal(document.openapi, '3.0.3')
    assert.equal(document.info.version, openApiDocument.info.version)
  } finally {
    await api.close()
  }
})
