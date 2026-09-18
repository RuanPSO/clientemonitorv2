// index-teste.ts
import { fmtUptime, formatarTempo, obterSla, categorizarServico, isoParaTimestamp } from './utils/helpers.js'
import { HostClassifier } from './services/host-classifier.service.js'
import { HostRepository } from './repositories/host.repository.js'
import { ReportRepository } from './repositories/report.repository.js'
import { ServiceRepository } from './repositories/service.repository.js'
import { TimelineRepository } from './repositories/timeline.repository.js'
import { ZabbixService } from './services/zabbix.service.js'
import { RelatorioService } from './services/relatorio.service.js'


async function main() {
  // ─── Helpers puros ───
  console.log('fmtUptime(90061) →', fmtUptime(90061))
  console.log('formatarTempo(90061) →', formatarTempo(90061))
  console.log('obterSla(99.7) →', obterSla(99.7))
  console.log('categorizarServico("Service GGAPS") →', categorizarServico('Service GGAPS'))
  console.log('isoParaTimestamp("2024-01-01 10:00:00") →', isoParaTimestamp('2024-01-01 10:00:00'))

  // ─── Classifier ───
  const classificacao = HostClassifier.classify({
    hostid: 10001n,
    osData: { type: 'linux', name: 'Ubuntu' },
    templates: ['Template Linux by Zabbix agent'],
    services: ['Service SAP'],
    groups: ['SERVIDORES'],
    interfaceType: null,
  })
  console.log('\nClassificação:', classificacao)

  // ─── Repositories (bate no Zabbix) ───
  console.log('\n─── Grupos do Zabbix ───')
  const grupos = await HostRepository.listarGrupos()
  console.log(`Total: ${grupos.length}`)
  console.log('Primeiros 5:', grupos.slice(0, 5))

  // Pega um grupo que tenha hosts (ajuste o nome para um real)
  const grupoTeste = grupos[0]
  if (grupoTeste) {
    console.log(`\n─── Hosts do grupo "${grupoTeste.name}" (por ID) ───`)
    const hostsPorId = await HostRepository.getHostsDoGrupo(BigInt(grupoTeste.groupid))
    console.log(`Total: ${hostsPorId.length}`)

    console.log(`\n─── Hosts do grupo "${grupoTeste.name}" (por NOME) ───`)
    const hostsPorNome = await HostRepository.getHostsPorNomeDoGrupo(grupoTeste.name)
    console.log(`Total: ${hostsPorNome.length}`)

    console.log(`\n─── Dispatcher getHostsPorChave ───`)
    console.log('Por ID numérico:', (await HostRepository.getHostsPorChave(grupoTeste.groupid)).tipo)
    console.log('Por nome:', (await HostRepository.getHostsPorChave(grupoTeste.name)).tipo)

    // Se tiver host no grupo, testa os helpers do classifier
    const host = hostsPorNome[0]
    if (host) {
      const hostid = BigInt(host.hostid)
      console.log(`\n─── Dados auxiliares do host ${hostid} ───`)
      const [templates, gruposHost, iface] = await Promise.all([
        HostRepository.getTemplatesDoHost(hostid),
        HostRepository.getGruposDoHost(hostid),
        HostRepository.getInterfaceType(hostid),
      ])
      console.log('Templates:', templates)
      console.log('Grupos:', gruposHost)
      console.log('Interface SNMP:', iface)
      console.log('Basico:', await HostRepository.getHostBasico(hostid))
    }
  }
}

main()
  .catch((e) => {
    console.error('💥', e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import('./lib/prisma.js')
    await prisma.$disconnect()
  })


async function testarReport() {
  // Use um host real que tenha dados. Ex.: 11325 (4SOLVEAPP) do teste anterior
  const hostid = 11325n

  // Período: últimos 7 dias
  const fim = new Date()
  const inicio = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000)

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

  const inicioStr = fmt(inicio)
  const fimStr = fmt(fim)

  console.log(`\n─── Relatório host ${hostid} ───`)
  console.log(`Período: ${inicioStr} → ${fimStr}\n`)

  console.log('CPU:')
  const cpu = await ReportRepository.getCpuHistory(hostid, inicioStr, fimStr)
  console.log(`  ${cpu.length} pontos`)
  if (cpu.length > 0) console.log('  Primeiro:', cpu[0])

  console.log('\nMemória:')
  const mem = await ReportRepository.getMemoriaHistory(hostid, inicioStr, fimStr)
  console.log(`  ${mem.length} pontos`)
  if (mem.length > 0) console.log('  Primeiro:', mem[0])

  console.log('\nDiscos:')
  const discos = await ReportRepository.getDiscosHistory(hostid, inicioStr, fimStr)
  console.log(`  ${discos.length} discos`)
  for (const d of discos) {
    console.log(`  • ${d.mount}: ${d.history.length} pontos, total=${d.total_gb}GB, free=${d.free_gb}GB, used=${d.used_gb}GB`)
  }

  console.log('\nDisponibilidade (ICMP):')
  const disp = await ReportRepository.getDisponibilidade(hostid)
  console.log(' ', disp)
}

testarReport().catch(console.error)

async function testarServiceETimeline() {
  const hostid = 11325n // mesmo do teste anterior

  console.log('\n════════ SERVICE REPOSITORY ════════')

  console.log('\n─── getServices ───')
  const services = await ServiceRepository.getServices(hostid)
  console.log(`Total: ${services.length}`)
  services.slice(0, 5).forEach((s) => console.log(`  • ${s.name} (key=${s.key_})`))

  console.log('\n─── getHostServices (ON/OFF) ───')
  const hostSvcs = await ServiceRepository.getHostServices(hostid)
  console.log(`Total: ${hostSvcs.length}`)
  hostSvcs.slice(0, 5).forEach((s) => console.log(`  • ${s.name}: ${s.status}`))

  console.log('\n─── getHostSlaSummary (últimos 7 dias) ───')
  const fim = new Date()
  const inicio = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

  const sla = await ServiceRepository.getHostSlaSummary(hostid, fmt(inicio), fmt(fim))
  console.log(`  Total serviços: ${sla.total_services}`)
  console.log(`  Média disponibilidade: ${sla.avg_availability}%`)
  console.log(`  Melhor: ${sla.best_service?.name} (${sla.best_service?.availability}%)`)
  console.log(`  Pior: ${sla.worst_service?.name} (${sla.worst_service?.availability}%)`)

  console.log('\n════════ TIMELINE REPOSITORY ════════')

  console.log('\n─── getServices ───')
  const timelineSvcs = await TimelineRepository.getServices(hostid)
  console.log(`Total: ${timelineSvcs.length}`)

  console.log('\n─── getCurrentServiceStatus (otimizado) ───')
  const atuais = await TimelineRepository.getCurrentServiceStatus(hostid)
  console.log(`Total: ${atuais.length}`)
  const contagem: Record<string, number> = {}
  atuais.forEach((s) => { contagem[s.status] = (contagem[s.status] ?? 0) + 1 })
  console.log('  Por status:', contagem)
  atuais.slice(0, 5).forEach((s) => console.log(`  • ${s.name}: ${s.status} (last=${s.last_update})`))

  console.log('\n─── getHostTimeline (últimos 3 dias) ───')
  const inicioTs = Math.floor(inicio.getTime() / 1000)
  const fimTs = Math.floor(fim.getTime() / 1000)
  const timeline = await TimelineRepository.getHostTimeline(hostid, inicioTs, fimTs)
  console.log(`  Host: ${timeline.hostid}`)
  console.log(`  Total serviços: ${timeline.total_services}`)
  timeline.services.slice(0, 3).forEach((s) => {
    console.log(`  • ${s.service}: ${s.segments.length} segmentos`)
  })
}

testarServiceETimeline().catch(console.error)

async function testarFacade() {
  const hostid = 11325n

  console.log('\n════════ ZABBIX SERVICE (FACADE) ════════')

  console.log('\n─── getHostDetails (com classificação) ───')
  const detalhes = await ZabbixService.getHostDetails(hostid)
  console.log('  hostid:', detalhes.hostid)
  console.log('  status:', detalhes.status)
  console.log('  os:', detalhes.os)
  console.log('  cpu:', detalhes.cpu)
  console.log('  memoria:', detalhes.memoria)
  console.log('  discos:', detalhes.discos.length)
  console.log('  uptime:', detalhes.uptime_fmt)
  console.log('  services:', detalhes.services.length)
  console.log('  classificacao:', detalhes.classificacao)

  console.log('\n─── getProblemasHost ───')
  const problemas = await ZabbixService.getProblemasHost(hostid)
  console.log(`  Total: ${problemas.length}`)
  problemas.slice(0, 3).forEach((p) => console.log(`  • [sev=${p.severity}] ${p.name}`))

  console.log('\n─── getRelatorioHostInteligente (7 dias) ───')
  const fim = new Date()
  const inicio = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

  const rel = await ZabbixService.getRelatorioHostInteligente(hostid, fmt(inicio), fmt(fim))
  console.log(`  cpu: ${rel.cpu.length} pontos`)
  console.log(`  memoria: ${rel.memoria.length} pontos`)
  console.log(`  disponibilidade:`, rel.disponibilidade)
  console.log(`  discos: ${rel.discos.length}`)
  console.log(`  services: ${rel.services.length}`)

  console.log('\n════════ RELATÓRIO DISPONIBILIDADE ════════')
  const inicioTs = Math.floor(inicio.getTime() / 1000)
  const fimTs = Math.floor(fim.getTime() / 1000)

  const relDisp = await RelatorioService.gerarRelatorioDisponibilidade([hostid], inicioTs, fimTs)
  console.log('  Período:', relDisp.periodo)
  console.log('  Resumo:', relDisp.resumo)
  console.log('  Categorias:')
  relDisp.categorias.forEach((c) => {
    console.log(`    • ${c.nome}: ${c.servicos.length} serviço(s)`)
  })
}

testarFacade().catch(console.error)