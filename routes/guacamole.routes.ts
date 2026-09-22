// routes/guacamole.routes.ts
import { Router } from 'express'
import type { Request, Response } from 'express'
import { GuacamoleService } from '../services/guacamole.service.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /guacamole/hosts
// Lista todas as conexões (hosts) do Guacamole.
// ─────────────────────────────────────────────────────────────
router.get('/guacamole/hosts', async (_req: Request, res: Response) => {
  try {
    const hosts = await GuacamoleService.listarHosts()
    res.json(hosts)
  } catch (e: unknown) {
    console.error('[guacamole/hosts]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /guacamole/connect
// Body: { connectionId: string }
// Gera a URL de conexão direta para um host existente.
// ─────────────────────────────────────────────────────────────
router.post('/guacamole/connect', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.body ?? {}
    if (!connectionId) {
      return res.status(400).json({ erro: 'connectionId é obrigatório' })
    }
    const resultado = await GuacamoleService.gerarUrlPorConnectionId(String(connectionId))
    res.json(resultado)
  } catch (e: unknown) {
    console.error('[guacamole/connect]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /guacamole/connect-full
// Body: { hostname, porta, email }
// Fluxo completo: cria usuário/conexão se necessário.
// ─────────────────────────────────────────────────────────────
router.post('/guacamole/connect-full', async (req: Request, res: Response) => {
  try {
    const { hostname, porta, email } = req.body ?? {}
    if (!hostname || porta === undefined || !email) {
      return res.status(400).json({ erro: 'hostname, porta e email são obrigatórios' })
    }
    const resultado = await GuacamoleService.conectarOuCriar(
      String(hostname),
      porta,
      String(email),
    )
    res.json(resultado)
  } catch (e: unknown) {
    console.error('[guacamole/connect-full]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /guacamole/debug/:connectionId
// Mostra TODOS os parâmetros da conexão (debug).
// ─────────────────────────────────────────────────────────────
router.get(
  '/guacamole/debug/:connectionId',
  async (req: Request<{ connectionId: string }>, res: Response) => {
    try {
      const dados = await GuacamoleService.debugConexao(req.params.connectionId)
      res.json(dados)
    } catch (e: unknown) {
      console.error('[guacamole/debug]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// POST /guacamole/fix-domain/:connectionId
// Remove o campo "domain" da tela de conexão RDP.
// ─────────────────────────────────────────────────────────────
router.post(
  '/guacamole/fix-domain/:connectionId',
  async (req: Request<{ connectionId: string }>, res: Response) => {
    try {
      const { connectionId } = req.params
      await GuacamoleService.removerCampoDominio(connectionId)
      res.json({ ok: true, msg: `Domínio removido da conexão ${connectionId}` })
    } catch (e: unknown) {
      console.error('[guacamole/fix-domain]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

// ─────────────────────────────────────────────────────────────
// POST /guacamole/fix-target/:connectionId
// Corrige o hostname/porta de uma conexão.
// Body: { "hostname": "ts.datacore.com.br", "porta": 3389 }
// ─────────────────────────────────────────────────────────────
router.post(
  '/guacamole/fix-target/:connectionId',
  async (req: Request<{ connectionId: string }>, res: Response) => {
    try {
      const { hostname, porta } = req.body ?? {}
      if (!hostname) {
        return res.status(400).json({ erro: 'hostname é obrigatório' })
      }
      await GuacamoleService.corrigirDestino(
        req.params.connectionId,
        String(hostname),
        porta ?? 3389,
      )
      res.json({
        ok: true,
        msg: `Conexão ${req.params.connectionId} → ${hostname}:${porta ?? 3389}`,
      })
    } catch (e: unknown) {
      console.error('[guacamole/fix-target]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  },
)

export default router