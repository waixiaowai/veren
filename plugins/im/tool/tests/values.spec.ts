import { describe, expect, it } from 'vitest'
import { ImError } from '@veren/im'
import type { ImBindAttempt } from '@veren/im'
import { bindView, requireString, settingsOf } from '../src/values.ts'

describe('IM tool values', () => {
  it('copies only known binding settings', () => {
    expect(settingsOf({ presetId: 'p', provider: 'openai', model: 'm', reasoning: 'high' }))
      .toEqual({ presetId: 'p', provider: 'openai', model: 'm', reasoning: 'high' })
    expect(settingsOf(undefined)).toEqual({})
  })

  it('rejects malformed settings and empty strings', () => {
    expect(() => settingsOf('nope')).toThrowError(expect.objectContaining({ code: 'IM_INVALID_REQUEST' }))
    expect(() => settingsOf({ presetId: 3 })).toThrowError(expect.objectContaining({ code: 'IM_INVALID_REQUEST' }))
    expect(() => requireString('  ', 'accountId')).toThrowError(expect.objectContaining({ code: 'IM_INVALID_REQUEST' }))
  })

  it('strips the remote QR URL from the tool view', () => {
    const attempt: ImBindAttempt = {
      bindId: 'bind-1',
      status: 'pending',
      challenge: {
        kind: 'qrcode',
        url: 'https://ilinkai.weixin.qq.com/secret',
        imagePath: 'C:/tmp/qr.png',
        expiresAt: 10,
      },
      async submitCode() {},
      async wait() { return { id: 'acc', displayName: 'Acc', status: 'online' } },
      async cancel() {},
    }
    const view = bindView(attempt)
    const text = JSON.stringify(view)
    expect(text).toContain('C:/tmp/qr.png')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('https://')
  })

  it('uses stable IM error codes', () => {
    expect(new ImError('IM_NOT_FOUND', 'missing').code).toBe('IM_NOT_FOUND')
  })
})
