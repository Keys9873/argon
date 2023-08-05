import { 
  closeCacheRedis,
  closeMongoDB,
  closeRabbitMQ,
  closeRanklistRedis,
  connectCacheRedis,
  connectMinIO,
  connectMongoDB,
  connectRabbitMQ,
  connectRanklistRedis,
  sentry 
} from '@argoncs/common'

import assert           from 'assert'
import { fastify }      from 'fastify'
import fastifyCors      from '@fastify/cors'
import fastifyAuth      from '@fastify/auth'
import fastifyCookie    from '@fastify/cookie'
import fastifySwagger   from '@fastify/swagger'
import fastifySensible  from '@fastify/sensible'
import fastifyHttpErrorsEnhanced    from '@chenhongqiao/fastify-http-errors-enhanced'
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { type FastifyTypeBox }      from './types.js'
import { v1APIRoutes } from './routes/v1.routes.js'



sentry.init({
  dsn: 'https://5aec7cfe257348109da4882fbb807e3a@o1044666.ingest.sentry.io/4505310995218432',
  environment: process.env.NODE_ENV,
  release: process.env.npm_package_version
})


export async function loadFastify (testing = false): Promise<FastifyTypeBox> {

  const app = fastify({
    logger: !testing, 
    disableRequestLogging: testing // To make testing logs cleaner. 
  }).withTypeProvider<TypeBoxTypeProvider>()


  await app.register(fastifyHttpErrorsEnhanced, {
    handle404Errors: false,
    convertValidationErrors: true,
    preHandler (err: any) {
      if (!('statusCode' in err) && !('validation' in err)) {
        sentry.captureException(err)
      }
      return err
    }
  })

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET ?? ''
  })

  await app.register(fastifySensible)
  await app.register(fastifyAuth)
  await app.register(fastifySwagger)
  await app.register(fastifyCors, {
    origin: [/\.teamscode\.org$/, /\.argoncs\.io$/, 'http://localhost:3000'],
    credentials: true
  })

  await app.register(v1APIRoutes, { prefix: '/v1' })


  assert(process.env.MINIO_URL != null)
  assert(process.env.MONGO_URL != null)
  assert(process.env.RABBITMQ_URL != null)
  assert(process.env.CACHEREDIS_URL != null)
  assert(process.env.RANKLISTREDIS_URL != null)
  
  await connectMinIO(process.env.MINIO_URL)
  await connectMongoDB(process.env.MONGO_URL)
  await connectRabbitMQ(process.env.RABBITMQ_URL)
  await connectCacheRedis(process.env.CACHEREDIS_URL)
  await connectRanklistRedis(process.env.RANKLISTREDIS_URL)
  

  // Set hook to disconnect from servers on close
  app.addHook('onClose', async (_) => {
    closeMongoDB()
    closeRabbitMQ()
    closeCacheRedis()
    closeRanklistRedis()
  })


  return app
}


export async function startAPIServer (): Promise<void> {
  const app = await loadFastify()
  try 
  {
    const port: number = parseInt(process.env.API_SERVER_PORT ?? '8000')
    await app.listen({ port, host: '0.0.0.0' })
    console.log("Fastify Server listening on: ", app.addresses());
  } 
  catch (err) 
  {
    sentry.captureException(err)
    app.log.error(err)
    throw err
  }
}
