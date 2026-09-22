// services/incidentes.service.ts
import {
  IncidentesRepository,
  type IncidenteAtivo,
  type HostsTotais,
  type Problema24h,
} from '../repositories/incidentes.repository.js'
import { cached } from '../lib/cache.js'

// =============================================================
// TTLs
// =============================================================
const TTL = {
  INCIDENTES: 30_000,     // 30s — incidentes mudam rápido
  HOSTS_TOTAIS: 60_000,   // 1min — status geral
  PROBLEMAS_24H: 75_000,  // 75s — usado no dashboard
} as const

// =============================================================
// TIPOS DE RETORNO
// =============================================================

export interface DashboardIncidentes {
  hosts: HostsTotais
  incidentes_ativos: IncidenteAtivo[]
  problemas_24h: Problema24h[]
  coletado_em: string
}

// =============================================================
export class IncidentesService {
  // ─────────────────────────────────────────────────────────
  // Incididentes ativos do dia
  // ─────────────────────────────────────────────────────────
  static async getIncidentesAtivosDoDia(): Promise<IncidenteAtivo[]> {
    return cached(
      'incidentes:ativos:hoje',
      () => IncidentesRepository.getIncidentesAtivosDoDia(),
      TTL.INCIDENTES,
    )
  }

  // ─────────────────────────────────────────────────────────
  // Hosts por status
  // ─────────────────────────────────────────────────────────
  static async getHostsTotais(): Promise<HostsTotais> {
    return cached(
      'incidentes:hosts:totais',
      () => IncidentesRepository.getHostsTotais(),
      TTL.HOSTS_TOTAIS,
    )
  }

  // ─────────────────────────────────────────────────────────
  // Top 10 problemas 24h
  // ─────────────────────────────────────────────────────────
  static async getProblemas24h(): Promise<Problema24h[]> {
    return cached(
      'incidentes:problemas:24h',
      () => IncidentesRepository.getProblemas24h(),
      TTL.PROBLEMAS_24H,
    )
  }

  // ─────────────────────────────────────────────────────────
  // Dashboard consolidado — 1 chamada retorna tudo
  // ─────────────────────────────────────────────────────────
  static async getDashboard(): Promise<DashboardIncidentes> {
    const [hosts, incidentes_ativos, problemas_24h] = await Promise.all([
      IncidentesService.getHostsTotais(),
      IncidentesService.getIncidentesAtivosDoDia(),
      IncidentesService.getProblemas24h(),
    ])

    return {
      hosts,
      incidentes_ativos,
      problemas_24h,
      coletado_em: new Date().toISOString(),
    }
  }
}