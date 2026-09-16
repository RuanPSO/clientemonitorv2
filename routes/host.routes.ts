// routes/host.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'
import { parseHostid, parsePeriodo, parsePeriodoTimestamps } from './_helpers.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/details
// Detalhes completos do host (com classificação)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/details',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const detalhes = await ZabbixService.getHostDetails(hostid)
      res.json(detalhes)
    } catch (e: unknown) {
      const msg = (e as Error).message
      const status = msg.includes('hostid inválido') ? 400 : 500
      res.status(status).json({ erro: msg })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/basico
// Info básica (id, host, hostname, status)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/basico',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const basico = await ZabbixService.getHostBasico(hostid)
      if (!basico) return res.status(404).json({ erro: 'Host não encontrado' })
      res.json(basico)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/services
// Lista de serviços com status ON/OFF
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/services',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const services = await ZabbixService.getHostServices(hostid)
      res.json(services)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/problemas
// Últimos 10 problemas do host
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/problemas',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const problemas = await ZabbixService.getProblemasHost(hostid)
      res.json(problemas)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

export default router