import { MetricRepository } from '../repositories/metric.repository.js'
import { TimelineRepository, type CurrentServiceStatus } from '../repositories/timeline.repository.js'

export interface HostDetails {
  hostid: string
  status: 'UP' | 'DOWN'
  cpu: { used: number; free: number; total: number } | null
  os: { type: string; name: string } | null
  memoria: { percent: number; used_gb: number; total_gb: number; free_gb: number } | null
  discos: Array<{ mount: string; uso: number }>
  uptime_fmt: string
  services: CurrentServiceStatus[]
}

export class HostService {
  static async getHostDetails(hostid: bigint): Promise<HostDetails> {
    const tipoInfo = await MetricRepository.detectarTipoHost(hostid)

    // Host de rede — retorno simplificado (igual ao seu Python)
    if (tipoInfo && tipoInfo.type === 'network') {
      return {
        hostid: hostid.toString(),
        status: await MetricRepository.getStatus(hostid),
        cpu: null,
        os: tipoInfo,
        uptime_fmt: 'N/A',
        memoria: null,
        discos: [],
        services: [],
      }
    }

    const osInfo = tipoInfo ?? (await MetricRepository.detectarSo(hostid))

    // Paraleliza tudo que é independente
    const [status, cpu, memoria, discos, uptime, services] = await Promise.all([
      MetricRepository.getStatus(hostid),
      MetricRepository.getCpu(hostid),
      MetricRepository.getMemoria(hostid),
      MetricRepository.getDiscos(hostid),
      MetricRepository.getUptime(hostid),
      TimelineRepository.getCurrentServiceStatus(hostid),
    ])

    return {
      hostid: hostid.toString(),
      status,
      cpu,
      os: osInfo,
      memoria,
      discos: discos ?? [],
      uptime_fmt: uptime ?? 'N/A',
      services: services ?? [],
    }
  }
}