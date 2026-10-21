import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request } from 'express'
import { logger } from '../utils/logger.js'

export type AccessLevel = 'total' | 'hosts' | 'deny'
export type AccessGranted = 'total' | 'hosts'

export interface AccessRule {
  companyName: string
  jobTitle: string
  acesso?: AccessGranted
}

export interface ForbiddenRule {
  companyName: string
  jobTitle: string
}

export interface AccessRulesConfig {
  liberados: AccessRule[]
  semPermissao: ForbiddenRule[]
}

export interface AccessIdentity {
  companyName?: string | null
  jobTitle?: string | null
}

const DEFAULT_RULES: AccessRulesConfig = {
  liberados: [
    { companyName: 'Datacore', jobTitle: '*', acesso: 'total' },
    { companyName: '*', jobTitle: '*', acesso: 'hosts' },
  ],
  semPermissao: [],
}

const currentFilePath = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFilePath)
const rulesPath = path.join(currentDir, 'access-rules.json')

function normalizeRuleValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeIdentityIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function matchesRule(candidate: AccessIdentity, rule: Pick<AccessRule | ForbiddenRule, 'companyName' | 'jobTitle'>): boolean {
  const normalizedCompany = normalizeRuleValue(candidate.companyName)
  const normalizedJobTitle = normalizeRuleValue(candidate.jobTitle)
  const ruleCompany = normalizeRuleValue(rule.companyName)
  const ruleJobTitle = normalizeRuleValue(rule.jobTitle)

  const companyMatches = ruleCompany === '*' || ruleCompany === normalizedCompany
  const jobMatches = ruleJobTitle === '*' || ruleJobTitle === normalizedJobTitle

  return companyMatches && jobMatches
}

function specificityScore(rule: Pick<AccessRule, 'companyName' | 'jobTitle'>): number {
  const companyExact = normalizeRuleValue(rule.companyName) !== '*' ? 2 : 0
  const jobExact = normalizeRuleValue(rule.jobTitle) !== '*' ? 1 : 0
  return companyExact + jobExact
}

export function validateAccessRules(input: unknown): AccessRulesConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('Arquivo de regras de acesso inválido: estrutura esperada de objeto')
  }

  const config = input as Record<string, unknown>
  const liberados = Array.isArray(config.liberados) ? config.liberados : []
  const semPermissao = Array.isArray(config.semPermissao) ? config.semPermissao : []

  const normalizedLiberados: AccessRule[] = liberados.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Regra liberada inválida na posição ${index}`)
    }

    const rule = item as Record<string, unknown>
    const companyName = String(rule.companyName ?? '').trim()
    const jobTitle = String(rule.jobTitle ?? '').trim()
    const acesso = rule.acesso

    if (!companyName || !jobTitle) {
      throw new Error(`Regra liberada inválida na posição ${index}: companyName e jobTitle são obrigatórios`)
    }

    if (acesso !== 'total' && acesso !== 'hosts') {
      throw new Error(`Regra liberada inválida na posição ${index}: acesso deve ser "total" ou "hosts"`)
    }

    return {
      companyName,
      jobTitle,
      acesso,
    }
  })

  const normalizedBlocked: ForbiddenRule[] = semPermissao.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Regra de semPermissao inválida na posição ${index}`)
    }

    const rule = item as Record<string, unknown>
    const companyName = String(rule.companyName ?? '').trim()
    const jobTitle = String(rule.jobTitle ?? '').trim()

    if (!companyName || !jobTitle) {
      throw new Error(`Regra de semPermissao inválida na posição ${index}: companyName e jobTitle são obrigatórios`)
    }

    return { companyName, jobTitle }
  })

  return {
    liberados: normalizedLiberados,
    semPermissao: normalizedBlocked,
  }
}

function readAccessRulesFile(): AccessRulesConfig {
  try {
    const content = readFileSync(rulesPath, 'utf8')
    const parsed = JSON.parse(content) as unknown
    return validateAccessRules(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Configuração de acesso inválida; bloqueando por segurança', { file: rulesPath, error: message })
    return { liberados: [], semPermissao: [] }
  }
}

const accessRulesConfig: AccessRulesConfig = readAccessRulesFile()

export function loadAccessRules(): AccessRulesConfig {
  return accessRulesConfig
}

export function evaluateAccessRules(identity: AccessIdentity, rules: AccessRulesConfig = accessRulesConfig): AccessLevel {
  const companyName = normalizeIdentityIdentity(identity.companyName)
  const jobTitle = normalizeIdentityIdentity(identity.jobTitle)

  const blocked = rules.semPermissao.some((rule) => matchesRule(
    { companyName, jobTitle },
    rule,
  ))

  if (blocked) {
    return 'deny'
  }

  const candidates = rules.liberados
    .filter((rule) => typeof rule.acesso === 'string')
    .map((rule) => ({
      ...rule,
      score: specificityScore(rule),
    }))
    .sort((left, right) => right.score - left.score)

  for (const candidate of candidates) {
    if (matchesRule({ companyName, jobTitle }, candidate)) {
      return candidate.acesso ?? 'deny'
    }
  }

  return 'deny'
}

export function extractAccessIdentity(req: Request): AccessIdentity {
  const session = req.session as unknown as Record<string, unknown> | undefined
  const sessionUser = session?.user as Record<string, unknown> | undefined
  const graphUser = session?.graphUser as Record<string, unknown> | undefined
  const authUser = req.user as Record<string, unknown> | undefined

  const companyName = [
    authUser?.companyName,
    authUser?.company_name,
    sessionUser?.companyName,
    graphUser?.companyName,
    session?.companyName,
  ].find((value) => typeof value === 'string' && value.trim().length > 0)

  const jobTitle = [
    authUser?.jobTitle,
    authUser?.job_title,
    sessionUser?.jobTitle,
    graphUser?.jobTitle,
    session?.jobTitle,
    authUser?.cargo,
  ].find((value) => typeof value === 'string' && value.trim().length > 0)

  return {
    companyName: typeof companyName === 'string' ? companyName : '',
    jobTitle: typeof jobTitle === 'string' ? jobTitle : '',
  }
}

export function getAccessDecisionForRequest(req: Request): AccessLevel {
  return evaluateAccessRules(extractAccessIdentity(req))
}

export function isDefaultAccessConfig(): boolean {
  return accessRulesConfig.liberados.length === 0 && accessRulesConfig.semPermissao.length === 0
}

export { DEFAULT_RULES }
