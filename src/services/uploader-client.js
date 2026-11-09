import { config } from '#/config.js'

export async function initiateUploadSession({
  reference,
  submissionId,
  userId,
  callbackPath = '/nrdu/upload-callback'
}) {
  const uploaderConfig = config.get('uploader')
  const callbackBaseUrl = uploaderConfig.callbackBaseUrl.replace(/\/$/, '')
  const callback = new URL(
    `${callbackPath.replace(/^\//, '')}`,
    `${callbackBaseUrl}/`
  ).toString()

  const response = await fetch(`${uploaderConfig.url}/initiate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      redirect: uploaderConfig.redirectPath,
      callback: `${callback.replace(/\/$/, '')}/${reference}`,
      s3Bucket: uploaderConfig.s3Bucket,
      s3Path: uploaderConfig.s3Path,
      metadata: {
        reference,
        submissionId,
        userId
      },
      mimeTypes: uploaderConfig.allowedMimeTypes,
      maxFileSize: uploaderConfig.maxFileSize
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to initiate uploader session: ${text}`)
  }

  return response.json()
}
