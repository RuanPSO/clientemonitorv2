// routes/services.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'
import { parseHostid, parsePeriodoTimestamps } from './_helpers.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/services/history?inicio=...&fim=...
// Histórico de mudanças de estado (agrupado por serviço)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/services/history',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicioTs, fimTs } = parsePeriodoTimestamps(req.query as any, 30)
      const dados = await ZabbixService.getHostServicesHistory(hostid, inicioTs, fimTs)
      res.json(dados)
    } catch (e: unknown) {
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/services/timeline?inicio=...&fim=...
// Timeline de segmentos contínuos de estado (para gráficos)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/services/timeline',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicioTs, fimTs } = parsePeriodoTimestamps(req.query as any, 30)
      const dados = await ZabbixService.getHostTimeline(hostid, inicioTs, fimTs)
      res.json(dados)
    } catch (e: unknown) {
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

export default router