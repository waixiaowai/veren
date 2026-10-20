/**
 * Full P0 composition: every default provider, the gateway and the web routes
 * driven over real HTTP.
 *
 * This is the test that answers "does the platform actually work": first-run
 * setup, session cookies, CSRF, permission-gated user management, audit rows,
 * the capability catalog and the bootstrap payload, all against the real
 * implementations rather than per-package fakes.
 *
 * P0 全量组合：每个默认 provider、网关与 Web 路由，全部走真实 HTTP。该测试回答
 * “平台真的能跑吗”：首次初始化、会话 Cookie、CSRF、带权限的用户管理、审计行、能力
 * 目录与 bootstrap 载荷，全部对真实实现而非逐包伪实现。
 */

import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminApi } from '@veren/admin-api-kernel'
import { AdminKernel } from '@veren/admin-kernel'
import { apply as applyAccess } from '@veren/admin-access-rbac'
import { apply as applyAuth } from '@veren/admin-auth-local'
import { apply as applyNav } from '@veren/admin-navigation-default'
import { apply as applyAudit } from '@veren/admin-audit-default'
import { apply as applyDocs } from '@veren/admin-docs-openapi'
import { webRoutes } from '../../web/src/handlers.ts'
import { dataManifest, memoryDatabase } from './memory-data.ts'

/** One running platform. 一个运行中的平台。 */
interface Platform {
  readonly base: string
  readonly close: () => Promise<void>
  readonly server: Server
}

/** Build the platform with every default provider. 用全部默认 provider 构建平台。 */
async function startPlatform(): Promise<Platform> {
  const ctx = new Context()
  const kernel = new AdminKernel(ctx, { essential: [] })
  kernel.register(dataManifest(), memoryDatabase())
  const api = new AdminApi(ctx, { rateLimit: { window: 60, max: 10_000 } })

  applyAccess(ctx, {})
  applyAuth(ctx, { passwordMinLength: 8, sessionDays: 7 })
  applyNav(ctx)
  applyAudit(ctx, { maxEntries: 1000, retentionDays: 30 })
  applyDocs(ctx)
  for (const route of webRoutes(ctx)) ctx.effect(() => api.register(route), `integration-${route.path}-${route.method}`)

  const server = createServer((req, res) => {
    void api.handle(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

/** Extract cookie pairs from a response. 从响应中提取 Cookie 对。 */
function cookiesOf(response: Response): string {
  const raw = response.headers.getSetCookie()
  return raw.map((entry) => entry.split(';')[0]).join('; ')
}

/** Read one cookie value from a cookie header. 从 Cookie 头读取单个值。 */
function cookieValue(header: string, name: string): string {
  const part = header.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))
  return part === undefined ? '' : decodeURIComponent(part.slice(name.length + 1))
}

describe('P0 platform composition', () => {
  let platform: Platform | undefined

  afterEach(async () => {
    await platform?.close()
    platform = undefined
  })

  it('runs setup → sign-in → bootstrap → user management → audit → catalog', async () => {
    platform = await startPlatform()

    const setupState = await fetch(`${platform.base}/api/public/v1/setup`)
    expect(await setupState.json()).toEqual({ required: true })

    const setup = await fetch(`${platform.base}/api/public/v1/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' }),
    })
    expect(setup.status).toBe(200)
    const setupBody = await setup.json() as { user: { permissions: string[] }; csrfToken: string }
    expect(setupBody.user.permissions).toContain('admin.users.manage')
    const cookies = cookiesOf(setup)
    const csrf = cookieValue(cookies, 'admin_csrf')
    expect(csrf).toBe(setupBody.csrfToken)

    const bootstrap = await fetch(`${platform.base}/api/admin/v1/bootstrap`, { headers: { cookie: cookies } })
    expect(bootstrap.status).toBe(200)
    const bootstrapBody = await bootstrap.json() as {
      user: { email: string }
      nav: { path: string }[]
      features: { data: boolean; docs: boolean; settings: boolean }
      contractVersion: string
    }
    expect(bootstrapBody.user.email).toBe('owner@example.com')
    expect(bootstrapBody.nav.map((node) => node.path)).toContain('/users')
    expect(bootstrapBody.features.data).toBe(true)
    expect(bootstrapBody.features.settings).toBe(false)
    expect(bootstrapBody.contractVersion).toBe('1.0.0')

    const created = await fetch(`${platform.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: cookies, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reviewer@example.com', password: 'correct horse', name: 'Reviewer', roles: ['auditor'] }),
    })
    expect(created.status).toBe(200)
    expect((await created.json() as { roles: string[] }).roles).toEqual(['auditor'])

    const users = await fetch(`${platform.base}/api/admin/v1/users`, { headers: { cookie: cookies } })
    expect((await users.json() as { items: unknown[] }).items).toHaveLength(2)

    const audit = await fetch(`${platform.base}/api/admin/v1/audit?limit=50`, { headers: { cookie: cookies } })
    const auditBody = await audit.json() as { items: { action: string; result: string }[] }
    expect(auditBody.items.map((entry) => entry.action)).toContain('auth.setup')
    expect(auditBody.items.map((entry) => entry.action)).toContain('users.create')

    const capabilities = await fetch(`${platform.base}/api/admin/v1/capabilities`, { headers: { cookie: cookies } })
    const catalog = await capabilities.json() as { capabilities: { capability: string; active: unknown }[] }
    expect(catalog.capabilities.filter((entry) => entry.active !== null).map((entry) => entry.capability))
      .toEqual(expect.arrayContaining(['data', 'auth', 'access', 'navigation', 'audit', 'docs']))
  })

  it('refuses a write without the CSRF pair and a read without a session', async () => {
    platform = await startPlatform()
    const anonymous = await fetch(`${platform.base}/api/admin/v1/bootstrap`)
    expect(anonymous.status).toBe(401)

    const setup = await fetch(`${platform.base}/api/public/v1/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' }),
    })
    const cookies = cookiesOf(setup)

    const noCsrf = await fetch(`${platform.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'correct horse', name: 'X' }),
    })
    expect(noCsrf.status).toBe(403)
    expect((await noCsrf.json() as { error: { code: string } }).error.code).toBe('CSRF_FAILED')
  })
})
