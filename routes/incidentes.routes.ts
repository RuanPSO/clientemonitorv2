// routes/incidentes.routes.ts
import { Router } from 'express'
import type { Request, Response } from 'express'
import { IncidentesService } from '../services/incidentes.service.js'

const router = Router()

// ─────────────────────────────────────────────────────────────
// GET /incidentes/ativos
// Lista os incidentes ativos do dia
// ─────────────────────────────────────────────────────────────
router.get('/incidentes/ativos', async (_req: Request, res: Response) => {
  try {
    const dados = await IncidentesService.getIncidentesAtivosDoDia()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[incidentes/ativos]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /incidentes/hosts-totais
// Retorna contagem de hosts por status
// ─────────────────────────────────────────────────────────────
router.get('/incidentes/hosts-totais', async (_req: Request, res: Response) => {
  try {
    const dados = await IncidentesService.getHostsTotais()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[incidentes/hosts-totais]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /incidentes/problemas-24h
// Top 10 problemas nas últimas 24h
// ─────────────────────────────────────────────────────────────
router.get('/incidentes/problemas-24h', async (_req: Request, res: Response) => {
  try {
    const dados = await IncidentesService.getProblemas24h()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[incidentes/problemas-24h]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /incidentes/dashboard
// Endpoint agregado — 1 chamada retorna tudo que o dashboard precisa
// ─────────────────────────────────────────────────────────────
router.get('/incidentes/dashboard', async (_req: Request, res: Response) => {
  try {
    const dados = await IncidentesService.getDashboard()
    res.json(dados)
  } catch (e: unknown) {
    console.error('[incidentes/dashboard]', e)
    res.status(500).json({ erro: (e as Error).message })
  }
})

export default router