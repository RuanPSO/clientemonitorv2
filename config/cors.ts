import cors from 'cors'

export function createCorsMiddleware(frontendOrigin: string) {
  return cors({
    origin: (requestOrigin, callback) => {
      callback(null, requestOrigin === frontendOrigin ? frontendOrigin : false)
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
}
