import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gerarHashScrypt, validarSenhaForte, verificarSenhaScrypt } from '../utils/helpers.js'

test('gera e valida hash scrypt no formato esperado', () => {
  const senha = 'MinhaSenhaSegura@123'
  const hash = gerarHashScrypt(senha)

  assert.match(hash, /^scrypt:32768:8:1\$/)
  assert.ok(verificarSenhaScrypt(senha, hash))
  assert.equal(verificarSenhaScrypt('OutraSenha@456', hash), false)
})

test('exige complexidade mínima na senha', () => {
  assert.equal(validarSenhaForte('Abcdef1!'), true)
  assert.equal(validarSenhaForte('senha123'), false)
  assert.equal(validarSenhaForte('SenhaSemEspecial1'), false)
})
