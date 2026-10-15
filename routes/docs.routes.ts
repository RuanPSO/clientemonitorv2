import { fileURLToPath } from 'node:url'
import express, { Router } from 'express'
import { openApiDocument } from './docs.openapi.js'

const router = Router()
const documentationDirectory = fileURLToPath(new URL('../public/docs/', import.meta.url))

router.get('/docs/openapi.json', (_req, res) => {
  res.json(openApiDocument)
})

router.get('/docs', (_req, res) => {
  res.sendFile('index.html', { root: documentationDirectory })
})

router.use('/docs', express.static(documentationDirectory, {
  dotfiles: 'deny',
  index: 'index.html',
}))

export default router
