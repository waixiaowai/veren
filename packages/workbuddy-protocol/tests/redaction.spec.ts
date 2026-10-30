/**
 * 脱敏规格：手机号/邮箱掩码、固定单星防撑宽、纯显示层。
 * Redaction specs: phone/email masks, the fixed single star against column
 * stretch, display-only semantics.
 */
import { describe, expect, it } from 'vitest'
import { displayNameOf, maskEmailAddresses, maskPersonalData, maskPhoneNumbers } from '../src/redaction.ts'

describe('手机号 / phone numbers', () => {
  it('11 位藏 7 位：前 2 后 2', () => {
    expect(maskPhoneNumbers('13800138000')).toBe('13*******00')
  })

  it('长数字串不被部分匹配（守卫防误伤 id）', () => {
    expect(maskPhoneNumbers('113800138000')).toBe('113800138000')
  })

  it('国家码保留、号码本体脱敏；混合名原地掩', () => {
    expect(maskPhoneNumbers('+86 13800138000')).toBe('+86 13*******00')
    expect(maskPhoneNumbers('张三 13800138000')).toBe('张三 13*******00')
  })
})

describe('邮箱 / emails', () => {
  it('本地部分前 2 后 2 + 固定单星；TLD 去掉', () => {
    expect(maskEmailAddresses('alice1990@example.com')).toBe('al*90@example')
  })

  it('固定单星：宽度有界，不随地址长度增长', () => {
    const short = maskEmailAddresses('ab@example.com')
    const long = maskEmailAddresses('averyveryverylongname@example.com')
    expect(short).toBe('a*@example')
    expect(long).toBe('av*me@example')
    expect(long).toHaveLength('av*me@example'.length)
  })

  it('裸 user@host 不是地址，放过', () => {
    expect(maskEmailAddresses('user@host')).toBe('user@host')
  })
})

describe('入口与展示名 / entry point and display name', () => {
  it('一次调用双识别；昵称缺失落 uid 前 8 位', () => {
    expect(maskPersonalData('13800138000 or a@b.com')).toBe('13*******00 or *@b')
    expect(displayNameOf('13800138000', 'u-1234567890')).toBe('13*******00')
    expect(displayNameOf(undefined, 'u-1234567890')).toBe('u-123456')
    expect(displayNameOf('', 'short')).toBe('short')
  })
})
