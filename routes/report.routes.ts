import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { Router } from 'express'
import { logger } from '../utils/logger.js'

export interface ReportInput {
  usuario: string
  host: string
  details: string
  time: string
}

const databasePath = fileURLToPath(new URL('../data/reports.sqlite3', import.meta.url))

export function createReportDatabase(path = databasePath): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  return new Database(path)
}

function isReportInput(value: unknown): value is ReportInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const report = value as Record<string, unknown>
  return (
    typeof report.usuario === 'string' &&
    report.usuario.trim().length > 0 &&
    typeof report.host === 'string' &&
    report.host.trim().length > 0 &&
    typeof report.details === 'string' &&
    report.details.trim().length > 0 &&
    typeof report.time === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(report.time)
  )
}

export function createReportRouter(database: Database.Database): Router {
  database.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL,
      host TEXT NOT NULL,
      details TEXT NOT NULL,
      time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)
  const insertReport = database.prepare(
    'INSERT INTO reports (usuario, host, details, time) VALUES (?, ?, ?, ?)',
  )

  const router = Router()
  router.post('/report', (req, res) => {
    if (!isReportInput(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: [{
          field: 'body',
          message: 'Informe usuario, host e details como texto não vazio e time no formato HH:mm.',
        }],
      })
    }

    try {
      const result = insertReport.run(
        req.body.usuario,
        req.body.host,
        req.body.details,
        req.body.time,
      )
      return res.status(201).json({ success: true, id: Number(result.lastInsertRowid) })
    } catch (error) {
      logger.error('Falha ao armazenar relatório SQLite', {
        error: error instanceof Error ? error.message : String(error),
      })
      return res.status(500).json({ success: false, error: 'Não foi possível armazenar o relatório.' })
    }
  })

  return router
}

const database = createReportDatabase()
export default createReportRouter(database)
