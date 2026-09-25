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

// ─────────────────────────────────────────────────────────────
// GET /hosts/com-ip
// Lista hosts com IP
// ─────────────────────────────────────────────────────────────
router.get('/hosts/com-ip', validarToken, async (_req: Request, res: Response) => {
  try {
    const dados = await ZabbixService.listarHostsComIp()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[hosts/com-ip]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /hosts/com-ip-e-so
// Lista hosts com IP + SO + porta customizada
// ─────────────────────────────────────────────────────────────
router.get('/hosts/com-ip-e-so', validarToken, async (_req: Request, res: Response) => {
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
// Status de TODOS os hosts em 1 chamada
// ─────────────────────────────────────────────────────────────
router.get('/hosts/status-ping-uptime', validarToken, async (_req: Request, res: Response) => {
  try {
    const dados = await ZabbixService.getStatusPingUptimeAll()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[hosts/status-ping-uptime]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/com-ip
// Host + IP + porta customizada
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/com-ip',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
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
// Triggers ativas com severity >= 2
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/active-services',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const dados = await ZabbixService.getActiveServices(hostid)
      res.json(dados)
    } catch (e: unknown) {
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/relatorio-periodo
// Resumo min/avg/max de CPU, memória e disponibilidade
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/relatorio-periodo',
  validarToken,
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
// Série de um item específico
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/serie',
  validarToken,
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
// Payload COMPOSTO idêntico ao get_host_metrics() do Python
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/metrics',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)

      // ✅ Agora usa getStatusPingUptime (1 host) em vez de All (todos)
      const [details, comIp, basico, statusInfo] = await Promise.all([
        ZabbixService.getHostDetails(hostid),
        ZabbixService.getHostComIp(hostid),
        ZabbixService.getHostBasico(hostid),
        ZabbixService.getStatusPingUptime(hostid),   // ← MUDOU
      ])

      res.json({
        hostid: hostid.toString(),
        nome: basico?.host ?? null,
        ip: comIp?.ip ?? null,
        porta_customizada: comIp?.porta_customizada ?? null,

        status: statusInfo.status,
        host_status: statusInfo.host_status,
        icmp_ping: statusInfo.icmp_ping,
        latency_ms: statusInfo.latency_ms,
        uptime_seconds: statusInfo.uptime_seconds,
        uptime_days: statusInfo.uptime_days,

        cpu: details.cpu,
        memoria: details.memoria,
        discos: details.discos,
        os: details.os?.name ?? details.os?.type?.toUpperCase() ?? 'UNKNOWN',
        os_type: details.os?.type ?? 'unknown',
        services: details.services,
      })
    } catch (e: unknown) {
      console.error('[host/metrics]', e)
      res.status(400).json({ erro: (e as Error).message })
    }
  },
)

export default router