import Joi from 'joi'
import Boom from '@hapi/boom'

import { config } from '#/config.js'
import { initiateUploadSession } from '#/services/uploader-client.js'

const uploadInitiationSchema = Joi.object({
  reference: Joi.string().trim().required(),
  submissionId: Joi.string().trim().required(),
  userId: Joi.string().trim().required()
})

const callbackPayloadSchema = Joi.object({
  uploadId: Joi.string().allow('').optional(),
  uploadStatus: Joi.string().optional(),
  file: Joi.object({
    fileStatus: Joi.string().optional(),
    s3Key: Joi.string().allow('').optional(),
    s3Bucket: Joi.string().allow('').optional()
  }).unknown(true),
  s3Key: Joi.string().allow('').optional(),
  s3Bucket: Joi.string().allow('').optional(),
  errorCode: Joi.string().allow('').optional(),
  errorMessage: Joi.string().allow('').optional()
}).unknown(true)

const getUploadRecord = async (db, uploadId) =>
  db.collection('nrdu-uploads').findOne({ uploadId }, { projection: { _id: 0 } })

export const nrduUpload = [
  {
    method: 'POST',
    path: '/nrdu/upload/initiate',
    options: {
      validate: {
        payload: uploadInitiationSchema
      }
    },
    handler: async (request, h) => {
      const { reference, submissionId, userId } = request.payload
      const session = await initiateUploadSession({
        reference,
        submissionId,
        userId
      })

      const uploadDocument = {
        uploadId: session.uploadId,
        reference,
        submissionId,
        userId,
        status: 'pending',
        uploadUrl: session.uploadUrl,
        statusUrl: session.statusUrl,
        createdAt: new Date().toISOString()
      }

      await request.db.collection('nrdu-uploads').insertOne(uploadDocument)

      return h.response({
        uploadId: session.uploadId,
        uploadUrl: session.uploadUrl,
        statusUrl: session.statusUrl,
        reference
      })
    }
  },
  {
    method: 'GET',
    path: '/nrdu/upload-status/{uploadId}',
    handler: async (request, h) => {
      const upload = await getUploadRecord(request.db, request.params.uploadId)

      if (!upload) {
        return Boom.notFound(`No upload found for ${request.params.uploadId}`)
      }

      return h.response({ upload })
    }
  },
  {
    method: 'POST',
    path: '/nrdu/upload-callback/{reference}',
    options: {
      validate: {
        params: Joi.object({
          reference: Joi.string().trim().required()
        }),
        headers: Joi.object({
          'x-callback-token': Joi.string().required()
        }).unknown(true),
        payload: callbackPayloadSchema
      }
    },
    handler: async (request, h) => {
      const callbackToken = request.headers['x-callback-token']
      const expectedToken = config.get('uploader.callbackToken')

      if (callbackToken !== expectedToken) {
        return Boom.unauthorized('Invalid callback token')
      }

      const upload = await request.db
        .collection('nrdu-uploads')
        .findOne({ reference: request.params.reference })

      if (!upload) {
        return Boom.notFound(`No upload record found for ${request.params.reference}`)
      }

      const file = request.payload.file || {}
      const nextStatus = request.payload.uploadStatus || upload.status || 'pending'
      const nextRecord = {
        ...upload,
        status: nextStatus,
        uploadStatus: request.payload.uploadStatus || nextStatus,
        fileStatus: file.fileStatus || request.payload.fileStatus || upload.fileStatus,
        s3Key: file.s3Key || request.payload.s3Key || upload.s3Key,
        s3Bucket: file.s3Bucket || request.payload.s3Bucket || upload.s3Bucket,
        errorCode: request.payload.errorCode || upload.errorCode,
        errorMessage: request.payload.errorMessage || upload.errorMessage,
        updatedAt: new Date().toISOString()
      }

      await request.db.collection('nrdu-uploads').updateOne(
        { reference: request.params.reference },
        { $set: nextRecord }
      )

      return h.response({ ok: true, uploadId: upload.uploadId })
    }
  }
]
