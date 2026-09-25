// routes/grupo.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { validarToken } from '../middlewares/auth.middleware.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /grupos
// Lista todos os grupos do Zabbix (hstgrp)
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
// GET /grupo/:chave/hosts
// Dispatcher (opção B):
//   - Se ":chave" for só dígitos → busca por groupid
//   - Senão → busca por nome do grupo
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
// Lista grupos com hosts (equivalente a get_grupos_com_hosts())
// ─────────────────────────────────────────────────────────────
router.get('/grupos/com-hosts', validarToken, async (_req, res: Response) => {
  try {
    const grupos = await ZabbixService.listarGrupos()
    const resultado = await Promise.all(
      grupos.map(async (g) => {
        const hosts = await ZabbixService.getHostsDoGrupo(BigInt(g.groupid))
        return {
          groupid: g.groupid,
          grupo: g.name,
          hosts: hosts.map((h) => ({
            hostid: h.hostid,
            hostname: h.hostname,
          })),
        }
      }),
    )
    res.json(resultado)
  } catch (e: unknown) {
    console.error('[grupos/com-hosts]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

export default router