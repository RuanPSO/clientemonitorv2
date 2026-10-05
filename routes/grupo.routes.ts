// routes/grupo.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /grupos
// ─────────────────────────────────────────────────────────────
router.get('/grupos', validarToken, async (_req, res: Response) => {
  try {
    const grupos = await ZabbixService.listarGrupos()
    res.json(grupos)
  } catch (e: unknown) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /grupo/:chave
// ─────────────────────────────────────────────────────────────
router.get(
  '/grupo/:chave',
  validarToken,
  async (req: Request<{ chave: string }>, res: Response) => {
    try {
      const { chave } = req.params
      const resultado = await ZabbixService.getHostsPorChave(chave)
      res.json(resultado)
    } catch (e: unknown) {
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /grupo/:chave/hosts-full
// ─────────────────────────────────────────────────────────────
router.get(
  '/grupo/:chave/hosts-full',
  validarToken,
  async (req: Request<{ chave: string }>, res: Response) => {
    try {
      const { chave } = req.params
      const dados = await ZabbixService.getHostsFullDoGrupo(chave)
      res.json(dados)
    } catch (e: unknown) {
      console.error('[hosts-full]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// GET /grupos/com-hosts
// ✅ Agora usa listarGruposComHosts() → 2 queries totais
// ─────────────────────────────────────────────────────────────
router.get('/grupos/com-hosts', validarToken, async (_req, res: Response) => {
  try {
    const resultado = await ZabbixService.listarGruposComHosts()
    res.json(resultado)
  } catch (e: unknown) {
    console.error('[grupos/com-hosts]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

export default router