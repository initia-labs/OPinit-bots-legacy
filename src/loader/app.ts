import Koa from 'koa'
import bodyParser from 'koa-body'
import Router from 'koa-router'
import cors from '@koa/cors'
import morgan from 'koa-morgan'
import mount from 'koa-mount'
import { APIError, ErrorTypes, errorHandler } from '../lib/error'
import { error } from '../lib/response'
import { KoaController, configureRoutes } from 'koa-joi-controllers'
import { router as swaggerRouter } from '../swagger/swagger'

const notFoundMiddleware: Koa.Middleware = (ctx) => {
  ctx.status = 404
}

function getRootApp(): Koa {
  // root app only contains the health check route
  const app = new Koa()
  const router = new Router()

  router.get('/health', async (ctx) => {
    ctx.status = 200
    ctx.body = 'OK'
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}

async function createAPIApp(controllers: KoaController[]): Promise<Koa> {
  const app = new Koa()

  app
    .use(errorHandler(error))
    .use(async (ctx, next) => {
      await next()

      ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
      ctx.set('Pragma', 'no-cache')
      ctx.set('Expires', '0')
    })
    .use(
      bodyParser({
        formLimit: '512kb',
        jsonLimit: '512kb',
        textLimit: '512kb',
        multipart: true,
        onError: (error) => {
          throw new APIError(
            ErrorTypes.INVALID_REQUEST_ERROR,
            '',
            error.message,
            error
          )
        }
      })
    )

  configureRoutes(app, controllers)
  app.use(notFoundMiddleware)
  return app
}

export async function initApp(controllers: KoaController[]): Promise<Koa> {
  const app = getRootApp()

  app.proxy = true
  const apiApp = await createAPIApp(controllers)

  app
    .use(morgan('common'))
    // .use(
    //   helmet({
    //     contentSecurityPolicy: {
    //       directives: {
    //         defaultSrc: [`'self'`],
    //         scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`, 'cdnjs.cloudflare.com', 'unpkg.com'],
    //         fontSrc: [`'self'`, 'https:', 'data:'],
    //         objectSrc: [`'none'`],
    //         imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
    //         styleSrc: [`'self'`, 'https:', `'unsafe-inline'`],
    //         upgradeInsecureRequests: [],
    //         blockAllMixedContent: []
    //       }
    //     }
    //   })
    // )
    .use(cors())
    .use(swaggerRouter.routes())
    .use(swaggerRouter.allowedMethods())
    .use(mount('/', apiApp))

  return app
}
