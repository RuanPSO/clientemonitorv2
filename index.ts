// index.ts
import 'dotenv/config'

// Polyfill: converte BigInt em string ao serializar JSON.
// Garante que nenhum ID (hostid, itemid, eventid) quebre o res.json().
;(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { cacheStats, invalidateAll } from './lib/cache.js'
import authRoutes from './routes/auth.routes.js'
import hostRoutes from './routes/host.routes.js'
import grupoRoutes from './routes/grupo.routes.js'
import relatorioRoutes from './routes/relatorio.routes.js'
import slaRoutes from './routes/sla.routes.js'
import servicesRoutes from './routes/services.routes.js'
import guacamoleRoutes from './routes/guacamole.routes.js'
import incidentesRoutes from './routes/incidentes.routes.js'

const app = express()

// ─── Middlewares globais ───
app.use(cors())
app.use(express.json({ limit: '5mb' }))

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
app.use(hostRoutes)
app.use(grupoRoutes)
app.use(relatorioRoutes)
app.use(slaRoutes)
app.use(servicesRoutes)
app.use(guacamoleRoutes)
app.use(incidentesRoutes)

app.get('/health', (_req, res) => {
  res.json({
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
app.listen(PORT, () => {
  console.log(`🚀 API Zabbix rodando em http://localhost:${PORT}`)
})