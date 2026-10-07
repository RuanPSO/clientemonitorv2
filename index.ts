// index.ts
import './config/env.js'

// Polyfill: converte BigInt em string ao serializar JSON.
// Garante que nenhum ID (hostid, itemid, eventid) quebre o res.json().
;(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

import express, { type Request, type Response, type NextFunction } from 'express'
import session from 'express-session'
import helmet from 'helmet'
import morgan from 'morgan'
import { createCorsMiddleware } from './config/cors.js'
import { getSessionCookieOptions } from './config/session.js'
import { cacheStats, invalidateAll } from './lib/cache.js'
import authRoutes from './routes/auth.routes.js'
import entraAuthRoutes from './routes/entra-auth.routes.js'
import hostRoutes from './routes/host.routes.js'
import grupoRoutes from './routes/grupo.routes.js'
import relatorioRoutes from './routes/relatorio.routes.js'
import slaRoutes from './routes/sla.routes.js'
import servicesRoutes from './routes/services.routes.js'
import guacamoleRoutes from './routes/guacamole.routes.js'
import incidentesRoutes from './routes/incidentes.routes.js'
import { validateMicrosoftAuthEnv } from './config/env.js'
import { logger } from './utils/logger.js'

const app = express()
try {
  validateMicrosoftAuthEnv()
} catch (error) {
  const reason = error instanceof Error ? error.message : 'Erro desconhecido na configuração'

  console.error([
    '',
    '❌ Não foi possível iniciar a API: configuração inválida.',
    `   ${reason}`,
    '',
    '   Para autenticação Microsoft local, confira no arquivo .env:',
    '   AZURE_REDIRECT_URI=http://localhost:3000/auth/callback',
    '   PORT=3000',
    '',
    '   Cadastre a mesma URI no Entra ID em Authentication > Web e reinicie a API.',
    '',
  ].join('\n'))
  process.exit(1)
}
const frontendUrl = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173').origin

// ─── Middlewares globais ───
app.use(helmet())
app.use(createCorsMiddleware(frontendUrl))
app.use(express.json({ limit: '5mb' }))
morgan.token('path', (req) => (req as Request).path)
app.use(morgan(':method :path :status :response-time ms'))
app.use(session({
  name: 'clientemonitor.sid',
  secret: process.env.SESSION_SECRET ?? '',
  resave: false,
  saveUninitialized: false,
  cookie: getSessionCookieOptions(),
}))

// ─── Rota raiz (health check) ───
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    servico: 'API Zabbix',
    versao: '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

// ─── Rotas da aplicação ───
app.use(authRoutes)
app.use('/auth', entraAuthRoutes)
app.use(hostRoutes)
app.use(grupoRoutes)
app.use(relatorioRoutes)
app.use(slaRoutes)
app.use(servicesRoutes)
app.use(guacamoleRoutes)
app.use(incidentesRoutes)

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ok: true,
    cache: cacheStats(),
    uptime_s: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

// Rota admin para limpar cache (bloqueada em produção)
if (process.env.NODE_ENV !== 'production') {
  app.post('/admin/cache/clear', (_req, res) => {
    invalidateAll()
    res.json({ ok: true, msg: 'Cache limpo' })
  })
}

// ─── 404 para rotas não encontradas ───
app.use((req: Request, res: Response) => {
  res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.path}` })
})

// ─── Tratamento de erros global ───
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('💥 Erro não tratado:', err)
  res.status(500).json({ erro: 'Erro interno do servidor' })
})

// ─── Inicialização ───
const PORT = Number(process.env.PORT) || 3000

logger.info('Configuração Microsoft carregada', {
  clientId: process.env.AZURE_CLIENT_ID,
  tenantId: process.env.AZURE_TENANT_ID,
  secretLength: process.env.AZURE_CLIENT_SECRET?.length ?? 0,
  redirectUri: process.env.AZURE_REDIRECT_URI,
})
if (process.env.NODE_ENV === 'production') {
  logger.warn('A sessão Express está usando MemoryStore; configure um armazenamento persistente antes de produção')
}

app.listen(PORT, () => {
  console.log([
    '',
    '✅ API ClientMonitor iniciada',
    `   Ambiente: ${process.env.NODE_ENV ?? 'development'}`,
    `   API:      http://localhost:${PORT} (IPv4/IPv6)`,
    `   API IPv4: http://127.0.0.1:${PORT}`,
    `   Health:   http://localhost:${PORT}/health`,
    `   Login:    http://localhost:${PORT}/auth/login`,
    `   Callback: ${process.env.AZURE_REDIRECT_URI}`,
    `   Frontend: ${frontendUrl}`,
    '',
  ].join('\n'))
  logger.info('API iniciada', {
    port: PORT,
    urls: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
  })
})