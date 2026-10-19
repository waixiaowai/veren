/**
 * UI kernel behavior: pack registration, audience filtering, contract refusal
 * and asset containment.
 *
 * UI 内核行为：包注册、受众过滤、契约拒绝与资源路径收敛。
 */

import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdminError, type ProviderManifest } from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { AdminUiKernel } from '../src/index.ts'
import type { UiPackManifest } from '@veren/admin-ui-contract'

/** Manifest helper for the required `admin` dependency. 必需 `admin` 依赖的清单辅助函数。 */
function manifest(id: string, capability: ProviderManifest['capability']): ProviderManifest {
  return { id, capability, contract: '^1.0', priority: 0, label: id }
}

/** One pack declaration helper. 单个包声明辅助函数。 */
function pack(id: string, kind: UiPackManifest['kind'], order = 0): UiPackManifest {
  return {
    id,
    version: '0.1.0',
    uiContract: '^1.0',
    kind,
    entry: `/admin/ui-plugins/${id}/client.js`,
    label: { en: id, zh: id },
    order,
  }
}

describe('AdminUiKernel', () => {
  let ctx: Context
  let ui: AdminUiKernel
  let root: string

  beforeEach(() => {
    ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    kernel.register(manifest('navigation', 'navigation'), {})
    ui = new AdminUiKernel(ctx)
    root = resolve('/srv/packs')
  })

  it('publishes core packs before sign-in and every pack after', () => {
    ui.register({ manifest: pack('theme', 'theme'), root })
    ui.register({ manifest: pack('locale', 'locale'), root })
    ui.register({ manifest: pack('a-page', 'page'), root })

    expect(ui.manifest('public').packs.map((entry) => entry.id)).toEqual(['locale', 'theme'])
    expect(ui.manifest('admin').packs.map((entry) => entry.id)).toEqual(['locale', 'a-page', 'theme'])
  })

  it('refuses a duplicate pack id and an incompatible contract', () => {
    ui.register({ manifest: pack('theme', 'theme'), root })
    expect(() => ui.register({ manifest: pack('theme', 'theme'), root })).toThrow(AdminError)
    expect(() => ui.register({ manifest: { ...pack('old', 'theme'), uiContract: '^2.0' }, root })).toThrow(/excludes/)
  })

  it('removes a pack when its registration is disposed', () => {
    const dispose = ui.register({ manifest: pack('theme', 'theme'), root })
    expect(ui.manifest('public').packs).toHaveLength(1)
    dispose()
    expect(ui.manifest('public').packs).toHaveLength(0)
    dispose()
    expect(ui.manifest('public').packs).toHaveLength(0)
  })

  it('resolves allowlisted assets inside a pack and refuses escapes', () => {
    ui.register({ manifest: pack('theme', 'theme'), root })
    expect(ui.asset('theme', '/client.js')?.path).toBe(resolve(root, 'client.js'))
    expect(ui.asset('theme', '/../../etc/passwd.js')).toBeUndefined()
    expect(ui.asset('theme', '/tool.exe')).toBeUndefined()
    expect(ui.asset('missing', '/client.js')).toBeUndefined()
  })
})
