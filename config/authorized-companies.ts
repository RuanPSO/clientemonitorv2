import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AuthorizedCompany {
  companyname: string
}

export interface AuthorizedCompaniesConfig {
  companies: AuthorizedCompany[]
}

const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'authorized-companies.json')

export function normalizeCompanyName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validateAuthorizedCompanies(input: unknown): AuthorizedCompaniesConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Configuração inválida: esperado um objeto com a propriedade "companies"')
  }

  const config = input as Record<string, unknown>
  if (Object.keys(config).length !== 1 || !Object.hasOwn(config, 'companies')) {
    throw new Error('Configuração inválida: somente a propriedade "companies" é permitida')
  }
  if (!Array.isArray(config.companies)) {
    throw new Error('Configuração inválida: "companies" deve ser um array')
  }

  const companies = config.companies.map((item, index): AuthorizedCompany => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Configuração inválida: companies[${index}] deve ser um objeto`)
    }

    const company = item as Record<string, unknown>
    if (Object.keys(company).length !== 1 || !Object.hasOwn(company, 'companyname')) {
      throw new Error(`Configuração inválida: companies[${index}] deve conter somente "companyname"`)
    }
    const companyname = normalizeCompanyName(company.companyname)
    if (!companyname) {
      throw new Error(`Configuração inválida: companies[${index}].companyname deve ser um texto não vazio`)
    }

    return { companyname }
  })

  const uniqueNames = new Set(companies.map((company) => company.companyname))
  if (uniqueNames.size !== companies.length) {
    throw new Error('Configuração inválida: companies contém nomes duplicados')
  }

  return { companies }
}

export function loadAuthorizedCompanies(filePath = configPath): AuthorizedCompaniesConfig {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'erro desconhecido'
    throw new Error(`Não foi possível carregar a allow-list de empresas em "${filePath}": ${detail}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'JSON inválido'
    throw new Error(`JSON inválido em "${filePath}": ${detail}`)
  }

  return validateAuthorizedCompanies(parsed)
}

const authorizedCompanies = loadAuthorizedCompanies()

export function classifyExperience(
  companyName: unknown,
  companies: readonly AuthorizedCompany[] = authorizedCompanies.companies,
): 'normal' | 'secondary' {
  const normalizedCompanyName = normalizeCompanyName(companyName)
  if (!normalizedCompanyName) return 'secondary'

  return companies.some((company) =>
    normalizeCompanyName(company.companyname) === normalizedCompanyName,
  )
    ? 'normal'
    : 'secondary'
}
