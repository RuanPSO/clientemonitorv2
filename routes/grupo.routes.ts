// routes/grupo.routes.ts
import { Router, type Request, type Response } from 'express'
import { ZabbixService } from '../services/zabbix.service.js'
import { requireExperienceOrLegacyJwt } from '../middlewares/experience.middleware.js'
import { isHostGroupAllowed } from '../config/company-host-groups.js'
import { getAllowedCompanyGroups, isCompanyGroupKeyAllowed } from './_company-scope.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /grupos
// ─────────────────────────────────────────────────────────────
router.get('/grupos', requireExperienceOrLegacyJwt(['normal', 'secondary']), async (req, res: Response) => {
  try {
    if (req.session?.experience === 'secondary') {
      const allowedHostGroups = req.session.allowedHostGroups ?? []
      if (allowedHostGroups.length === 0) return res.json([])
      const grupos = await ZabbixService.listarGrupos()
      return res.json(
        grupos
          .filter((grupo) => isHostGroupAllowed(grupo.name, allowedHostGroups))
          .map((grupo) => ({ ...grupo, name: grupo.name.trim() })),
      )
    }
    const grupos = await ZabbixService.listarGrupos()
    return res.json(grupos)
  } catch (e: unknown) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /grupo/:chave
// ─────────────────────────────────────────────────────────────
router.get(
  '/grupo/:chave',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ chave: string }>, res: Response) => {
    try {
      const { chave } = req.params
      let chaveConsultada = chave
      if (req.session?.experience === 'secondary') {
        const allowedHostGroups = req.session.allowedHostGroups ?? []
        const allowed = await isCompanyGroupKeyAllowed(chave, allowedHostGroups)
        if (!allowed) {
          return res.status(403).json({ erro: 'Grupo fora do escopo da empresa' })
        }
        chaveConsultada = chave.trim()
      }
      const resultado = await ZabbixService.getHostsPorChave(chaveConsultada)
      return res.json(resultado)
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
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req: Request<{ chave: string }>, res: Response) => {
    try {
      const { chave } = req.params
      if (req.session?.experience === 'secondary') {
        const allowed = await isCompanyGroupKeyAllowed(
          chave,
          req.session.allowedHostGroups ?? [],
        )
        if (!allowed) {
          return res.status(403).json({ erro: 'Grupo fora do escopo da empresa' })
        }
      }
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
router.get(
  '/grupos/com-hosts',
  requireExperienceOrLegacyJwt(['normal', 'secondary']),
  async (req, res: Response) => {
    try {
      if (req.session?.experience === 'secondary') {
        const groups = await getAllowedCompanyGroups(req.session.allowedHostGroups ?? [])
        const resultado = await ZabbixService.listarGruposComHostsPorGrupos(groups)
        return res.json(resultado.map((group) => ({ ...group, grupo: group.grupo.trim() })))
      }
      const resultado = await ZabbixService.listarGruposComHosts()
      res.json(resultado)
    } catch (e: unknown) {
      console.error('[grupos/com-hosts]', e)
      res.status(500).json({ erro: (e as Error).message })
    }
  }
)

export default router