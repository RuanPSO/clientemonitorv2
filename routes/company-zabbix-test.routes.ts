import { Router, type Request, type Response } from 'express'
import { fileURLToPath } from 'node:url'
import { mapCompanyToZabbixGroup } from '../config/company-zabbix-mapping.js'
import { requireMicrosoftAccount } from '../middlewares/entra-auth.middleware.js'

const router = Router()
const pagePath = fileURLToPath(new URL('../public/admin/company-zabbix-test.html', import.meta.url))
const scriptPath = fileURLToPath(new URL('../public/admin/company-zabbix-test.js', import.meta.url))
const stylesheetPath = fileURLToPath(new URL('../public/admin/company-zabbix-test.css', import.meta.url))

router.get('/company-zabbix-test', (_req, res) => {
  res.sendFile(pagePath)
})

router.get('/company-zabbix-test.js', (_req, res) => {
  res.type('application/javascript').sendFile(scriptPath)
})

router.get('/company-zabbix-test.css', (_req, res) => {
  res.type('text/css').sendFile(stylesheetPath)
})

router.post(
  '/company-zabbix-test/result',
  requireMicrosoftAccount,
  (req: Request, res: Response) => {
    const user = req.session.user
    if (!user) {
      return res.status(409).json({
        error: 'Consulte /auth/me nesta sessão antes de solicitar o diagnóstico.',
      })
    }

    const simulateCompanyName = req.body?.simulateCompanyName
    if (simulateCompanyName !== undefined && typeof simulateCompanyName !== 'string') {
      return res.status(400).json({ error: 'simulateCompanyName deve ser um texto.' })
    }

    return res.set('Cache-Control', 'no-store').json({
      diagnosticOnly: true,
      actual: mapCompanyToZabbixGroup(user.companyName),
      simulation: typeof simulateCompanyName === 'string'
        ? mapCompanyToZabbixGroup(simulateCompanyName)
        : null,
    })
  },
)

export default router
