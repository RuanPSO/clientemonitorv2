import { prisma } from './lib/prisma.js'

async function main() {
  console.log('🔌 Testando conexão com o banco Zabbix...\n')

  // ─────────────────────────────────────────────────────────
  // 1) Teste básico: SELECT 1 (só verifica se conecta)
  // ─────────────────────────────────────────────────────────
  try {
    const resultado = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`
    console.log('✅ Conexão OK:', resultado)
  } catch (erro) {
    console.error('❌ Falha na conexão:', erro)
    process.exit(1)
  }

  // ─────────────────────────────────────────────────────────
  // 2) Verifica qual usuário/banco está conectado
  // ─────────────────────────────────────────────────────────
  try {
    const info = await prisma.$queryRaw<
      Array<{ current_user: string; current_database: string; versao: string }>
    >`SELECT current_user, current_database(), version() AS versao`
    console.log('\n👤 Usuário logado:', info[0].current_user)
    console.log('🗄️  Banco:', info[0].current_database)
    console.log('📦 Versão:', info[0].versao.split(' ').slice(0, 2).join(' '))
  } catch (erro) {
    console.error('❌ Erro ao obter info do banco:', erro)
  }

  // ─────────────────────────────────────────────────────────
  // 3) Confirma que o schema do Zabbix existe
  //    (lista algumas tabelas essenciais)
  // ─────────────────────────────────────────────────────────
  try {
    const tabelas = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hosts', 'items', 'triggers', 'events', 'history', 'history_uint')
      ORDER BY table_name
    `
    console.log('\n📋 Tabelas do Zabbix encontradas:')
    tabelas.forEach((t) => console.log('   •', t.table_name))
  } catch (erro) {
    console.error('❌ Erro ao listar tabelas:', erro)
  }

  // ─────────────────────────────────────────────────────────
  // 4) Conta hosts cadastrados
  // ─────────────────────────────────────────────────────────
  try {
    const [{ total }] = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total FROM hosts
    `
    console.log(`\n🖥️  Total de hosts cadastrados: ${total}`)
  } catch (erro) {
    console.error('❌ Erro ao contar hosts:', erro)
  }

  // ─────────────────────────────────────────────────────────
  // 5) Lista 5 hosts (id, nome técnico, nome visível, status)
  // ─────────────────────────────────────────────────────────
  try {
    const hosts = await prisma.$queryRaw<
      Array<{ hostid: bigint; host: string; name: string; status: number }>
    >`
      SELECT hostid, host, name, status
      FROM hosts
      ORDER BY hostid
      LIMIT 5
    `

    console.log('\n📄 Primeiros 5 hosts:')
    hosts.forEach((h) => {
      const status = h.status === 0 ? 'habilitado' : 'desabilitado'
      console.log(`   • [${h.hostid}] ${h.host} — "${h.name}" (${status})`)
    })
  } catch (erro) {
    console.error('❌ Erro ao listar hosts:', erro)
  }

  // ─────────────────────────────────────────────────────────
  // 6) Testa query com parâmetro (importante para as rotas)
  // ─────────────────────────────────────────────────────────
  try {
    const hostidTeste = 10084n // ajuste para um hostid válido do seu Zabbix
    const host = await prisma.$queryRaw<
      Array<{ hostid: bigint; host: string; name: string }>
    >`
      SELECT hostid, host, name
      FROM hosts
      WHERE hostid = ${hostidTeste}
    `

    if (host.length === 0) {
      console.log(`\n⚠️  Nenhum host encontrado com hostid=${hostidTeste} (ajuste o valor para testar)`)
    } else {
      console.log(`\n🔍 Busca por hostid=${hostidTeste}:`)
      console.log(`   • ${host[0].host} — "${host[0].name}"`)
    }
  } catch (erro) {
    console.error('❌ Erro na busca por hostid:', erro)
  }

  console.log('\n🏁 Testes finalizados.')
}

main()
  .catch((e) => {
    console.error('💥 Erro fatal:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })