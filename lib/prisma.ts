// lib/prisma.ts
import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL não definida no .env')
}

const pool = new pg.Pool({
  connectionString,
  max: 25,                      // ← antes era default (10). Aumenta paralelismo
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

const adapter = new PrismaPg(pool)

export const prisma = new PrismaClient({ adapter })