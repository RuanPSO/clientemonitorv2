import { Router } from 'express'
import { requireAccessLevel } from '../middlewares/access-control.middleware.js'
import {
  createEmailController,
  type EmailControllerDependencies,
} from '../controllers/email.controller.js'

export function createEmailRoutes(dependencies?: EmailControllerDependencies) {
  const router = Router()
  const controller = dependencies
    ? createEmailController(dependencies)
    : createEmailController()

  router.post('/testar', requireAccessLevel('total'), controller.testarConexaoSmtp)
  router.post('/testar-envio', controller.testarEnvio)

  return router
}

export function createSendEmailRoute(dependencies?: EmailControllerDependencies) {
  const router = Router()
  const controller = dependencies
    ? createEmailController(dependencies)
    : createEmailController()

  router.post('/', controller.enviar)
  return router
}

export default createEmailRoutes()
