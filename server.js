import 'dotenv/config'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { mkdir, lstat, readdir, stat } from 'node:fs/promises'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import multer from 'multer'
import GuacamoleLite from 'guacamole-lite'

const TOKEN_TTL_MS = 60_000
const MAX_PENDING_TOKENS = 10_000
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const RDP_HOSTNAME = 'ts.datacore.com.br'

function requiredString(env, name, { minLength = 1 } = {}) {
  const value = env[name]
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < minLength) {
    throw new Error(`${name} precisa ser definido e ter pelo menos ${minLength} bytes`)
  }
  return value
}

function parsePort(value, name, fallback) {
  const port = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} deve ser um inteiro entre 1 e 65535`)
  }
  return port
}

function buildConfig(env = process.env) {
  const port = parsePort(env.GUAC_PORT, 'GUAC_PORT', 8190)
  const key = Buffer.from(requiredString(env, 'GUAC_KEY'), 'utf8')
  if (key.length !== 32) {
    throw new Error('GUAC_KEY deve conter exatamente 32 bytes UTF-8 para AES-256-CBC')
  }

  const publicWsUrl = new URL(env.GUAC_WS_PUBLIC_URL ?? `ws://localhost:${port}`)
  if (
    !['ws:', 'wss:'].includes(publicWsUrl.protocol) ||
    publicWsUrl.username ||
    publicWsUrl.password ||
    publicWsUrl.search ||
    publicWsUrl.hash
  ) {
    throw new Error('GUAC_WS_PUBLIC_URL deve ser uma URL ws:// ou wss:// sem credenciais nem query')
  }

  const frontendOrigins = (
    env.CORS_ORIGINS ?? env.FRONTEND_URL ?? 'http://localhost:5173'
  ).split(',').map((origin) => new URL(origin.trim()).origin)

  const maxUploadBytes = Number(env.GUAC_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES)
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new Error('GUAC_MAX_UPLOAD_BYTES deve ser um inteiro positivo')
  }

  return {
    port,
    apiToken: requiredString(env, 'API_BEARER_TOKEN', { minLength: 32 }),
    key,
    guacdHost: env.GUACD_HOST ?? '127.0.0.1',
    guacdPort: parsePort(env.GUACD_PORT, 'GUACD_PORT', 4822),
    drivePath: path.resolve(env.GUAC_DRIVE_PATH ?? '/var/lib/guacamole/drives'),
    publicWsUrl,
    frontendOrigins: new Set(frontendOrigins),
    maxUploadBytes,
  }
}

function encryptToken(value, key) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const asciiJson = JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  const encrypted = Buffer.concat([
    cipher.update(asciiJson, 'utf8'),
    cipher.final(),
  ])
  return Buffer.from(JSON.stringify({
    iv: iv.toString('base64'),
    value: encrypted.toString('base64'),
  })).toString('base64')
}

function safeFilename(filename) {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename === '.' ||
    filename === '..' ||
    /[\\/\0-\x1f\x7f]/.test(filename) ||
    path.basename(filename) !== filename
  ) {
    return false
  }
  return true
}

function sendUpgradeError(socket, status, message) {
  if (socket.destroyed) return
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
  socket.destroy()
}

export async function createGateway(config = buildConfig()) {
  await mkdir(config.drivePath, { recursive: true, mode: 0o750 })

  const app = express()
  const server = createServer(app)
  const pendingTokens = new Map()
  const websocketPath = config.publicWsUrl.pathname.replace(/\/+$/, '') || '/'

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.has(origin)) return callback(null, true)
      return callback(new Error('Origem CORS não autorizada'))
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }))
  app.use(express.json({ limit: '16kb' }))

  function authenticate(req, res, next) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') ?? '')
    if (!match) return res.status(401).json({ error: 'Authorization Bearer obrigatório' })

    const received = Buffer.from(match[1], 'utf8')
    const expected = Buffer.from(config.apiToken, 'utf8')
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return res.status(401).json({ error: 'Token inválido' })
    }
    return next()
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api', authenticate)

  app.post('/api/guacamole/token', (req, res) => {
    const { username, password } = req.body ?? {}
    const rawPort = req.body?.port
    const port = typeof rawPort === 'string' && /^\d+$/.test(rawPort)
      ? Number(rawPort)
      : rawPort
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'port deve ser um inteiro entre 1 e 65535' })
    }
    if (
      typeof username !== 'string' ||
      username.trim().length === 0 ||
      username.trim().length > 256 ||
      username.includes('\\') ||
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > 512
    ) {
      return res.status(400).json({ error: 'username e password são obrigatórios e devem ser válidos' })
    }
    for (const [issuedToken, metadata] of pendingTokens) {
      if (metadata.expiresAt <= Date.now()) pendingTokens.delete(issuedToken)
    }
    if (pendingTokens.size >= MAX_PENDING_TOKENS) {
      return res.status(503).json({ error: 'Limite temporário de sessões pendentes atingido' })
    }

    const token = encryptToken({
      connection: {
        type: 'rdp',
        settings: {
          hostname: RDP_HOSTNAME,
          port: String(port),
          username: username.trim(),
          password,
          domain: RDP_HOSTNAME,
          width: 1024,
          height: 768,
          dpi: 96,
          security: 'any',
          'ignore-cert': true,
          'enable-drive': true,
          'drive-path': config.drivePath,
          'create-drive-path': true,
          'enable-wallpaper': false,
        },
      },
    }, config.key)

    pendingTokens.set(token, {
      expiresAt: Date.now() + TOKEN_TTL_MS,
      hostname: RDP_HOSTNAME,
      username: username.trim(),
    })

    const websocketUrl = new URL(config.publicWsUrl)
    websocketUrl.searchParams.set('token', token)
    res.set('Cache-Control', 'no-store')
    return res.status(200).json({
      token,
      websocketUrl: websocketUrl.toString(),
    })
  })

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.drivePath,
      filename(_req, file, callback) {
        const originalName = path.basename(file.originalname.replaceAll('\\', '/'))
        const safeName = originalName
          .normalize('NFKC')
          .replace(/[^A-Za-z0-9._ ()-]/g, '_')
          .replace(/^\.+/, '')
          .slice(0, 120) || 'upload'
        callback(null, `${crypto.randomUUID()}-${safeName}`)
      },
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  })

  app.post('/api/files/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo no campo "file"' })
    return res.status(201).json({
      name: req.file.filename,
      size: req.file.size,
    })
  })

  app.get('/api/files', async (_req, res, next) => {
    try {
      const entries = await readdir(config.drivePath, { withFileTypes: true })
      const files = await Promise.all(entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(config.drivePath, entry.name)
          const metadata = await stat(filePath)
          return {
            name: entry.name,
            size: metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
          }
        }))
      return res.json(files)
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/files/download/:filename', async (req, res, next) => {
    const { filename } = req.params
    if (!safeFilename(filename)) {
      return res.status(400).json({ error: 'filename inválido' })
    }

    const filePath = path.resolve(config.drivePath, filename)
    if (!filePath.startsWith(`${config.drivePath}${path.sep}`)) {
      return res.status(400).json({ error: 'filename inválido' })
    }

    try {
      const metadata = await lstat(filePath)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        return res.status(404).json({ error: 'Arquivo não encontrado' })
      }
      return res.download(filePath, filename, (error) => {
        if (error) next(error)
      })
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Arquivo não encontrado' })
      }
      return next(error)
    }
  })

  app.use((req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` })
  })

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo excede o limite permitido' })
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: 'Upload inválido' })
    }
    console.error('[guac-api] Falha ao processar requisição:', error)
    return res.status(500).json({ error: 'Erro interno do servidor' })
  })

  server.on('upgrade', (request, socket) => {
    let requestUrl
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost')
    } catch {
      return sendUpgradeError(socket, '400 Bad Request', 'Invalid request')
    }

    if (requestUrl.pathname !== websocketPath) {
      return sendUpgradeError(socket, '404 Not Found', 'Not found')
    }

    const origin = request.headers.origin
    if (origin && !config.frontendOrigins.has(origin)) {
      return sendUpgradeError(socket, '403 Forbidden', 'Origin not allowed')
    }

    const tokens = requestUrl.searchParams.getAll('token')
    if (tokens.length !== 1) {
      return sendUpgradeError(socket, '401 Unauthorized', 'Unauthorized')
    }

    const token = tokens[0]
    const metadata = pendingTokens.get(token)
    if (!metadata || metadata.expiresAt <= Date.now()) {
      pendingTokens.delete(token)
      return sendUpgradeError(socket, '401 Unauthorized', 'Unauthorized')
    }

    pendingTokens.delete(token)
    console.info('[guac-ws] Upgrade autorizado', {
      hostname: metadata.hostname,
      username: metadata.username,
    })
  })

  const guacServer = new GuacamoleLite(
    { server },
    { host: config.guacdHost, port: config.guacdPort },
    {
      crypt: { cypher: 'AES-256-CBC', key: config.key },
      log: {
        level: 'ERRORS',
        stdLog: (message) => console.info('[guac-lite]', message),
        errorLog: (message) => console.error('[guac-lite]', message),
      },
    },
  )

  guacServer.on('open', (clientConnection) => {
    const connection = clientConnection.connectionSettings?.connection
    const settings = connection?.settings ?? connection ?? {}
    console.info('[guac-session] Iniciada', {
      connectionId: clientConnection.connectionId,
      guacamoleConnectionId: clientConnection.guacamoleConnectionId,
      hostname: settings.hostname,
      username: settings.username,
    })
  })

  guacServer.on('close', (clientConnection, error) => {
    const connection = clientConnection.connectionSettings?.connection
    const settings = connection?.settings ?? connection ?? {}
    console.info('[guac-session] Encerrada', {
      connectionId: clientConnection.connectionId,
      guacamoleConnectionId: clientConnection.guacamoleConnectionId,
      hostname: settings.hostname,
      username: settings.username,
      errorCode: error?.code,
    })
  })

  return {
    app,
    server,
    guacServer,
    config,
    async close() {
      guacServer.close()
      if (!server.listening) return
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    },
  }
}

const isMainModule = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  const config = buildConfig()
  createGateway(config).then(({ server }) => {
    server.listen(config.port, '0.0.0.0', () => {
      console.info(`[guac-api] Express e WebSocket escutando na porta ${config.port}`)
    })
  }).catch((error) => {
    console.error('[guac-api] Não foi possível iniciar o serviço:', error.message)
    process.exitCode = 1
  })
}
