import { describe, expect, it } from 'vitest'
import { defineAppPage, definePage } from '../src/index.ts'
import {
  APPS_URL_PREFIX,
  RESERVED_APP_IDS,
  assertAppUrlPattern,
  isAppUrlPattern,
  isValidAppId,
} from '../src/contract.ts'

describe('应用作用域 URL 形态（§6.1）', () => {
  it('isValidAppId：slug 规则 + 保留字', () => {
    expect(isValidAppId('review-workbench')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
    expect(isValidAppId('Review')).toBe(false)
    expect(isValidAppId('1abc')).toBe(false)
    expect(isValidAppId('a_b')).toBe(false)
    expect(isValidAppId('a'.repeat(33))).toBe(false)
    for (const reserved of RESERVED_APP_IDS) expect(isValidAppId(reserved)).toBe(false)
  })

  it('assertAppUrlPattern：/apps/<appId>/... 形态 + :param 规则', () => {
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/review/:pr')).not.toThrow()
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench')).not.toThrow()
    expect(isAppUrlPattern('/apps/review-workbench/review/:pr')).toBe(true)
    expect(isAppUrlPattern(APPS_URL_PREFIX + '/a')).toBe(true)

    expect(() => assertAppUrlPattern('p', '/task-list')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps')).toThrow(/must start with/)
    expect(() => assertAppUrlPattern('p', '/apps/api/x')).toThrow(/invalid app id/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/apps/x')).toThrow(/"apps" segment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x?y=1')).toThrow(/query or fragment/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:a/:a')).toThrow(/duplicate :param/)
    expect(() => assertAppUrlPattern('p', '/apps/review-workbench/x/:')).toThrow(/invalid or duplicate :param/)
  })
})

describe('defineAppPage（应用作用域契约）', () => {
  const title = (params: { pr?: string }) => `审阅 PR #${params.pr ?? '?'}`
  const good = {
    name: 'review',
    url: '/apps/review-workbench/review/:pr',
    description: '审阅一个 PR 的改动',
    tools: ['read_diff'],
    instructions: '先读 diff，再给结论。',
    instanceTitle: title as never,
    pageRevision: 2,
    tree: () => [],
  }

  it('合法：契约字段原样保留', () => {
    const page = defineAppPage(good)
    expect(page.url).toBe('/apps/review-workbench/review/:pr')
    expect(page.tools).toEqual(['read_diff'])
    expect(page.instructions).toBe('先读 diff，再给结论。')
    expect(page.pageRevision).toBe(2)
    expect(page.instanceTitle?.({ pr: '42' })).toBe('审阅 PR #42')
  })

  it('缺省补齐：pageRevision=1、tools=[]', () => {
    const page = defineAppPage({ ...good, tools: undefined, pageRevision: undefined })
    expect(page.tools).toEqual([])
    expect(page.pageRevision).toBe(1)
  })

  it('URL 非 /apps 形态 → fail loud（definePage 不做此校验，保证迁移期兼容）', () => {
    expect(() => defineAppPage({ ...good, url: '/review/:pr' })).toThrow(/must start with/)
    expect(() => definePage({ ...good, url: '/review/:pr' })).not.toThrow()
  })
})
