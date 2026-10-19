/**
 * Permission labels: every catalog permission must have a readable name in both
 * locales, and the raw wire value must stay traceable.
 * 权限名称：目录中的每项权限在中英两套文案里都必须有可读名称，且原始线上值保持可追溯。
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_PERMISSIONS } from '@veren/admin-contract'

/** The browser half of a locale pack. 语言包的浏览器半边。 */
interface LocalePack {
  activate(runtime: { registerLocale(entry: { id: string; messages: Record<string, string> }): void }): void
}

/** Every permission the platform defines. 平台定义的全部权限。 */
const PERMISSIONS: readonly string[] = Object.values(ADMIN_PERMISSIONS)

// `ui/locale-zh-en/client.js` is browser JavaScript shipped as-is, so the test
// loads it dynamically and captures the dictionaries through its activation API.
// `ui/locale-zh-en/client.js` 是原样发布的浏览器 JavaScript，因此测试动态加载它，
// 并通过其激活 API 捕获两份词典。
const packUrl = new URL('../../ui/locale-zh-en/client.js', import.meta.url).href
const pack = await import(packUrl) as LocalePack
const dictionaries: Record<string, Record<string, string>> = {}
pack.activate({
  registerLocale: (entry) => {
    dictionaries[entry.id] = entry.messages
  },
})

const zh = dictionaries.zh ?? {}
const en = dictionaries.en ?? {}

describe('permission labels', () => {
  it('names every catalog permission in both locales', () => {
    for (const permission of PERMISSIONS) {
      for (const [id, messages] of [['zh', zh], ['en', en]] as const) {
        const label = messages[`perm.${permission}`]
        expect(typeof label, `${id} label for ${permission}`).toBe('string')
        expect(label?.trim(), `${id} label for ${permission}`).not.toBe('')
        // A label that copies the wire value would defeat the purpose. 直接复制线上值的“标签”没有意义。
        expect(label, `${id} label for ${permission}`).not.toBe(permission)
      }
    }
  })

  it('localizes permission names instead of sharing one string', () => {
    for (const permission of PERMISSIONS) {
      expect(zh[`perm.${permission}`], `${permission} must differ between zh and en`)
        .not.toBe(en[`perm.${permission}`])
    }
  })

  it('keeps the zh and en key sets aligned', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('names every permission section and picker control', () => {
    const keys = [
      'permGroup.overview',
      'permGroup.identity',
      'permGroup.observe',
      'permGroup.system',
      'permGroup.terminal',
      'permGroup.other',
      'permPicker.all',
      'permPicker.none',
      'permPicker.invert',
    ]
    for (const key of keys) {
      for (const [id, messages] of [['zh', zh], ['en', en]] as const) {
        expect(messages[key]?.trim(), `${id} copy for ${key}`).toBeTruthy()
      }
    }
  })
})
