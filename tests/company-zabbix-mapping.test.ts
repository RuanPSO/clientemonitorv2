import assert from 'node:assert/strict'
import { test } from 'node:test'
import { companyZabbixMapping, mapCompanyToZabbixGroup } from '../config/company-zabbix-mapping.js'

test('mapeia os aliases de empresa para o grupo configurado', () => {
  assert.equal(mapCompanyToZabbixGroup('SPS Enterprise').groupName, 'SPS_MATRIZ')
  assert.equal(mapCompanyToZabbixGroup('SPS Soluções').groupName, 'SPS_MATRIZ')
  assert.equal(mapCompanyToZabbixGroup('SPS Gestão').groupName, 'SPS_MATRIZ')
  assert.equal(mapCompanyToZabbixGroup('SPS GROUP').groupName, 'SPS_MATRIZ')
  assert.equal(mapCompanyToZabbixGroup('SPS Minas').groupName, 'SPS_BH')
  assert.equal(mapCompanyToZabbixGroup('SPS Rio').groupName, 'SPS_RJ')
  assert.equal(mapCompanyToZabbixGroup('SPS CWB').groupName, 'SPS_CURITIBA')
})

test('empresa preenchida não mapeada recebe todos os grupos disponíveis', () => {
  assert.deepEqual(mapCompanyToZabbixGroup('Cloud Core'), {
    companyName: 'Cloud Core',
    groupName: null,
    groups: ['SPS_MATRIZ', 'SPS_BH', 'SPS_RJ', 'SPS_CURITIBA', 'SPS_BOLIVIA', 'SPS_INNO'],
    mapped: false,
    fallbackPolicy: 'all_groups',
  })
  assert.deepEqual(mapCompanyToZabbixGroup('Outra empresa').groups, companyZabbixMapping.availableGroups)
})

test('empresa vazia usa política no_group e empresas mapeadas não usam fallback', () => {
  assert.deepEqual(mapCompanyToZabbixGroup(''), {
    companyName: '',
    groupName: null,
    groups: [],
    mapped: false,
    fallbackPolicy: 'no_group',
  })
  assert.deepEqual(mapCompanyToZabbixGroup(null), mapCompanyToZabbixGroup(''))
  assert.deepEqual(mapCompanyToZabbixGroup('SPS Minas'), {
    companyName: 'SPS Minas',
    groupName: 'SPS_BH',
    groups: ['SPS_BH'],
    mapped: true,
    fallbackPolicy: null,
  })
})

test('aceita variação de caixa e mantém grupos futuros disponíveis', () => {
  assert.equal(mapCompanyToZabbixGroup('  sps minas ').groupName, 'SPS_BH')
  assert.ok(companyZabbixMapping.availableGroups.includes('SPS_BOLIVIA'))
  assert.ok(companyZabbixMapping.availableGroups.includes('SPS_INNO'))
  assert.equal(companyZabbixMapping.fallback.unmappedCompany.groups, 'availableGroups')
})
