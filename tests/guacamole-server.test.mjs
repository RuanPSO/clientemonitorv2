import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import { once } from 'node:events'
import { connect } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createGateway } from '../server.js'

const bearerToken = 'test-token-with-at-least-thirty-two-bytes'
const guacKey = Buffer.from('12345678901234567890123456789012')

async function websocketUpgrade(port, token, origin = 'http://localhost:5173') {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  socket.write([
    `GET /?token=${encodeURIComponent(token)} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    `Origin: ${origin}`,
    '',
    '',
  ].join('\r\n'))
  const [data] = await once(socket, 'data')
  socket.destroy()
  return data.toString('utf8')
}

test('gateway autentica rotas, emite token RDP e protege o diretório de transferência', async () => {
  const drivePath = await mkdtemp(path.join(tmpdir(), 'guac-gateway-'))
  const gateway = await createGateway({
    port: 0,
    apiToken: bearerToken,
    key: guacKey,
    guacdHost: '127.0.0.1',
    guacdPort: 4822,
    drivePath,
    publicWsUrl: new URL('ws://localhost:8190'),
    frontendOrigins: new Set(['http://localhost:5173']),
    maxUploadBytes: 1024,
  })

  try {
    gateway.server.listen(0, '127.0.0.1')
    await once(gateway.server, 'listening')
    const address = gateway.server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const unauthorized = await fetch(`${baseUrl}/api/files`)
    assert.equal(unauthorized.status, 401)
    const unauthorizedToken = await fetch(`${baseUrl}/api/guacamole/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'usuario', password: 'secret', port: 3389 }),
    })
    assert.equal(unauthorizedToken.status, 401)
    const headers = {
      authorization: `Bearer ${bearerToken}`,
      'content-type': 'application/json',
    }
    const issuedResponse = await fetch(`${baseUrl}/api/guacamole/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'usuario',
        password: 'senha-com-ç',
        port: 3389,
      }),
    })
    assert.equal(issuedResponse.status, 200)
    const issued = await issuedResponse.json()
    assert.deepEqual(Object.keys(issued).sort(), ['token', 'websocketUrl'])
    assert.equal(new URL(issued.websocketUrl).searchParams.get('token'), issued.token)

    const encrypted = JSON.parse(Buffer.from(issued.token, 'base64').toString('utf8'))
    const decipher = createDecipheriv(
      'aes-256-cbc',
      guacKey,
      Buffer.from(encrypted.iv, 'base64'),
    )
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.value, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    const settings = JSON.parse(plaintext).connection.settings
    assert.equal(settings.hostname, 'ts.datacore.com.br')
    assert.equal(settings.port, '3389')
    assert.equal(settings.username, 'usuario')
    assert.equal(settings.domain, 'ts.datacore.com.br')
    assert.equal(settings.password, 'senha-com-ç')
    assert.equal(settings['drive-path'], drivePath)

    const numericStringPortResponse = await fetch(`${baseUrl}/api/guacamole/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'user2', password: 'secret', port: '3390' }),
    })
    assert.equal(numericStringPortResponse.status, 200)
    const numericStringPortToken = await numericStringPortResponse.json()
    const secondEncrypted = JSON.parse(Buffer.from(numericStringPortToken.token, 'base64').toString('utf8'))
    const secondDecipher = createDecipheriv(
      'aes-256-cbc',
      guacKey,
      Buffer.from(secondEncrypted.iv, 'base64'),
    )
    const secondPlaintext = Buffer.concat([
      secondDecipher.update(Buffer.from(secondEncrypted.value, 'base64')),
      secondDecipher.final(),
    ]).toString('utf8')
    assert.equal(JSON.parse(secondPlaintext).connection.settings.port, '3390')

    const badOriginUpgrade = await websocketUpgrade(
      address.port,
      'unissued-token',
      'https://unexpected.example',
    )
    assert.match(badOriginUpgrade, /^HTTP\/1\.1 403 Forbidden/)
    const badTokenUpgrade = await websocketUpgrade(address.port, 'unissued-token')
    assert.match(badTokenUpgrade, /^HTTP\/1\.1 401 Unauthorized/)

    const unauthenticatedUpload = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      body: new FormData(),
    })
    assert.equal(unauthenticatedUpload.status, 401)

    const form = new FormData()
    form.append('file', new Blob(['transfer data']), '..\\transfer.txt')
    const uploadResponse = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearerToken}` },
      body: form,
    })
    assert.equal(uploadResponse.status, 201)
    const uploaded = await uploadResponse.json()

    const filesResponse = await fetch(`${baseUrl}/api/files`, {
      headers: { authorization: `Bearer ${bearerToken}` },
    })
    assert.equal(filesResponse.status, 200)
    assert.equal((await filesResponse.json())[0].name, uploaded.name)

    const downloadResponse = await fetch(
      `${baseUrl}/api/files/download/${encodeURIComponent(uploaded.name)}`,
      { headers: { authorization: `Bearer ${bearerToken}` } },
    )
    assert.equal(downloadResponse.status, 200)
    assert.equal(await downloadResponse.text(), 'transfer data')
  } finally {
    await gateway.close()
    await rm(drivePath, { recursive: true, force: true })
  }
})
