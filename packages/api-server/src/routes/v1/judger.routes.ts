import { Type } from '@sinclair/typebox'
import { languageConfigs } from '../../../configs/language.configs.js'

import { SubmissionLang, LanguageConfigSchema } from '@argoncs/types'

import { type FastifyTypeBox } from '../../types.js'

export async function judgerRoutes (app: FastifyTypeBox): Promise<void> {
  await app.register((routes: FastifyTypeBox, options, done) => {
    routes.get(
      '/language-config',
      {
        schema: {
          response: {
            200: Type.Record(Type.Enum(SubmissionLang), LanguageConfigSchema)
          }
        }
      },
      async (request, reply) => {
        await reply.status(200).send(languageConfigs)
      }
    )

    done()
  })
}
