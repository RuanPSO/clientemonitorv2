import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CompanyZabbixMappingConfig {
  companyToGroup: Record<string, string>
  availableGroups: string[]
  fallback: {
    unmappedCompany: {
      policy: 'all_groups'
      groups: 'availableGroups'
    }
    emptyCompany: {
      policy: 'no_group'
      groupName: null
    }
  }
}

export interface CompanyZabbixMappingResult {
  companyName: string
  groupName: string | null
  groups: string[]
  mapped: boolean
  fallbackPolicy: 'all_groups' | 'no_group' | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateCompanyZabbixMapping(input: unknown): CompanyZabbixMappingConfig {
  if (!isRecord(input) || !isRecord(input.companyToGroup) || !Array.isArray(input.availableGroups)) {
    throw new Error('Configuração de mapeamento empresa-Zabbix inválida')
  }

  if (
    !isRecord(input.fallback) ||
    !isRecord(input.fallback.unmappedCompany) ||
    input.fallback.unmappedCompany.policy !== 'all_groups' ||
    input.fallback.unmappedCompany.groups !== 'availableGroups' ||
    !isRecord(input.fallback.emptyCompany) ||
    input.fallback.emptyCompany.policy !== 'no_group' ||
    input.fallback.emptyCompany.groupName !== null
  ) {
    throw new Error('Políticas de fallback do mapeamento empresa-Zabbix inválidas')
  }

  const availableGroups = input.availableGroups
  if (!availableGroups.every((group): group is string => typeof group === 'string' && group.trim() !== '')) {
    throw new Error('A lista de grupos Zabbix contém um grupo inválido')
  }

  const availableGroupNames = new Set(availableGroups)
  const companyToGroup: Record<string, string> = {}
  for (const [companyName, groupName] of Object.entries(input.companyToGroup)) {
    if (!companyName.trim() || typeof groupName !== 'string' || !availableGroupNames.has(groupName)) {
      throw new Error(`Mapeamento Zabbix inválido para a empresa "${companyName}"`)
    }
    companyToGroup[companyName] = groupName
  }

  return {
    companyToGroup,
    availableGroups: [...availableGroups],
    fallback: {
      unmappedCompany: { policy: 'all_groups', groups: 'availableGroups' },
      emptyCompany: { policy: 'no_group', groupName: null },
    },
  }
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const mappingPath = path.join(currentDir, 'company-zabbix-mapping.json')
const parsedMapping: unknown = JSON.parse(readFileSync(mappingPath, 'utf8'))
export const companyZabbixMapping = validateCompanyZabbixMapping(parsedMapping)

export function mapCompanyToZabbixGroup(companyName: unknown): CompanyZabbixMappingResult {
  const normalizedCompany = typeof companyName === 'string' ? companyName.trim() : ''
  const matchingEntry = Object.entries(companyZabbixMapping.companyToGroup)
    .find(([name]) => name.toLocaleLowerCase('pt-BR') === normalizedCompany.toLocaleLowerCase('pt-BR'))
  const mappedGroup = matchingEntry?.[1]

  if (mappedGroup) {
    return {
      companyName: normalizedCompany,
      groupName: mappedGroup,
      groups: [mappedGroup],
      mapped: true,
      fallbackPolicy: null,
    }
  }

  if (!normalizedCompany) {
    return {
      companyName: '',
      groupName: companyZabbixMapping.fallback.emptyCompany.groupName,
      groups: [],
      mapped: false,
      fallbackPolicy: companyZabbixMapping.fallback.emptyCompany.policy,
    }
  }

  return {
    companyName: normalizedCompany,
    groupName: null,
    groups: [...companyZabbixMapping.availableGroups],
    mapped: false,
    fallbackPolicy: companyZabbixMapping.fallback.unmappedCompany.policy,
  }
}
