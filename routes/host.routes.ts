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


// ─────────────────────────────────────────────────────────────
// GET /host/by-name/:hostname/relatorio
// Retorna CPU, Memória, Discos, Serviços do host pelo NOME
// Query: ?inicio=YYYY-MM-DD HH:MM:SS&fim=...&agrupamento=15min
//
// Endpoint público (sem validarToken) para o Flask consumir.
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/by-name/:hostname/relatorio',
  async (req: Request<{ hostname: string }>, res: Response) => {
    try {
      const { hostname } = req.params
      const { inicio, fim, agrupamento } = req.query as Record<string, string | undefined>

      if (!inicio || !fim) {
        return res.status(400).json({ erro: 'inicio e fim são obrigatórios' })
      }

      const dados = await ZabbixService.getRelatorioPorNome(
        decodeURIComponent(hostname),
        inicio,
        fim,
        agrupamento ?? '15min',
      )

      if (!dados) {
        return res.status(404).json({ erro: `Host "${hostname}" não encontrado` })
      }

      res.json(dados)
    } catch (e: unknown) {
      console.error('[host/by-name/relatorio]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)


export default router