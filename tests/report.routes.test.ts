import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import express from 'express'
import { createReportRouter } from '../routes/report.routes.js'

async function startReportApi() {
  const directory = mkdtempSync(join(tmpdir(), 'clientemonitor-report-'))
  const database = new Database(join(directory, 'reports.sqlite3'))
  const app = express()
  app.use(express.json())
  app.use(createReportRouter(database))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    database,
    url: `http://127.0.0.1:${address.port}/report`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('POST /report público valida os dados e armazena o horário e demais campos no SQLite', async () => {
  const api = await startReportApi()

  try {
    const response = await fetch(api.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        usuario: "user'",
        host: 'host',
        details: 'acesso remoto ao host',
        time: '11:41',
      }),
    })

    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { success: true, id: 1 })
    const savedReport = api.database.prepare(
      'SELECT usuario, host, details, time FROM reports WHERE id = ?',
    ).get(1)
    assert.deepEqual(savedReport, {
      usuario: "user'",
      host: 'host',
      details: 'acesso remoto ao host',
      time: '11:41',
    })
  } finally {
    await api.close()
  }
})

test('POST /report rejeita campos ausentes, vazios ou time fora de HH:mm', async () => {
  const api = await startReportApi()
  const invalidReports = [
    { usuario: 'user', host: 'host', details: 'details' },
    { usuario: 'user', host: 'host', details: 'details', time: 1141 },
    ...['9:41', '24:00', '11:60', '11:4a', ''].map((time) => ({
      usuario: 'user',
      host: 'host',
      details: 'details',
      time,
    })),
  ]

  try {
    for (const report of invalidReports) {
      const response = await fetch(api.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      })
      assert.equal(response.status, 400, JSON.stringify(report))
    }

    assert.equal(
      api.database.prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM reports',
      ).get()?.count,
      0,
    )
  } finally {
    await api.close()
  }
})
