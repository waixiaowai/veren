/**
 * 指纹规格：确定性派生、跨账号隔离、空 uid 整族不发、id 形状断言（防漂移）。
 * Fingerprint specs: deterministic derivation, cross-account isolation, empty
 * uid omits the whole family, shape assertions against drift.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveId, deviceHeaders, requestId, requestIdPrefix } from '../src/fingerprint.ts'

describe('派生 / derivation', () => {
  it('md5("wb2a:<purpose>:<uid>") 全 32 hex——形状断言防漂移', () => {
    const expected = createHash('md5').update('wb2a:machine:u-1', 'utf8').digest('hex')
    expect(deriveId('machine', 'u-1')).toBe(expected)
    expect(deriveId('machine', 'u-1')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('同账号恒定、跨账号隔离、跨用途不碰撞', () => {
    expect(deriveId('machine', 'u-1')).toBe(deriveId('machine', 'u-1'))
    expect(deriveId('machine', 'u-1')).not.toBe(deriveId('machine', 'u-2'))
    expect(deriveId('machine', 'u-1')).not.toBe(deriveId('session', 'u-1'))
  })

  it('空 uid 回答 undefined：调用方跳过该头（发空白头=登记无身份设备）', () => {
    expect(deriveId('machine', '')).toBeUndefined()
    expect(deviceHeaders('')).toEqual({})
    expect(deviceHeaders('u-1')).toEqual({
      'X-Machine-ID': deriveId('machine', 'u-1'),
      'X-Session-ID': deriveId('session', 'u-1'),
    })
  })

  it('请求 id：稳定前缀 + 唯一后缀', () => {
    expect(requestId('u-1', 1_234_567_890)).toBe(`${deriveId('req', 'u-1')}-567890`)
    expect(requestId('u-1', 1_234_567_891)).not.toBe(requestId('u-1', 1_234_567_890))
    expect(requestIdPrefix('')).toBe('wb2a-anonymous')
  })
})
