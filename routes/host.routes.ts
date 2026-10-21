// routes/host.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { requireExperience, requireExperienceOrLegacyJwt } from '../middlewares/experience.middleware.js'
import { isHostGroupAllowed } from '../config/company-host-groups.js'
import { parseHostid, parsePeriodo, parsePeriodoTimestamps } from './_helpers.js'
import { getAllowedCompanyGroups } from './_company-scope.js'

const router = Router()

async function hostIsInSecondaryScope(
  req: Request,
  res: Response,
  hostid: bigint,
): Promise<boolean> {
  if (req.session?.experience !== 'secondary') return true

  const groups = await getAllowedCompanyGroups(req.session.allowedHostGroups ?? [])
  const groupids = groups.map((group) => group.groupid)
  if (groupids.length === 0 || !(await ZabbixService.hostBelongsToGroups(hostid, groupids))) {
    res.status(404).json({ erro: 'Host não encontrado' })
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/details
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/details',
  requireExperienceOrLegacyJwt('normal'),
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
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/basico',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      if (!(await hostIsInSecondaryScope(req, res, hostid))) return
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
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/services',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      if (!(await hostIsInSecondaryScope(req, res, hostid))) return
      const services = await ZabbixService.getHostServices(hostid)
      res.json(services)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/problemas
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/problemas',
  requireExperienceOrLegacyJwt('normal'),
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
// GET /host/by-name/:hostname/relatorio  (público)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/by-name/:hostname/relatorio',
  requireExperience('normal'),
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

// ─────────────────────────────────────────────────────────────
// GET /hosts/com-ip
// ─────────────────────────────────────────────────────────────
router.get('/hosts/com-ip', requireExperienceOrLegacyJwt(['normal', 'secondary']), async (req: Request, res: Response) => {
  try {
    let dados
    if (req.session?.experience === 'secondary') {
      const allowedHostGroups = req.session.allowedHostGroups ?? []
      if (allowedHostGroups.length === 0) return res.json([])

      const grupos = await ZabbixService.listarGrupos()
      const groupids = grupos
        .filter((grupo) => isHostGroupAllowed(grupo.name, allowedHostGroups))
        .map((grupo) => grupo.groupid)
      dados = await ZabbixService.listarHostsComIpPorGrupos(groupids)
    } else {
      dados = await ZabbixService.listarHostsComIp()
    }
    res.json(dados)
  } catch (e: unknown) {
    console.error('[hosts/com-ip]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /hosts/com-ip-e-so
// ─────────────────────────────────────────────────────────────
router.get('/hosts/com-ip-e-so', requireExperienceOrLegacyJwt('normal'), async (_req: Request, res: Response) => {
  try {
    const dados = await ZabbixService.listarHostsComIpESo()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[hosts/com-ip-e-so]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /hosts/status-ping-uptime
// ─────────────────────────────────────────────────────────────
router.get(
  '/hosts/status-ping-uptime',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request, res: Response) => {
    try {
      if (req.session?.experience === 'secondary') {
        const groups = await getAllowedCompanyGroups(req.session.allowedHostGroups ?? [])
        const groupids = groups.map((group) => group.groupid)
        if (groupids.length === 0) return res.json([])

        const hostids = new Set(await ZabbixService.listarHostsIdsPorGrupos(groupids))
        if (hostids.size === 0) return res.json([])
        const dados = await ZabbixService.getStatusPingUptimeAll()
        return res.json(dados.filter((host) => hostids.has(host.hostid)))
      }
      const dados = await ZabbixService.getStatusPingUptimeAll()
      res.json(dados)
    } catch (e: unknown) {
      console.error('[hosts/status-ping-uptime]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/com-ip
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/com-ip',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      if (!(await hostIsInSecondaryScope(req, res, hostid))) return
      const dados = await ZabbixService.getHostComIp(hostid)
      if (!dados) return res.status(404).json({ erro: 'Host não encontrado' })
      res.json(dados)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/active-services
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/active-services',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      if (!(await hostIsInSecondaryScope(req, res, hostid))) return
      const dados = await ZabbixService.getActiveServices(hostid)
      res.json(dados)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/relatorio-periodo
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/relatorio-periodo',
  requireExperienceOrLegacyJwt('normal'),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicio, fim } = parsePeriodo(req.query as any, 1)
      const dados = await ZabbixService.getRelatorioPorPeriodo(hostid, inicio, fim)
      res.json({ hostid: hostid.toString(), inicio, fim, ...dados })
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/serie?key=...&inicio=...&fim=...
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/serie',
  requireExperienceOrLegacyJwt('normal'),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { key } = req.query as { key?: string }
      const { inicio, fim } = parsePeriodo(req.query as any, 1)

      if (!key) return res.status(400).json({ erro: 'Parâmetro key é obrigatório' })

      const dados = await ZabbixService.getSeriePorKey(hostid, key, inicio, fim)
      res.json({ hostid: hostid.toString(), key, inicio, fim, pontos: dados })
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/metrics
// ✅ Agora usa getHostMetricsPayload() — mesma saída, cacheada.
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/metrics',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      if (!(await hostIsInSecondaryScope(req, res, hostid))) return
      const payload = await ZabbixService.getHostMetricsPayload(hostid)
      res.json(payload)
    } catch (e: unknown) {
      console.error('[host/metrics]', e)
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

export default router