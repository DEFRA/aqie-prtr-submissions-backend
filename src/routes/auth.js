import Joi from 'joi'

import { authModules } from '#/common/auth-modules.js'
import { sendOtp, verifyOtp } from '#/services/otp-service.js'

const email = Joi.string()
  .trim()
  .max(254)
  .email({ tlds: { allow: false } })

// One pair of routes per module, so an unknown module is simply a 404.
export const auth = Object.keys(authModules).flatMap((moduleName) => [
  {
    method: 'POST',
    path: `/${moduleName}/auth/otp/send`,
    options: {
      validate: {
        payload: Joi.object({ email: email.required() })
      }
    },
    handler: async (request, h) => {
      await sendOtp(request.db, moduleName, request.payload.email)
      return h.response().code(204)
    }
  },
  {
    method: 'POST',
    path: `/${moduleName}/auth/otp/verify`,
    options: {
      validate: {
        payload: Joi.object({
          email: email.required(),
          otp: Joi.string()
            .pattern(/^\d{6}$/)
            .required()
        })
      }
    },
    handler: async (request, h) => {
      const { valid } = await verifyOtp(
        request.db,
        moduleName,
        request.payload.email,
        request.payload.otp
      )
      return h.response({ valid })
    }
  }
])
