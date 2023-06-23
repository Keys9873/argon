import { Type } from '@sinclair/typebox'
import { PublicUserProfile, PublicUserProfileSchema, PrivateUserProfileSchema, PrivateUserProfile, NewUserSchema } from '@argoncs/types'
import { completeVerification, fetchUser, initiateVerification, registerUser } from '../services/user.services.js'
import { verifyUserOwnership } from '../auth/ownership.auth.js'
import { FastifyTypeBox } from '../types.js'
import { userAuthHook } from '../hooks/authentication.hooks.js'
import { conflictSchema, forbiddenSchema, notFoundSchema, unauthorizedSchema } from 'http-errors-enhanced'

async function userProfileRoutes (profileRoutes: FastifyTypeBox): Promise<void> {
  profileRoutes.get(
    '/public',
    {
      schema: {
        response: {
          200: PublicUserProfileSchema,
          404: notFoundSchema
        },
        params: Type.Object({ userId: Type.String() })
      }
    },
    async (request, reply) => {
      const { userId } = request.params
      const { username, name, id } = await fetchUser(userId)
      const publicProfile: PublicUserProfile = { username, name, id }
      await reply.status(200).send(publicProfile)
    }
  )

  profileRoutes.get(
    '/private',
    {
      schema: {
        response: {
          200: PrivateUserProfileSchema,
          401: unauthorizedSchema,
          403: forbiddenSchema,
          404: notFoundSchema
        },
        params: Type.Object({ userId: Type.String() })
      },
      onRequest: [userAuthHook, profileRoutes.auth([verifyUserOwnership]) as any]
    },
    async (request, reply) => {
      const { userId } = request.params
      const { username, name, email, newEmail, scopes, role, teams } = await fetchUser(userId)
      const privateProfile: PrivateUserProfile = { username, name, email, newEmail, scopes, id: userId, role, teams }
      await reply.status(200).send(privateProfile)
    }
  )
}

async function userVerificationRoutes (verificationRoutes: FastifyTypeBox): Promise<void> {
  verificationRoutes.get(
    '/',
    {
      schema: {
        params: Type.Object({ userId: Type.String() }),
        response: {
          401: unauthorizedSchema,
          403: forbiddenSchema
        }
      },
      onRequest: [userAuthHook, verificationRoutes.auth([verifyUserOwnership]) as any]
    },
    async (request, reply) => {
      const { userId } = request.params
      await initiateVerification(userId)
      return await reply.status(204).send()
    }
  )

  verificationRoutes.post(
    '/',
    {
      schema: {
        params: Type.Object({
          verificationId: Type.String()
        }),
        response: {
          200: Type.Object({ modified: Type.Boolean() }),
          401: unauthorizedSchema,
          403: notFoundSchema
        }
      }
    },
    async (request, reply) => {
      const { verificationId } = request.params
      const { modified } = await completeVerification(verificationId)
      return await reply.status(200).send({ modified })
    }
  )
}

export async function userRoutes (routes: FastifyTypeBox): Promise<void> {
  routes.post(
    '/',
    {
      schema: {
        body: NewUserSchema,
        response: {
          201: Type.Object({ userId: Type.String() }),
          409: conflictSchema
        }
      }
    },
    async (request, reply) => {
      const user = request.body
      const registered = await registerUser(user)
      return await reply.status(201).send(registered)
    }
  )

  await routes.register(userProfileRoutes, { prefix: '/:userId/profile' })
  await routes.register(userVerificationRoutes, { prefix: '/:userId/email-verification' })
}
