/**
 * Shared harness for the gateway specs: fake auth/access/audit providers on a
 * real AdminKernel, the three probe routes, and one real HTTP server per
 * harness instance.
 *
 * 网关用例的共享夹具：真实 AdminKernel 上的伪 auth/access/audit provider、三条探测
 * 路由，以及每份夹具一个真实 HTTP 服务器。
 */

import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
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
export const OWNER: AdminUserView = {
  id: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  active: true,
  roles: ['owner'],
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** One running test gateway. 一个运行中的测试网关。 */
export interface Harness {
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
export async function createHarness(config: Config = {}): Promise<Harness> {
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
    rolesOf: async () => [],
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
  api.register({
    audience: 'admin',
    method: 'GET',
    path: '/search',
    permission: 'admin.users.read',
    summary: 'Search with a required query parameter',
    query: {
      parse: (value) => {
        const query = value as { q?: unknown }
        if (typeof query?.q !== 'string' || query.q.length === 0) throw new Error('q is required')
        return query
      },
    } satisfies AdminSchema,
    handler: ({ request }) => ({ q: request.query.get('q') }),
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
