import {
  ConfidentialClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node'
import type { Session } from 'express-session'

export const SCOPES = ['User.Read', 'GroupMember.Read.All', 'AuditLog.Read.All']
export type MicrosoftSession = Session & {
  msalCache?: string
  account?: AccountInfo
  oauthState?: string
}

function saveSession(session: Session): Promise<void> {
  return new Promise((resolve, reject) => {
    session.save((error) => (error ? reject(error) : resolve()))
  })
}

export function createSessionCachePlugin(session: MicrosoftSession): ICachePlugin {
  return {
    beforeCacheAccess: async (cacheContext: TokenCacheContext) => {
      if (session.msalCache) {
        await cacheContext.tokenCache.deserialize(session.msalCache)
      }
    },
    afterCacheAccess: async (cacheContext: TokenCacheContext) => {
      if (cacheContext.hasChanged) {
        session.msalCache = cacheContext.tokenCache.serialize()
        await saveSession(session)
      }
    },
  }
}

function createClient(session: MicrosoftSession): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    },
    cache: { cachePlugin: createSessionCachePlugin(session) },
  })
}

export async function getAuthUrl(session: MicrosoftSession, state: string): Promise<string> {
  return createClient(session).getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: process.env.AZURE_REDIRECT_URI!,
    prompt: 'select_account',
    state,
  })
}

export async function acquireTokenByCode(
  code: string,
  session: MicrosoftSession,
): Promise<AuthenticationResult | null> {
  return createClient(session).acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: process.env.AZURE_REDIRECT_URI!,
  })
}

export async function acquireTokenSilent(
  account: AccountInfo,
  session: MicrosoftSession,
): Promise<AuthenticationResult> {
  const result = await createClient(session).acquireTokenSilent({
    account,
    scopes: SCOPES,
  })

  if (!result.accessToken) {
    throw new Error('MSAL não retornou access token')
  }

  return result
}
