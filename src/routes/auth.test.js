import { vi } from 'vitest'

import { authModules } from '#/common/auth-modules.js'

const mockSendOtpEmail = vi.fn()

vi.mock('#/services/notify-client.js', () => ({
  sendOtpEmail: (...args) => mockSendOtpEmail(...args)
}))

const [moduleA, moduleB] = Object.keys(authModules)
const EMAIL = 'user@example.com'

describe('#auth otp routes', () => {
  let server

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(async () => {
    mockSendOtpEmail.mockReset()
    mockSendOtpEmail.mockResolvedValue(undefined)
    await server.db.collection('auth-otps').deleteMany({})
    for (const { collection } of Object.values(authModules)) {
      await server.db.collection(collection).deleteMany({})
    }
    await server.db
      .collection(authModules[moduleA].collection)
      .insertOne({ email: EMAIL })
  })

  const send = (moduleName, email) =>
    server.inject({
      method: 'POST',
      url: `/${moduleName}/auth/otp/send`,
      payload: { email }
    })

  const verify = (moduleName, email, otp) =>
    server.inject({
      method: 'POST',
      url: `/${moduleName}/auth/otp/verify`,
      payload: { email, otp }
    })

  const sentCode = () => mockSendOtpEmail.mock.calls.at(-1)[1]

  test('send emails a 6-digit code to a known user and stores only its hash', async () => {
    const response = await send(moduleA, 'User@Example.com')

    expect(response.statusCode).toBe(204)
    expect(mockSendOtpEmail).toHaveBeenCalledWith(
      EMAIL,
      expect.stringMatching(/^\d{6}$/)
    )

    const record = await server.db
      .collection('auth-otps')
      .findOne({ module: moduleA, email: EMAIL })
    expect(record.codeHash).toBeDefined()
    expect(JSON.stringify(record)).not.toContain(sentCode())
  })

  test('send answers the same way for an unknown email but sends nothing', async () => {
    const response = await send(moduleA, 'nobody@example.com')

    expect(response.statusCode).toBe(204)
    expect(mockSendOtpEmail).not.toHaveBeenCalled()
    expect(await server.db.collection('auth-otps').countDocuments()).toBe(0)
  })

  test('send checks the collection of the module in the URL', async () => {
    const response = await send(moduleB, EMAIL)

    expect(response.statusCode).toBe(204)
    expect(mockSendOtpEmail).not.toHaveBeenCalled()
  })

  test('an unknown module is a 404', async () => {
    const response = await send('not-a-module', EMAIL)
    expect(response.statusCode).toBe(404)
  })

  test('send rejects an invalid email', async () => {
    const response = await send(moduleA, 'nope')
    expect(response.statusCode).toBe(400)
    expect(mockSendOtpEmail).not.toHaveBeenCalled()
  })

  test('send returns 429 inside the resend cooldown', async () => {
    await send(moduleA, EMAIL)
    const response = await send(moduleA, EMAIL)
    expect(response.statusCode).toBe(429)
  })

  test('send returns 502 and keeps no code when the email fails', async () => {
    mockSendOtpEmail.mockRejectedValue(new Error('Notify down'))

    const response = await send(moduleA, EMAIL)

    expect(response.statusCode).toBe(502)
    expect(await server.db.collection('auth-otps').countDocuments()).toBe(0)
  })

  test('verify accepts the correct code once only', async () => {
    await send(moduleA, EMAIL)
    const code = sentCode()

    const first = await verify(moduleA, EMAIL, code)
    expect(first.statusCode).toBe(200)
    expect(first.result).toEqual({ valid: true })

    const second = await verify(moduleA, EMAIL, code)
    expect(second.result).toEqual({ valid: false })
  })

  test('a code for one module does not verify in another module', async () => {
    await server.db
      .collection(authModules[moduleB].collection)
      .insertOne({ email: EMAIL })
    await send(moduleA, EMAIL)

    const response = await verify(moduleB, EMAIL, sentCode())

    expect(response.result).toEqual({ valid: false })
  })

  test('the same email can hold a code in two modules at once', async () => {
    await server.db
      .collection(authModules[moduleB].collection)
      .insertOne({ email: EMAIL })

    expect((await send(moduleA, EMAIL)).statusCode).toBe(204)
    expect((await send(moduleB, EMAIL)).statusCode).toBe(204)
    expect(await server.db.collection('auth-otps').countDocuments()).toBe(2)
  })

  test('verify rejects a wrong code', async () => {
    await send(moduleA, EMAIL)
    const wrong = sentCode() === '000000' ? '111111' : '000000'

    const response = await verify(moduleA, EMAIL, wrong)
    expect(response.result).toEqual({ valid: false })
  })

  test('verify rejects an unknown email', async () => {
    const response = await verify(moduleA, 'nobody@example.com', '123456')
    expect(response.result).toEqual({ valid: false })
  })

  test('verify rejects an expired code', async () => {
    await send(moduleA, EMAIL)
    await server.db
      .collection('auth-otps')
      .updateOne(
        { module: moduleA, email: EMAIL },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      )

    const response = await verify(moduleA, EMAIL, sentCode())
    expect(response.result).toEqual({ valid: false })
  })

  test('verify locks after too many wrong attempts, even for the right code', async () => {
    await send(moduleA, EMAIL)
    const code = sentCode()
    const wrong = code === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      await verify(moduleA, EMAIL, wrong)
    }

    const response = await verify(moduleA, EMAIL, code)
    expect(response.statusCode).toBe(429)
  })

  test('verify rejects a code that is not 6 digits', async () => {
    const response = await verify(moduleA, EMAIL, '12a')
    expect(response.statusCode).toBe(400)
  })
})
