import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CompanyHostGroupsEntry {
  companyname: string
  groups: string[]
}

export interface CompanyHostGroupsConfig {
  companies: CompanyHostGroupsEntry[]
}

export type CompanyHostGroupsReason = 'mapped' | 'unmapped_company' | 'empty_company'

export interface CompanyHostGroupsScope {
  normalizedCompanyName: string
  allowedHostGroups: string[]
  reason: CompanyHostGroupsReason
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeScopeCompanyName(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function validateCompanyHostGroups(input: unknown): CompanyHostGroupsConfig {
  if (!isRecord(input) || !Array.isArray(input.companies)) {
    throw new Error('Configuração de escopo inválida: esperado um objeto com "companies" como array')
  }
  if (
    Object.keys(input).some((key) => key !== 'companies' && key !== '_comment') ||
    (Object.hasOwn(input, '_comment') &&
      (typeof input._comment !== 'string' || input._comment.trim() === ''))
  ) {
    throw new Error('Configuração de escopo inválida: propriedades extras ou "_comment" inválido')
  }

  const normalizedNames = new Set<string>()
  const companies = input.companies.map((item, index): CompanyHostGroupsEntry => {
    if (!isRecord(item)) {
      throw new Error(`Configuração de escopo inválida: companies[${index}] deve ser um objeto`)
    }

    const companyname = typeof item.companyname === 'string' ? item.companyname.trim() : ''
    if (!companyname) {
      throw new Error(`Configuração de escopo inválida: companies[${index}].companyname deve ser texto não vazio`)
    }
    if (!Array.isArray(item.groups) ||
      !item.groups.every((group) => typeof group === 'string' && group.trim() !== '')) {
      throw new Error(`Configuração de escopo inválida: companies[${index}].groups deve conter textos não vazios`)
    }

    const normalizedName = normalizeScopeCompanyName(companyname)
    if (normalizedNames.has(normalizedName)) {
      throw new Error(`Configuração de escopo inválida: companyname duplicado após normalização ("${companyname}")`)
    }
    normalizedNames.add(normalizedName)

    return {
      companyname,
      groups: (item.groups as string[]).map((group) => group.trim()),
    }
  })

  return { companies }
}

const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'company-host-groups.json')

export function loadCompanyHostGroups(filePath = configPath): CompanyHostGroupsConfig {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'erro desconhecido'
    throw new Error(`Não foi possível carregar o escopo por empresa em "${filePath}": ${detail}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'JSON inválido'
    throw new Error(`JSON inválido no escopo por empresa "${filePath}": ${detail}`)
  }

  return validateCompanyHostGroups(parsed)
}

export const companyHostGroups = loadCompanyHostGroups()

export function resolveCompanyHostGroups(
  companyName: unknown,
  entries: readonly CompanyHostGroupsEntry[] = companyHostGroups.companies,
): CompanyHostGroupsScope {
  const normalizedCompanyName = normalizeScopeCompanyName(companyName)
  if (!normalizedCompanyName) {
    return { normalizedCompanyName, allowedHostGroups: [], reason: 'empty_company' }
  }

  const matchingEntry = entries.find(
    (entry) => normalizeScopeCompanyName(entry.companyname) === normalizedCompanyName,
  )
  if (!matchingEntry) {
    return { normalizedCompanyName, allowedHostGroups: [], reason: 'unmapped_company' }
  }

  return {
    normalizedCompanyName,
    allowedHostGroups: [...matchingEntry.groups],
    reason: 'mapped',
  }
}

export function isHostGroupAllowed(groupName: string, allowedHostGroups: readonly string[]): boolean {
  const normalizedGroupName = groupName.trim()
  return allowedHostGroups.some((allowedGroup) => {
    const normalizedAllowedGroup = allowedGroup.trim()
    return normalizedGroupName === normalizedAllowedGroup ||
      normalizedGroupName.startsWith(`${normalizedAllowedGroup}/`)
  })
}
