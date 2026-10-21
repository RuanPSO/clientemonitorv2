import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateAccessRules, loadAccessRules, validateAccessRules } from '../config/access-rules.js'

test('regra central de acesso prioriza Datacore e curinga hosts', () => {
  assert.equal(evaluateAccessRules({ companyName: 'Datacore', jobTitle: 'Analista' }), 'total')
  assert.equal(evaluateAccessRules({ companyName: 'Outra Empresa', jobTitle: 'Analista' }), 'hosts')
  assert.equal(evaluateAccessRules({ companyName: 'Outra Empresa', jobTitle: ' ' }), 'hosts')
})

test('regra curinga hosts aceita token sem identidade corporativa', () => {
  assert.equal(evaluateAccessRules({}), 'hosts')
  assert.equal(evaluateAccessRules({}, { liberados: [], semPermissao: [] }), 'deny')
})

test('semPermissao bloqueia mesmo com regra liberada', () => {
  const config = {
    liberados: [
      { companyName: 'Datacore', jobTitle: '*', acesso: 'total' },
      { companyName: '*', jobTitle: '*', acesso: 'hosts' },
    ],
    semPermissao: [
      { companyName: 'EmpresaBloqueada', jobTitle: '*' },
    ],
  }

  const normalized = validateAccessRules(config)
  assert.deepEqual(normalized.semPermissao[0], { companyName: 'EmpresaBloqueada', jobTitle: '*' })
  assert.equal(evaluateAccessRules({ companyName: 'EmpresaBloqueada', jobTitle: 'Gerente' }, normalized), 'deny')
})

test('configuração inválida falha em segurança e sem acesso', () => {
  const emptyRules = { liberados: [], semPermissao: [] }

  assert.equal(evaluateAccessRules({ companyName: '', jobTitle: 'Analista' }, emptyRules), 'deny')
  assert.equal(evaluateAccessRules({ companyName: 'Datacore-Fake', jobTitle: 'Analista' }, emptyRules), 'deny')

  const rules = loadAccessRules()
  assert.ok(Array.isArray(rules.liberados))
  assert.ok(Array.isArray(rules.semPermissao))
})
