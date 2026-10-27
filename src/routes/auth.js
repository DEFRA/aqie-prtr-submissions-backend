import Joi from 'joi'

import { sendOtp, verifyOtp } from '#/services/otp-service.js'

const email = Joi.string()
  .trim()
  .max(254)
  .email({ tlds: { allow: false } })

export const auth = [
  {
    method: 'POST',
    path: '/auth/otp/send',
    options: {
      validate: {
        payload: Joi.object({ email: email.required() })
      }
    },
    handler: async (request, h) => {
      await sendOtp(request.db, request.payload.email)
      return h.response().code(204)
    }
  },
  {
    method: 'POST',
    path: '/auth/otp/verify',
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
        request.payload.email,
        request.payload.otp
      )
      return h.response({ valid })
    }
  }
]
