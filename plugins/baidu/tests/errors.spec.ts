/** 错误码验收：上游映射表、可重试分类、错误值折叠与凭据载荷守卫。 */
/** Error-code acceptance: the upstream map, retry classes, error-value folding, and the grant-payload guard. */
import { describe, expect, it } from 'vitest'
import { BaiduPanError, baiduPanError, mapUpstream, parseGrantPayload, toErrorValue } from '../src/errors.js'
import { isExpiring } from '../src/credentials.js'

describe('mapUpstream', () => {
  it('maps the documented errnos', () => {
    expect(mapUpstream(-6).code).toBe('BDPAN_FORBIDDEN')
    expect(mapUpstream(-7).code).toBe('BDPAN_INVALID_NAME')
    expect(mapUpstream(-8).code).toBe('BDPAN_ALREADY_EXISTS')
    expect(mapUpstream(-9).code).toBe('BDPAN_NOT_FOUND')
    expect(mapUpstream(-10).code).toBe('BDPAN_QUOTA_EXCEEDED')
    expect(mapUpstream(20016).code).toBe('BDPAN_TOKEN_EXPIRED')
    expect(mapUpstream(31034).code).toBe('BDPAN_RATE_LIMITED')
    expect(mapUpstream(31190).code).toBe('BDPAN_QUOTA_EXCEEDED')
  })

  it('folds unmapped errnos into BDPAN_UPSTREAM', () => {
    const failure = mapUpstream(99999)
    expect(failure.code).toBe('BDPAN_UPSTREAM')
    expect(failure.upstreamCode).toBe(99999)
  })

  it('classifies retryability per code', () => {
    expect(mapUpstream(31034).retryable).toBe(true)
    expect(mapUpstream(-8).retryable).toBe(false)
    expect(mapUpstream(20016).retryable).toBe(false)
  })

  it('keeps the bilingual three-part copy', () => {
    const failure = baiduPanError('BDPAN_NOT_FOUND')
    expect(failure.message).toContain('没有找到对应内容')
    expect(failure.message).toContain('Nothing was found')
  })
})

describe('toErrorValue', () => {
  it('preserves the domain code', () => {
    const value = toErrorValue(baiduPanError('BDPAN_QUOTA_EXCEEDED'))
    expect(value).toMatchObject({ kind: 'error', code: 'BDPAN_QUOTA_EXCEEDED', retryable: false })
  })

  it('folds foreign errors into BDPAN_UNKNOWN', () => {
    const value = toErrorValue(new Error('boom'))
    expect(value.code).toBe('BDPAN_UNKNOWN')
    expect(value.message).toContain('boom')
  })
})

describe('parseGrantPayload', () => {
  const valid = { accessToken: 'a', refreshToken: 'r', expiresAt: new Date().toISOString(), scope: 's' }

  it('accepts a well-formed payload', () => {
    expect(parseGrantPayload(valid)).toEqual(valid)
  })

  it('rejects malformed payloads', () => {
    expect(parseGrantPayload(null)).toBeUndefined()
    expect(parseGrantPayload({})).toBeUndefined()
    expect(parseGrantPayload({ ...valid, accessToken: '' })).toBeUndefined()
    expect(parseGrantPayload({ ...valid, expiresAt: 'not-a-date' })).toBeUndefined()
    expect(parseGrantPayload({ ...valid, refreshToken: 42 })).toBeUndefined()
  })
})

describe('isExpiring', () => {
  it('is true within the five-minute skew and false beyond', () => {
    const soon = { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 60 * 1000).toISOString(), scope: 's' }
    const far = { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), scope: 's' }
    expect(isExpiring(soon)).toBe(true)
    expect(isExpiring(far)).toBe(false)
  })

  it('carries retryable details on BaiduPanError instances', () => {
    const failure = new BaiduPanError('BDPAN_NETWORK', 'net', { retryable: true })
    expect(failure.retryable).toBe(true)
    expect(failure.name).toBe('BaiduPanError')
  })
})
