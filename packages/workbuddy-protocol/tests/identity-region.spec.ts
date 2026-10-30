/**
 * 身份与区域表规格：UA 形状红线、版本校验、三域名不合并。
 * Identity and region-table specs: UA shape red lines, version validation,
 * the three-domain rule.
 */
import { describe, expect, it } from 'vitest'
import { appUserAgent, chatUserAgent, fallbackChatIdentity, resolveAppVersion, resolveChatIdentity, validVersion } from '../src/identity.ts'
import { ALL_REGIONS, REGION_PROFILES, regionOfDomain } from '../src/region.ts'

describe('区域表 / region table', () => {
  it('CN 三域名刻意不同——不许顺手合并（上游按 Origin 校验）', () => {
    const cn = REGION_PROFILES['cn']
    expect(new Set([cn.base, cn.origin, cn.loginBase]).size).toBe(3)
    const global = REGION_PROFILES['global']
    expect(global.base).toBe(global.origin)
    expect(global.refreshSource).toBe('plugin')
    expect(cn.refreshSource).toBe('workbuddy')
    expect(ALL_REGIONS).toEqual(['cn', 'global'])
  })

  it('域后缀匹配：workbuddy.ai → global，其余（含空）→ cn', () => {
    expect(regionOfDomain('workbuddy.ai')).toBe('global')
    expect(regionOfDomain('api.workbuddy.ai')).toBe('global')
    expect(regionOfDomain(' codebuddy.cn ')).toBe('cn')
    expect(regionOfDomain('')).toBe('cn')
  })
})

describe('chat User-Agent / chat UA', () => {
  it('两区域形状：国际版产品段带空格', () => {
    expect(chatUserAgent({ clientVersion: '5.5.6' }, 'cn')).toBe('WorkBuddy/5.5.6 WorkBuddy/5.5.6')
    expect(chatUserAgent({ clientVersion: '5.5.2' }, 'global')).toBe('WorkBuddy/5.5.2 WorkBuddy AI/5.5.2')
    expect(chatUserAgent({ clientVersion: '5.5.6', cliVersion: '2.63.2' }, 'cn')).toBe('WorkBuddy/5.5.6 WorkBuddy/5.5.6 CLI/2.63.2')
  })

  it('非法版本拒绝进头；坏 CLI 版本在解析层丢弃而非失败', () => {
    expect(() => chatUserAgent({ clientVersion: '5.5.6\nEvil: 1' }, 'cn')).toThrow()
    // 丢弃发生在 resolveChatIdentity：CLI 段可选，坏值直接不进身份。
    const identity = resolveChatIdentity('cn', { cliVersion: 'bad version' })
    expect(chatUserAgent(identity, 'cn')).toBe('WorkBuddy/5.5.6 WorkBuddy/5.5.6')
  })
})

describe('catalog UA / App UA', () => {
  it('无空格红线：WorkBuddyAI/<ver>', () => {
    expect(appUserAgent('5.5.2')).toBe('WorkBuddyAI/5.5.2')
    expect(appUserAgent('5.5.2')).not.toContain('WorkBuddy AI')
  })
})

describe('版本解析 / version resolution', () => {
  it('配置优先；非法配置报错而非悄悄换默认（misconfiguration fails loud）', () => {
    expect(resolveAppVersion('global', { appVersion: '9.9.9' })).toBe('9.9.9')
    expect(() => resolveAppVersion('cn', { appVersion: 'no' })).toThrow()
    expect(() => resolveChatIdentity('cn', { appVersion: 'no' })).toThrow()
    expect(validVersion('2.137.1-rc.1')).toBe(true)
    expect(validVersion('5 5 6')).toBe(false)
    expect(fallbackChatIdentity('global')).toEqual({ clientVersion: '5.5.2' })
  })
})
