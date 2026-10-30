/**
 * 凭据文档规格：单文档四类状态、登出四类清除原子完成、解析守卫、region 重算。
 * State-document specs: one document, four classes; logout's four-class purge
 * is atomic; parse guards; region recomputation.
 */
import { describe, expect, it } from 'vitest'
import {
  emptyStateDocument, parseStateDocument, regionOfEntry, withAccountEntry,
  withCooldown, withDisabled, withoutAccount, withProbeObservation,
  type WorkbuddyAccountEntry,
} from '../src/index.ts'

function entry(uid: string, domain = 'codebuddy.cn'): WorkbuddyAccountEntry {
  return { accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs: 1_000, domain, uid }
}

describe('登出四类清除 / four-class logout purge', () => {
  it('withoutAccount 一次删净：凭据、冷却、停用、探测', () => {
    let document = emptyStateDocument()
    document = withAccountEntry(document, entry('u-1'))
    document = withCooldown(document, 'u-1', 5_000)
    document = withDisabled(document, 'u-1', true)
    document = withProbeObservation(document, 'u-1', 'cn', 'glm-5.3', { validation: 'validating', efforts: ['low'], observedAtMs: 1 })
    document = withAccountEntry(document, entry('u-2'))
    document = withoutAccount(document, 'u-1')
    expect(document.accounts.map(account => account.uid)).toEqual(['u-2'])
    expect(document.cooldowns['u-1']).toBeUndefined()
    expect(document.disabled).not.toContain('u-1')
    expect(document.probes['u-1']).toBeUndefined()
  })

  it('只删凭据的旧世界不再可能：单文档构造上四类同删（同 uid 再登录旧停用态不复活）', () => {
    let document = withDisabled(withAccountEntry(emptyStateDocument(), entry('u-1')), 'u-1', true)
    document = withoutAccount(document, 'u-1')
    document = withAccountEntry(document, entry('u-1'))
    expect(document.disabled).not.toContain('u-1')
  })
})

describe('upsert 与解析 / upsert and parsing', () => {
  it('同 uid 登入替换原位，不产生重复账号', () => {
    let document = emptyStateDocument()
    document = withAccountEntry(document, entry('u-1'))
    document = withAccountEntry(document, entry('u-2'))
    document = withAccountEntry(document, { ...entry('u-1'), accessToken: 'at-new' })
    expect(document.accounts.map(account => account.uid)).toEqual(['u-1', 'u-2'])
    expect(document.accounts[0]?.accessToken).toBe('at-new')
  })

  it('regionOfEntry 按 domain 重算，不从盘上信', () => {
    expect(regionOfEntry(entry('u', 'workbuddy.ai'))).toBe('global')
    expect(regionOfEntry(entry('u', 'codebuddy.cn'))).toBe('cn')
    expect(regionOfEntry(entry('u', ''))).toBe('cn')
  })

  it('形状不符的载荷回答 undefined（调用方以空文档续跑，不猜）', () => {
    expect(parseStateDocument(undefined)).toBeUndefined()
    expect(parseStateDocument({ version: 2 })).toBeUndefined()
    expect(parseStateDocument({ version: 1, accounts: [{ uid: 'x' }] })).toBeUndefined()
    expect(parseStateDocument({ version: 1, accounts: [], cooldowns: {}, disabled: [], probes: {} })).toBeDefined()
  })
})
