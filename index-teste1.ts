// index-teste.ts
import { fmtUptime, formatarTempo, obterSla, categorizarServico, isoParaTimestamp } from './utils/helpers.js'
import { ZabbixService } from './services/zabbix.service.js'
import { RelatorioService } from './services/relatorio.service.js'

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