import { vi } from 'vitest'

const mockSendOtpEmail = vi.fn()

vi.mock('#/services/notify-client.js', () => ({
  sendOtpEmail: (...args) => mockSendOtpEmail(...args)
}))

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
  })

  const send = (email) =>
    server.inject({
      method: 'POST',
      url: '/auth/otp/send',
      payload: { email }
    })

  const verify = (email, otp) =>
    server.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { email, otp }
    })

  const sentCode = () => mockSendOtpEmail.mock.calls.at(-1)[1]

  test('send emails a 6-digit code and stores only its hash', async () => {
    const response = await send('User@Example.com')

    expect(response.statusCode).toBe(204)
    expect(mockSendOtpEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/)
    )

    const record = await server.db
      .collection('auth-otps')
      .findOne({ email: 'user@example.com' })
    expect(record.codeHash).toBeDefined()
    expect(JSON.stringify(record)).not.toContain(sentCode())
  })

  test('send rejects an invalid email', async () => {
    const response = await send('nope')
    expect(response.statusCode).toBe(400)
    expect(mockSendOtpEmail).not.toHaveBeenCalled()
  })

  test('send returns 429 inside the resend cooldown', async () => {
    await send('user@example.com')
    const response = await send('user@example.com')
    expect(response.statusCode).toBe(429)
  })

  test('send returns 502 and keeps no code when the email fails', async () => {
    mockSendOtpEmail.mockRejectedValue(new Error('Notify down'))

    const response = await send('user@example.com')

    expect(response.statusCode).toBe(502)
    expect(await server.db.collection('auth-otps').countDocuments()).toBe(0)
  })

  test('verify accepts the correct code once only', async () => {
    await send('user@example.com')
    const code = sentCode()

    const first = await verify('user@example.com', code)
    expect(first.statusCode).toBe(200)
    expect(first.result).toEqual({ valid: true })

    const second = await verify('user@example.com', code)
    expect(second.result).toEqual({ valid: false })
  })

  test('verify rejects a wrong code', async () => {
    await send('user@example.com')
    const wrong = sentCode() === '000000' ? '111111' : '000000'

    const response = await verify('user@example.com', wrong)
    expect(response.result).toEqual({ valid: false })
  })

  test('verify rejects an unknown email', async () => {
    const response = await verify('nobody@example.com', '123456')
    expect(response.result).toEqual({ valid: false })
  })

  test('verify rejects an expired code', async () => {
    await send('user@example.com')
    await server.db
      .collection('auth-otps')
      .updateOne(
        { email: 'user@example.com' },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      )

    const response = await verify('user@example.com', sentCode())
    expect(response.result).toEqual({ valid: false })
  })

  test('verify locks after too many wrong attempts, even for the right code', async () => {
    await send('user@example.com')
    const code = sentCode()
    const wrong = code === '000000' ? '111111' : '000000'

    for (let i = 0; i < 5; i++) {
      await verify('user@example.com', wrong)
    }

    const response = await verify('user@example.com', code)
    expect(response.statusCode).toBe(429)
  })

  test('verify rejects a code that is not 6 digits', async () => {
    const response = await verify('user@example.com', '12a')
    expect(response.statusCode).toBe(400)
  })
})
