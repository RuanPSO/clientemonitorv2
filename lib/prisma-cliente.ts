// lib/prisma-cliente.ts
import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma-cliente/client.js'

const connectionString = process.env.DATABASE_CLIENTE_URL
if (!connectionString) {
  throw new Error('DATABASE_CLIENTE_URL não definida no .env')
}

const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)

export const prismaCliente = new PrismaClient({ adapter })