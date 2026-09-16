// services/relatorio.service.ts
import { ZabbixService } from './zabbix.service.js'
import { obterSla, formatarTempo, categorizarServico, type SlaStatus, type CategoriaServico } from '../utils/helpers.js'

// =============================================================
// TIPOS
// =============================================================
export interface ItemDisponibilidade {
  nome: string
  descricao: string
  host: string
  disponibilidade: number
  downtime_segundos: number
  downtime_formatado: string
  incidentes: number
  sla: SlaStatus
  status: string
}

export interface ResumoDisponibilidade {
  media_disponibilidade: number
  itens_total: number
  itens_dentro_sla: number
  itens_fora_sla: number
  total_incidentes: number
  menor_disponibilidade: { servico: string; host: string; valor: number }
}

export interface CategoriaAgrupada {
  nome: CategoriaServico
  servicos: ItemDisponibilidade[]
}

export interface RelatorioDisponibilidade {
  periodo: { inicio: string; fim: string }
  resumo: ResumoDisponibilidade
  categorias: CategoriaAgrupada[]
}

interface TimelinePoint {
  clock: number
  timestamp: string
  value: number
  status: 'RUNNING' | 'STOPPED' | 'UNKNOWN'
}

// =============================================================
export class RelatorioService {
  static async gerarRelatorioDisponibilidade(
    hostids: Array<bigint | number>,
    inicio: number,
    fim: number,
  ): Promise<RelatorioDisponibilidade> {
    const categorias = new Map<CategoriaServico, ItemDisponibilidade[]>()

    const resumo: ResumoDisponibilidade = {
      media_disponibilidade: 0,
      itens_total: 0,
      itens_dentro_sla: 0,
      itens_fora_sla: 0,
      total_incidentes: 0,
      menor_disponibilidade: { servico: '', host: '', valor: 100 },
    }

    let somaDisponibilidade = 0

    for (const hostid of hostids) {
      // ↓↓↓ MUDANÇA: usa getServicesHistory (valores brutos) em vez de getHostTimeline
      const historico = await ZabbixService.getHostServicesHistory(hostid, inicio, fim)
      const basico = await ZabbixService.getHostBasico(hostid)
      const hostname = basico?.hostname ?? `Host ${hostid}`

      for (const svc of historico.services) {
        const nomeServico = svc.service
        const categoria = categorizarServico(nomeServico)

        // ↓↓↓ Contagem fiel ao Python: value > 0 = up, value == 0 = down
        const total = svc.timeline.length
        const up = svc.timeline.filter((p) => Number(p.value) > 0).length
        const down = total - up

        const disponibilidade = total > 0 ? (up / total) * 100 : 0
        const downtimeSegundos = Math.round(
          ((fim - inicio) * (100 - disponibilidade)) / 100,
        )
        const currentStatus = RelatorioService._statusAtual(svc.timeline)

        const item: ItemDisponibilidade = {
          nome: nomeServico,
          descricao: hostname,
          host: hostname,
          disponibilidade: Math.round(disponibilidade * 100) / 100,
          downtime_segundos: downtimeSegundos,
          downtime_formatado: formatarTempo(downtimeSegundos),
          incidentes: down,  // ← Python: incidentes = down_samples
          sla: obterSla(disponibilidade),
          status: currentStatus,
        }

        const lista = categorias.get(categoria) ?? []
        lista.push(item)
        categorias.set(categoria, lista)

        resumo.itens_total += 1
        resumo.total_incidentes += down
        somaDisponibilidade += disponibilidade

        if (disponibilidade >= 99.5) resumo.itens_dentro_sla += 1
        else resumo.itens_fora_sla += 1

        if (disponibilidade < resumo.menor_disponibilidade.valor) {
          resumo.menor_disponibilidade = {
            servico: nomeServico,
            host: hostname,
            valor: Math.round(disponibilidade * 100) / 100,
          }
        }
      }
    }

    if (resumo.itens_total > 0) {
      resumo.media_disponibilidade =
        Math.round((somaDisponibilidade / resumo.itens_total) * 100) / 100
    }

    return {
      periodo: {
        inicio: new Date(inicio * 1000).toLocaleString('pt-BR'),
        fim: new Date(fim * 1000).toLocaleString('pt-BR'),
      },
      resumo,
      categorias: Array.from(categorias.entries()).map(([nome, servicos]) => ({
        nome,
        servicos: servicos.sort((a, b) => a.nome.localeCompare(b.nome)),
      })),
    }
  }

  private static _statusAtual(timeline: TimelinePoint[]): string {
    if (timeline.length === 0) return 'UNKNOWN'
    return timeline[timeline.length - 1]?.status ?? 'UNKNOWN'
  }
}