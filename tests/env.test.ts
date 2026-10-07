import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateMicrosoftAuthEnv } from '../config/env.js'

test('rejeita callback SPA na porta 5173 para o backend local', () => {
  const names = [
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'AZURE_REDIRECT_URI',
    'SESSION_SECRET',
    'PORT',
    'NODE_ENV',
    'FRONTEND_URL',
  ] as const
  const previous = new Map(names.map((name) => [name, process.env[name]]))

  process.env.AZURE_CLIENT_ID = 'test-client-id'
  process.env.AZURE_CLIENT_SECRET = 'test-client-secret'
  process.env.AZURE_TENANT_ID = 'test-tenant-id'
  process.env.AZURE_REDIRECT_URI = 'http://localhost:5173/auth/callback'
  process.env.SESSION_SECRET = 'a-session-secret-long-enough-for-tests-123'
  process.env.PORT = '3000'
  process.env.NODE_ENV = 'development'

  try {
    assert.throws(
      validateMicrosoftAuthEnv,
      /AZURE_REDIRECT_URI deve ser http:\/\/localhost:3000\/auth\/callback/,
    )

    process.env.AZURE_REDIRECT_URI = 'http://localhost:3000/auth/callback'
    assert.doesNotThrow(validateMicrosoftAuthEnv)
  } finally {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('exige FRONTEND_URL explícita em produção', () => {
  const names = [
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'AZURE_REDIRECT_URI',
    'SESSION_SECRET',
    'NODE_ENV',
    'FRONTEND_URL',
  ] as const
  const previous = new Map(names.map((name) => [name, process.env[name]]))

  process.env.AZURE_CLIENT_ID = 'test-client-id'
  process.env.AZURE_CLIENT_SECRET = 'test-client-secret'
  process.env.AZURE_TENANT_ID = 'test-tenant-id'
  process.env.AZURE_REDIRECT_URI = 'https://api.example.com/auth/callback'
  process.env.SESSION_SECRET = 'a-session-secret-long-enough-for-tests-123'
  process.env.NODE_ENV = 'production'
  delete process.env.FRONTEND_URL

  try {
    assert.throws(validateMicrosoftAuthEnv, /FRONTEND_URL é obrigatória em produção/)

    process.env.FRONTEND_URL = 'https://app.example.com'
    assert.doesNotThrow(validateMicrosoftAuthEnv)
  } finally {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
