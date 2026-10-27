import { Router } from 'express'
import '../config/env.js'
import { logger } from '../utils/logger.js'

const router = Router()
const defaultPortalUrl = 'http://10.86.26.18:8410/'
const defaultTimeoutMs = 10_000

router.get('/api/conectado', async (_req, res) => {
  const timeoutMs = Number(process.env.GUACAMOLE_TIMEOUT_MS ?? defaultTimeoutMs)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    logger.error('Timeout inválido para verificação do Portal RDP')
    res.status(500).json({ error: 'Configuração interna do serviço inválida.' })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const portalUrl = process.env.GUACAMOLE_BASE_URL?.trim() || defaultPortalUrl
    const portalResponse = await fetch(portalUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })

    if (portalResponse.status === 401 || portalResponse.status === 403) {
      logger.warn('Acesso ao Portal RDP recusado', { status: portalResponse.status })
      res.status(502).json({ error: 'Acesso ao serviço remoto recusado.' })
      return
    }

    if (portalResponse.status !== 200) {
      logger.warn('Portal RDP respondeu com status HTTP inesperado', {
        status: portalResponse.status,
      })
      res.status(502).json({ error: 'O serviço remoto não confirmou a conexão.' })
      return
    }

    const portalContentType = portalResponse.headers.get('content-type') ?? ''
    if (!/\btext\/html\b/i.test(portalContentType)) {
      logger.warn('Portal RDP não retornou HTML')
      res.status(502).json({ error: 'Resposta inválida do serviço remoto.' })
      return
    }

    res.status(200).json({ status: 'conectado' })
  } catch {
    if (controller.signal.aborted) {
      logger.warn('Timeout ao consultar o Portal RDP')
      res.status(504).json({ error: 'Tempo limite excedido ao consultar o serviço remoto.' })
      return
    }

    logger.error('Falha de rede ao consultar o Portal RDP')
    res.status(502).json({ error: 'Falha ao consultar o serviço remoto.' })
  } finally {
    clearTimeout(timeout)
  }
})

export default router
