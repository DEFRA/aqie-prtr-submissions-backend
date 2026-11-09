import { beforeEach, describe, expect, test, vi } from 'vitest'

import { config } from '#/config.js'
import { initiateUploadSession } from '#/services/uploader-client.js'

describe('uploader client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    config.set('uploader.url', 'http://localhost:7337')
    config.set('uploader.callbackBaseUrl', 'http://localhost:3001')
    config.set('uploader.redirectPath', '/nrdu/upload-received')
    config.set('uploader.s3Bucket', 'my-bucket')
    config.set('uploader.s3Path', 'nrdu')
    config.set('uploader.maxFileSize', 1024 * 1024)
    config.set('uploader.allowedMimeTypes', ['text/csv'])
  })

  test('it initiates an upload session with the uploader service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        uploadId: 'upload-123',
        uploadUrl: '/upload-and-scan/upload-123',
        statusUrl: 'http://localhost:7337/status/upload-123'
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await initiateUploadSession({
      reference: 'ref-001',
      submissionId: 'sub-42',
      userId: 'user-7',
      callbackPath: '/nrdu/upload-callback'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:7337/initiate')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)

    expect(body).toMatchObject({
      redirect: '/nrdu/upload-received',
      callback: 'http://localhost:3001/nrdu/upload-callback/ref-001',
      s3Bucket: 'my-bucket',
      s3Path: 'nrdu',
      metadata: {
        reference: 'ref-001',
        submissionId: 'sub-42',
        userId: 'user-7'
      },
      mimeTypes: ['text/csv'],
      maxFileSize: 1048576
    })

    expect(result).toMatchObject({
      uploadId: 'upload-123',
      uploadUrl: '/upload-and-scan/upload-123',
      statusUrl: 'http://localhost:7337/status/upload-123'
    })
  })
})
