/**
 * UI contract invariants: the version is semver and the manifest vocabulary is
 * shaped as packs expect.
 *
 * UI 契约不变量：版本为 semver，清单词汇符合包的预期形状。
 */

import { describe, expect, it } from 'vitest'
import { UI_CONTRACT_VERSION, type UiManifest, type UiPackManifest } from '../src/index.ts'

describe('UI contract', () => {
  it('publishes a semver UI contract version', () => {
    expect(UI_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('publishes a manifest with ordered packs', () => {
    const pack: UiPackManifest = {
      id: 'theme-default',
      version: '0.1.0',
      uiContract: '^1.0',
      kind: 'theme',
      entry: '/admin/ui-plugins/theme-default/client.js',
      label: { en: 'Default', zh: '默认' },
    }
    const manifest: UiManifest = { uiContract: UI_CONTRACT_VERSION, packs: [pack] }
    expect(manifest.packs[0]?.entry.startsWith('/admin/ui-plugins/')).toBe(true)
  })
})
