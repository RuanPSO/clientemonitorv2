// routes/relatorio.routes.ts
import { Router } from 'express'
import type { Request, Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { RelatorioService } from '../services/relatorio.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'
import { parseHostid, parsePeriodo } from './_helpers.js'
import { isoParaTimestamp } from '../utils/helpers.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /host/:hostid/relatorio
// Relatório inteligente (CPU, memória, discos, disponibilidade, serviços)
// ─────────────────────────────────────────────────────────────
router.get(
  '/host/:hostid/relatorio',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicio, fim, agrupamento } = parsePeriodo(req.query as any, 30)
      const dados = await ZabbixService.getRelatorioHostInteligente(hostid, inicio, fim, agrupamento)
      res.json({ hostid: hostid.toString(), inicio, fim, agrupamento, dados })
    } catch (e: unknown) {
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// POST /host/:hostid/relatorio
// Mesma coisa, mas recebe o período no body (JSON)
// ─────────────────────────────────────────────────────────────
router.post(
  '/host/:hostid/relatorio',
  validarToken,
  async (req: Request<{ hostid: string }>, res: Response) => {
    try {
      const hostid = parseHostid(req.params.hostid)
      const { inicio, fim, agrupamento = '15min' } = req.body ?? {}

      if (!inicio || !fim) {
        return res.status(400).json({ erro: "Parâmetros 'inicio' e 'fim' são obrigatórios" })
      }

      const dados = await ZabbixService.getRelatorioHostInteligente(hostid, inicio, fim, agrupamento)
      res.json({ hostid: hostid.toString(), inicio, fim, agrupamento, dados })
    } catch (e: unknown) {
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /relatorio/disponibilidade?hostids=1,2,3&inicio=...&fim=...
// Relatório de disponibilidade multi-host (agrupado por categoria)
// ─────────────────────────────────────────────────────────────
router.get('/relatorio/disponibilidade', validarToken, async (req: Request, res: Response) => {
  try {
    const { hostids: hostidsParam, inicio, fim } = req.query as Record<string, string | undefined>

    if (!hostidsParam || hostidsParam === 'null') {
      return res.status(400).json({ erro: 'Parâmetro hostids é obrigatório' })
    }
    if (!inicio || inicio === 'null' || !fim || fim === 'null') {
      return res.status(400).json({ erro: 'Parâmetros inicio e fim são obrigatórios' })
    }

    const lista = hostidsParam
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0)

    if (lista.length === 0) {
      return res.status(400).json({ erro: 'Nenhum hostid válido' })
    }

    const inicioTs = isoParaTimestamp(inicio.replace('T', ' '))
    const fimTs = isoParaTimestamp(fim.replace('T', ' '))

    const hostids = lista.map((hostid) => Number(hostid))

    if (hostids.some((hostid) => !Number.isSafeInteger(hostid) || hostid < 0)) {
      return res.status(400).json({ erro: 'Nenhum hostid válido' })
    }

    const resultado = await RelatorioService.gerarRelatorioDisponibilidade(hostids, inicioTs, fimTs)
    res.json(resultado)
  } catch (e: unknown) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

export default router