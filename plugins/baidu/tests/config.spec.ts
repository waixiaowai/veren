/** 配置验收：缺省值、必填校验、授权根规范化与授权页地址。 */
/** Config acceptance: defaults, required checks, root normalization, and the authorize URL. */
import { describe, expect, it } from 'vitest'
import { authorizeUrl, DEFAULT_ROOT, resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies the documented defaults', () => {
    const config = resolveConfig({ appKey: 'k', secretKey: 's' })
    expect(config.root).toBe(DEFAULT_ROOT)
    expect(config.requestTimeoutMs).toBe(30_000)
    expect(config.maxAttempts).toBe(3)
  })

  it('fails loudly without the app triple', () => {
    expect(() => resolveConfig({})).toThrow(/appKey/)
    expect(() => resolveConfig({ appKey: 'k' })).toThrow(/secretKey/)
    expect(() => resolveConfig({ appKey: '  ', secretKey: 's' })).toThrow(/appKey/)
  })

  it('normalizes the root and rejects bad shapes', () => {
    expect(resolveConfig({ appKey: 'k', secretKey: 's', root: '/apps/x/' }).root).toBe('/apps/x')
    expect(() => resolveConfig({ appKey: 'k', secretKey: 's', root: 'apps/x' })).toThrow(/absolute/)
    expect(() => resolveConfig({ appKey: 'k', secretKey: 's', root: '/apps/../x' })).toThrow(/traversal/)
  })

  it('validates the numeric bounds', () => {
    expect(() => resolveConfig({ appKey: 'k', secretKey: 's', requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/)
    expect(() => resolveConfig({ appKey: 'k', secretKey: 's', maxAttempts: 11 })).toThrow(/maxAttempts/)
    expect(() => resolveConfig({ appKey: 'k', secretKey: 's', maxAttempts: 1.5 })).toThrow(/maxAttempts/)
  })
})

describe('authorizeUrl', () => {
  it('uses the oob code flow with the netdisk scope', () => {
    const url = authorizeUrl(resolveConfig({ appKey: 'my-key', secretKey: 's' }))
    expect(url).toContain('openapi.baidu.com/oauth/2.0/authorize')
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=my-key')
    expect(url).toContain('redirect_uri=oob')
    expect(url).toContain('scope=basic')
  })
})
