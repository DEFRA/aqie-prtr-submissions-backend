import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import Boom from '@hapi/boom'

import { config } from '#/config.js'
import { sendOtpEmail } from '#/services/notify-client.js'

const COLLECTION = 'auth-otps'
const CODE_LENGTH = 6
const DEV_SECRET = 'dev-only-otp-secret'

function hashCode(email, code) {
  const secret = config.get('otp.secret') || DEV_SECRET
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex')
}

function hashesMatch(a, b) {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function generateCode() {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

export function normaliseEmail(email) {
  return email.trim().toLowerCase()
}

/**
 * Creates a passcode for the email and sends it. Replaces any earlier passcode.
 * Throws 429 inside the resend cooldown and 502 if the email could not be sent.
 */
export async function sendOtp(db, rawEmail, now = new Date()) {
  const email = normaliseEmail(rawEmail)
  const collection = db.collection(COLLECTION)

  const existing = await collection.findOne({ email })
  const cooldownMs = config.get('otp.resendCooldownSeconds') * 1000
  if (existing && now - existing.createdAt < cooldownMs) {
    throw Boom.tooManyRequests('Wait before requesting another passcode')
  }

  const code = generateCode()
  await collection.replaceOne(
    { email },
    {
      email,
      codeHash: hashCode(email, code),
      attempts: 0,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.get('otp.ttlMinutes') * 60000)
    },
    { upsert: true }
  )

  try {
    await sendOtpEmail(email, code)
  } catch (error) {
    await collection.deleteOne({ email })
    throw Boom.badGateway('Failed to send passcode', error)
  }
}

/**
 * Checks a passcode. A correct code is single-use. Throws 429 once the
 * attempt limit is reached.
 */
export async function verifyOtp(db, rawEmail, otp, now = new Date()) {
  const email = normaliseEmail(rawEmail)
  const collection = db.collection(COLLECTION)

  // Counting the attempt in the same operation stops parallel guesses beating the limit.
  const record = await collection.findOneAndUpdate(
    {
      email,
      expiresAt: { $gt: now },
      attempts: { $lt: config.get('otp.maxAttempts') }
    },
    { $inc: { attempts: 1 } },
    { returnDocument: 'before' }
  )

  if (!record) {
    const locked = await collection.findOne({ email, expiresAt: { $gt: now } })
    if (locked) {
      throw Boom.tooManyRequests('Too many attempts')
    }
    return { valid: false }
  }

  if (!hashesMatch(record.codeHash, hashCode(email, otp))) {
    return { valid: false }
  }

  await collection.deleteOne({ email })
  return { valid: true }
}
