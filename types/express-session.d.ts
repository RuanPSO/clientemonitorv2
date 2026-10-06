import type { AccountInfo } from '@azure/msal-node'

declare module 'express-session' {
  interface SessionData {
    msalCache?: string
    account?: AccountInfo
    oauthState?: string
  }
}
