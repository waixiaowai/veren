/**
 * Web carrier behavior: static path containment and the bootstrap payload the
 * SPA renders from.
 *
 * Web 载体行为：静态路径收敛与 SPA 渲染所用的 bootstrap 载荷。
 */

import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AdminAccess,
  AdminNavContribution,
  AdminNavNode,
  AdminNavigation,
  AuthenticatedPrincipal,
  ProviderManifest,
} from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { bootstrapPayload, uiManifest, webRoutes } from '../src/handlers.ts'
import { inject } from '../src/index.ts'
import { resolveWithin } from '../src/static.ts'

/** Manifest helper for fake providers. 伪 provider 的清单辅助函数。 */
function manifest(id: string, capability: ProviderManifest['capability']): ProviderManifest {
  return { id, capability, contract: '^1.0', priority: 0, label: id }
}

/** The principal the SPA is rendered for. SPA 渲染所用的主体。 */
const PRINCIPAL: AuthenticatedPrincipal = {
  userId: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  roles: ['owner'],
  scope: 'all',
  permissions: ['admin.dashboard.read', 'admin.audit.read'],
}

/** A navigation provider that admits every contribution. 接纳全部贡献的导航 provider。 */
class OpenNavigation implements AdminNavigation {
  register(_item: AdminNavContribution): () => void {
    return () => {}
  }

  async tree(): Promise<readonly AdminNavNode[]> {
    return [{ id: 'dashboard', labelKey: 'nav.dashboard', path: '/', icon: 'dashboard' }]
  }
}

/** A provider that grants whatever is asked. 有求必应的 provider。 */
const OPEN_ACCESS: AdminAccess = {
  permissions: () => ['admin.dashboard.read'],
  roles: async () => [],
  permissionsOf: async () => ['admin.dashboard.read'],
  rolesOf: async () => [],
  assignRole: async () => {},
  revokeRole: async () => {},
  can: () => true,
}

describe('static containment', () => {
  it('serves allowlisted files inside the root', () => {
    expect(resolveWithin('/srv/client', '/app.js')).toBe(resolve('/srv/client/app.js'))
    expect(resolveWithin('/srv/client', '/styles.css')).toBe(resolve('/srv/client/styles.css'))
  })

  it('refuses traversal, the bare root and unknown extensions', () => {
    expect(resolveWithin('/srv/client', '/../secret.js')).toBeUndefined()
    expect(resolveWithin('/srv/client', '/tool.exe')).toBeUndefined()
    expect(resolveWithin('/srv/client', '/')).toBeUndefined()
  })
})

describe('bootstrap payload', () => {
  it('joins identity, permissions, navigation and features', async () => {
    const ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    kernel.register(manifest('nav', 'navigation'), new OpenNavigation())
    kernel.register(manifest('access', 'access'), OPEN_ACCESS)

    const payload = await bootstrapPayload(ctx, PRINCIPAL, 'csrf-token')
    expect(payload.user.email).toBe('owner@example.com')
    expect(payload.permissions).toContain('admin.dashboard.read')
    expect(payload.nav).toHaveLength(1)
    expect(payload.contractVersion).toBe('1.0.0')
    expect(payload.csrfToken).toBe('csrf-token')
    expect(payload.features.data).toBe(false)
  })

  it('degrades the UI manifest to empty when no UI kernel is mounted', () => {
    const ctx = new Context()
    new AdminKernel(ctx, { essential: [] })
    expect(uiManifest(ctx, 'public')).toEqual({ uiContract: '1.0.0', packs: [] })
  })

  it('registers bootstrap and both manifest routes', () => {
    const ctx = new Context()
    new AdminKernel(ctx, { essential: [] })
    const routes = webRoutes(ctx)
    expect(routes.map((route) => `${route.audience}:${route.method}:${route.path}`)).toEqual([
      'admin:GET:/bootstrap',
      'public:GET:/ui-manifest',
      'admin:GET:/ui-manifest',
    ])
  })
})

describe('plugin declaration', () => {
  // The bootstrap handler reads the navigation façade at request time, and Cordis
  // rejects any service access the plugin did not declare
  // (`cannot get property "adminNavigation" without inject`), so the declaration
  // is part of the contract, not an implementation detail.
  // bootstrap 处理器在请求时读取导航 façade，而 Cordis 会拒绝任何未声明的服务访问
  // （`cannot get property "adminNavigation" without inject`），因此该声明属于契约而非实现细节。
  it('declares the navigation façade the bootstrap handler reads', () => {
    expect(inject).toContain('adminNavigation')
  })
})
