import { NotifyClient } from 'notifications-node-client'

import { config } from '#/config.js'

let client

function getClient() {
  client ??= new NotifyClient(config.get('govukNotify.apiKey'))
  return client
}

/** Emails the passcode using the GOV.UK Notify template (placeholder: ((code))). */
export async function sendOtpEmail(email, code) {
  await getClient().sendEmail(
    config.get('govukNotify.authenticationTemplateId'),
    email,
    { personalisation: { code } }
  )
}
