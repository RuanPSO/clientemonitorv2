import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  classifyExperience,
  loadAuthorizedCompanies,
  validateAuthorizedCompanies,
} from '../config/authorized-companies.js'

const companies = [{ companyname: 'datacore' }]

test('classifica somente correspondência exata após trim e lowercase', () => {
  for (const companyName of ['datacore', 'Datacore', ' datacore ']) {
    assert.equal(classifyExperience(companyName, companies), 'normal', companyName)
  }

  for (const companyName of [
    'Outra empresa',
    '',
    null,
    undefined,
    'datacore fake',
    'mydatacore',
  ]) {
    assert.equal(classifyExperience(companyName, companies), 'secondary', String(companyName))
  }
})

test('valida o formato estrito do arquivo de empresas autorizadas', () => {
  assert.deepEqual(
    validateAuthorizedCompanies({ companies: [{ companyname: ' Datacore ' }] }),
    { companies: [{ companyname: 'datacore' }] },
  )

  for (const invalid of [
    null,
    [],
    {},
    { companies: {} },
    { companies: [], extra: true },
    { companies: [null] },
    { companies: [{ companyname: 'datacore', extra: true }] },
    { companies: [{ companyname: '' }] },
    { companies: [{ companyname: 42 }] },
    { companies: [{ companyname: 'datacore' }, { companyname: ' Datacore ' }] },
  ]) {
    assert.throws(() => validateAuthorizedCompanies(invalid))
  }
})

test('JSON inválido ou arquivo ausente falha ao carregar a configuração', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'authorized-companies-'))
  const malformedPath = path.join(directory, 'malformed.json')

  try {
    writeFileSync(malformedPath, '{"companies": [', 'utf8')
    assert.throws(() => loadAuthorizedCompanies(malformedPath), /JSON inválido/)
    assert.throws(
      () => loadAuthorizedCompanies(path.join(directory, 'missing.json')),
      /Não foi possível carregar a allow-list/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
