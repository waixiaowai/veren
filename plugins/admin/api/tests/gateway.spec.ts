/**
 * Gateway behavior over a real HTTP server: the fixed order of request id,
 * origin, authentication, CSRF, authorization, validation, audit and errors.
 *
 * 真实 HTTP 服务器上的网关行为：请求 id、来源、认证、CSRF、授权、校验、审计与错误的
 * 固定顺序。
 */

import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AdminError,
  type AdminAccess,
  type AdminAudit,
  type AdminAuditEntry,
  type AdminAuth,
  type AdminIdentity,
  type AdminSchema,
  type AdminUserView,
  type AuthenticatedPrincipal,
  type ProviderManifest,
} from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { AdminApi, type Config } from '../src/api.ts'

/** Manifest helper for the fake providers. 伪 provider 的清单辅助函数。 */
function manifest(id: string, capability: ProviderManifest['capability']): ProviderManifest {
  return { id, capability, contract: '^1.0', priority: 0, label: id }
}

/** A minimal user view used by the fake auth provider. 伪认证 provider 使用的最小用户视图。 */
const OWNER: AdminUserView = {
  id: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  active: true,
  roles: ['owner'],
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** One running test gateway. 一个运行中的测试网关。 */
interface Harness {
  readonly base: string
  readonly api: AdminApi
  readonly audits: AdminAuditEntry[]
  readonly server: Server
  close(): Promise<void>
}

/** Identity per session id; `good` is an owner, `limited` is a reader. 按会话 id 区分的身份。 */
const IDENTITIES: Record<string, AdminIdentity> = {
  good: { userId: 'u1', email: 'owner@example.com', name: 'Owner', roles: ['owner'], scope: 'all' },
  limited: { userId: 'u2', email: 'reader@example.com', name: 'Reader', roles: ['viewer'], scope: 'own' },
}

/** Build one harness with fake providers and the three probe routes. 用伪 provider 与三条探测路由构建测试夹具。 */
async function createHarness(config: Config = {}): Promise<Harness> {
  const ctx = new Context()
  const kernel = new AdminKernel(ctx, { essential: [] })
  const audits: AdminAuditEntry[] = []

  const auth: AdminAuth = {
    setupRequired: async () => false,
    setup: async () => { throw new AdminError('CONFLICT', 'already set up') },
    login: async () => { throw new AdminError('FORBIDDEN', 'not used') },
    logout: async () => {},
    authenticate: async ({ sessionId }) => (sessionId === undefined ? undefined : IDENTITIES[sessionId]),
    listUsers: async () => [OWNER],
    createUser: async () => OWNER,
    updateUser: async () => OWNER,
    deleteUser: async () => {},
    listTokens: async () => [],
    createToken: async () => { throw new AdminError('CONFLICT', 'not used') },
    revokeToken: async () => {},
  }

  const access: AdminAccess = {
    permissions: () => ['admin.users.read', 'admin.users.manage'],
    roles: async () => [],
    permissionsOf: async (identity) => (identity.roles.includes('owner') ? ['*'] : ['admin.users.read']),
    assignRole: async () => {},
    revokeRole: async () => {},
    can: (principal: AuthenticatedPrincipal, permission) =>
      principal.permissions.includes('*') || principal.permissions.includes(permission),
  }

  const audit: AdminAudit = {
    record: async (entry) => {
      audits.push({ id: `a${audits.length}`, at: new Date().toISOString(), ...entry })
    },
    list: async () => ({ items: audits }),
  }

  kernel.register(manifest('fake-auth', 'auth'), auth)
  kernel.register(manifest('fake-access', 'access'), access)
  kernel.register(manifest('fake-audit', 'audit'), audit)

  const api = new AdminApi(ctx, { rateLimit: { window: 60, max: 1000 }, ...config })
  api.register({
    audience: 'public',
    method: 'GET',
    path: '/health',
    summary: 'Public health probe',
    handler: () => ({ status: 'ok' }),
  })
  api.register({
    audience: 'admin',
    method: 'GET',
    path: '/users',
    permission: 'admin.users.read',
    summary: 'List users',
    handler: async () => ({ items: [OWNER] }),
  })
  api.register({
    audience: 'admin',
    method: 'POST',
    path: '/users',
    permission: 'admin.users.manage',
    summary: 'Create a user',
    audit: true,
    action: 'users.create',
    input: {
      parse: (value) => {
        const body = value as { name?: unknown }
        if (typeof body?.name !== 'string' || body.name.length === 0) throw new Error('name is required')
        return body
      },
    } satisfies AdminSchema,
    handler: () => OWNER,
  })

  const server = createServer((req, res) => {
    void api.handle(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port')

  return {
    base: `http://127.0.0.1:${address.port}`,
    api,
    audits,
    server,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

describe('admin API gateway', () => {
  let harness: Harness | undefined

  afterEach(async () => {
    await harness?.close()
    harness = undefined
  })

  it('serves a public route without authentication', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/public/v1/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('rejects an unauthenticated admin route with a structured envelope', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`)
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/)
  })

  it('serves an authenticated route', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, { headers: { cookie: 'admin_session=good' } })
    expect(response.status).toBe(200)
    expect((await response.json() as { items: AdminUserView[] }).items[0]?.email).toBe('owner@example.com')
  })

  it('denies a caller without the route permission', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, { headers: { cookie: 'admin_session=limited' } })
    expect(response.status).toBe(200)

    const denied = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=limited; admin_csrf=t', 'x-csrf-token': 't', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(denied.status).toBe(403)
    expect((await denied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })

  it('rejects a write without the CSRF pair', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(response.status).toBe(403)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('CSRF_FAILED')
  })

  it('accepts a write with the CSRF pair and records intent and success', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good; admin_csrf=tok', 'x-csrf-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    })
    expect(response.status).toBe(200)
    expect(harness.audits.map((entry) => [entry.action, entry.result])).toEqual([
      ['users.create', 'intent'],
      ['users.create', 'success'],
    ])
  })

  it('reports a validation failure as 422', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good; admin_csrf=tok', 'x-csrf-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(response.status).toBe(422)
    const body = await response.json() as { error: { code: string; details?: { field?: string } } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.field).toBe('body')
  })

  it('answers 404 for an unknown path and 405 for a wrong method', async () => {
    harness = await createHarness()
    const missing = await fetch(`${harness.base}/api/admin/v1/nope`, { headers: { cookie: 'admin_session=good' } })
    expect(missing.status).toBe(404)

    const wrongMethod = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'DELETE',
      headers: { cookie: 'admin_session=good' },
    })
    expect(wrongMethod.status).toBe(405)
  })

  it('rejects an untrusted origin and allows a trusted one', async () => {
    harness = await createHarness({ trustedOrigins: ['https://console.example.com'] })
    const untrusted = await fetch(`${harness.base}/api/public/v1/health`, { headers: { origin: 'https://evil.example.com' } })
    expect(untrusted.status).toBe(403)

    const trusted = await fetch(`${harness.base}/api/public/v1/health`, {
      headers: { origin: 'https://console.example.com' },
    })
    expect(trusted.status).toBe(200)
    expect(trusted.headers.get('access-control-allow-origin')).toBe('https://console.example.com')
  })

  it('rate limits a caller once the window budget is spent', async () => {
    harness = await createHarness({ rateLimit: { window: 60, max: 1 } })
    expect((await fetch(`${harness.base}/api/public/v1/health`)).status).toBe(200)
    const limited = await fetch(`${harness.base}/api/public/v1/health`)
    expect(limited.status).toBe(429)
    expect((await limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
  })

  it('generates OpenAPI from the live route table', () => {
    const ctx = new Context()
    new AdminKernel(ctx, { essential: [] })
    const api = new AdminApi(ctx, {})
    api.register({ audience: 'admin', method: 'GET', path: '/users/:id', summary: 'Read one user', handler: () => ({}) })
    const document = api.openapi() as {
      openapi: string
      paths: Record<string, Record<string, { summary: string; 'x-admin-permission'?: string }>>
    }
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths['/api/admin/v1/users/:id']?.get?.summary).toBe('Read one user')
  })
})
