// routes/sla.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'
import { parseHostid, parsePeriodo } from './_helpers.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/sla?inicio=...&fim=...
// Sumário de SLA (agregado) dos serviços do host
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/sla',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicio, fim } = parsePeriodo(req.query as any, 30)
      const sla = await ZabbixService.getHostServicesSla(hostid, inicio, fim)
      res.json(sla)
    } catch (e: unknown) {
      const msg = (e as Error).message
      const status = msg.includes('hostid inválido') ? 400 : 500
      res.status(status).json({ erro: msg })
    }
  },
)

export default router