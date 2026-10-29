/**
 * 文案表的 locale 齐平契约：zh/en 键集一致、方法/错误映射键全覆盖。
 * Locale parity contract for the copy tables: zh/en key sets match, and the
 * method/error mapping keys are fully covered.
 *
 * @module @veren/opencode-go/tests
 */
import { describe, expect, it } from 'vitest'
import { en, humanizeSignInError, NS, zh, type OgKey } from '../src/client/locales.ts'

describe('locales', () => {
  it('zh/en 键集完全一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('方法与状态关键键齐备', () => {
    for (const key of ['methodConsoleKey', 'methodImportLocal', 'signOut', 'alreadyRunning', 'keyInvalid', 'authorizedDone'] as const satisfies readonly OgKey[]) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  it('错误人话映射：code 优先、消息指纹兜底、未知透传', () => {
    const t = (key: OgKey) => zh[key]
    expect(humanizeSignInError('ALREADY_IN_FLIGHT', 'x', t)).toBe(zh.alreadyRunning)
    expect(humanizeSignInError(undefined, 'an authorization attempt for opencode-go/account is already running', t)).toBe(zh.alreadyRunning)
    expect(humanizeSignInError('KEY_INVALID', 'x', t)).toBe(zh.keyInvalid)
    expect(humanizeSignInError(undefined, 'something else', t)).toBeUndefined()
  })

  it('NS 是本插件的 locale 命名空间', () => {
    expect(NS).toBe('opencode-go')
  })
})
