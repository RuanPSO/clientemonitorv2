import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import type { AccountInfo, AuthenticationResult } from '@azure/msal-node'
import {
  acquireTokenByCode,
  acquireTokenSilent,
  getAuthUrl,
  type MicrosoftSession,
} from '../config/msal.js'
import { normalizeUserProfile, type GraphUser } from '../mappers/userMapper.js'
import { requireMicrosoftAccount } from '../middlewares/entra-auth.middleware.js'
import { getGraphGroups, getGraphProfile, GraphServiceError } from '../services/graph.js'
import { getClientIp } from '../utils/clientIp.js'
import { logger } from '../utils/logger.js'

type MicrosoftTokenResult = Pick<AuthenticationResult, 'account' | 'accessToken'> & {
  account: AccountInfo | null
}

export interface MicrosoftAuthDependencies {
  getAuthUrl: (session: MicrosoftSession, state: string) => Promise<string>
  acquireTokenByCode: (code: string, session: MicrosoftSession) => Promise<MicrosoftTokenResult | null>
  acquireTokenSilent: (account: AccountInfo, session: MicrosoftSession) => Promise<AuthenticationResult>
  getGraphProfile: (accessToken: string) => Promise<Record<string, unknown>>
  getGraphGroups: (accessToken: string) => Promise<unknown[]>
}

const defaultDependencies: MicrosoftAuthDependencies = {
  getAuthUrl,
  acquireTokenByCode,
  acquireTokenSilent,
  getGraphProfile,
  getGraphGroups,
}

export function createMicrosoftAuthRouter(
  overrides: Partial<MicrosoftAuthDependencies> = {},
): Router {
  const dependencies = { ...defaultDependencies, ...overrides }
  const router = Router()

  function saveSession(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()))
    })
  }

  function safeErrorName(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError'
  }

  router.get('/login', async (req: Request, res: Response) => {
    try {
      logger.info('Iniciando autenticação Microsoft', { clientIp: getClientIp(req) })
      const state = randomBytes(32).toString('hex')
      req.session.oauthState = state
      await saveSession(req)
      return res.redirect(302, await dependencies.getAuthUrl(req.session, state))
    } catch (error) {
      logger.error('Falha ao iniciar autenticação Microsoft', { errorName: safeErrorName(error) })
      return res.status(500).json({ error: 'Não foi possível iniciar o login Microsoft' })
    }
  })

  router.get('/callback', async (req: Request, res: Response) => {
    const entraError = typeof req.query.error === 'string' ? req.query.error : ''
    if (entraError) {
      logger.warn('Microsoft retornou erro no callback', { error: entraError })
      return res.status(401).json({ error: 'Autenticação Microsoft não concluída' })
    }

    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const expectedState = req.session.oauthState ?? ''

    if (!code) return res.status(400).json({ error: 'Código OAuth ausente' })
    if (
      !expectedState ||
      !state ||
      state.length !== expectedState.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))
    ) {
      return res.status(400).json({ error: 'Estado OAuth inválido ou expirado' })
    }

    try {
      const result = await dependencies.acquireTokenByCode(code, req.session)
      if (!result?.account) {
        return res.status(401).json({ error: 'A Microsoft não retornou uma conta autenticada' })
      }

      const cache = req.session.msalCache
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()))
      })
      req.session.account = result.account
      if (cache) req.session.msalCache = cache
      await saveSession(req)
      const frontendUrl = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173')
      frontendUrl.pathname = '/dashboard'
      frontendUrl.search = ''
      return res.redirect(302, frontendUrl.toString())
    } catch (error) {
      logger.error('Falha no callback Microsoft', { errorName: safeErrorName(error) })
      return res.status(502).json({ error: 'Não foi possível concluir a autenticação Microsoft' })
    }
  })

  router.get('/silent', requireMicrosoftAccount, async (req: Request, res: Response) => {
    const account = req.session.account
    if (!account) return res.status(401).json({ needsLogin: true })

    try {
      await dependencies.acquireTokenSilent(account, req.session)
      return res.json({ authenticated: true })
    } catch (error) {
      logger.warn('Token silencioso Microsoft indisponível', { errorName: safeErrorName(error) })
      return res.status(401).json({ needsLogin: true })
    }
  })

  router.get('/me', requireMicrosoftAccount, async (req: Request, res: Response) => {
    const account = req.session.account
    if (!account) return res.status(401).json({ needsLogin: true })

    let accessToken: string
    try {
      const token = await dependencies.acquireTokenSilent(account, req.session)
      accessToken = token.accessToken
    } catch (error) {
      logger.warn('Token silencioso Microsoft indisponível', { errorName: safeErrorName(error) })
      return res.status(401).json({ needsLogin: true })
    }

    try {
      const [profile, groups] = await Promise.all([
        dependencies.getGraphProfile(accessToken),
        dependencies.getGraphGroups(accessToken),
      ])
      const user = normalizeUserProfile(profile as GraphUser, account.tenantId)
      logger.debug('Microsoft Graph normalized profile', user)
      return res.json({ user, groups, clientIp: getClientIp(req), source: 'graph' })
    } catch (error) {
      if (error instanceof GraphServiceError) {
        return res.status(error.status).json({ error: error.message })
      }
      logger.error('Falha inesperada consultando Microsoft Graph', {
        errorName: safeErrorName(error),
      })
      return res.status(502).json({ error: 'Falha ao consultar Microsoft Graph' })
    }
  })

  router.get('/logout', (req: Request, res: Response) => {
    const frontendUrl = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173')
    frontendUrl.searchParams.set('signedOut', '1')

    req.session.destroy((error) => {
      if (error) {
        logger.error('Falha ao destruir sessão Microsoft', { errorName: safeErrorName(error) })
        return res.status(500).json({ error: 'Não foi possível encerrar a sessão' })
      }

      res.clearCookie('clientemonitor.sid', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      })
      const logoutUrl = new URL(
        `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout`,
      )
      logoutUrl.searchParams.set('post_logout_redirect_uri', frontendUrl.toString())
      return res.redirect(302, logoutUrl.toString())
    })
  })

  return router
}

export default createMicrosoftAuthRouter()
