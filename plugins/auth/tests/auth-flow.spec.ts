/**
 * The assembled auth kit's closed loop through the plugin's own assembly
 * path: sign-up → sign-in → get-session → sign-out, the embedded api face,
 * the rate limiter, and the admin bootstrap. These cover the plugin-level
 * integration the framework tests cannot see (cookie naming, strict
 * same-site policy, embedded admin seeding).
 * 经插件自身装配路径的认证闭环：注册 → 登录 → 读会话 → 登出、内嵌 api 面、
 * 限流器与管理员引导。这些覆盖框架测试看不到的插件级集成（Cookie 命名、
 * Strict 同站策略、内嵌管理员播种）。
 *
 * @module tests/auth-flow
 */

import { describe, expect, it } from 'vitest'
import { DataSource } from '@veren/orm'
import '@veren/orm/driver/sqlite'
import { createAuthEntities, createOrmAdapter, getAuthTables } from '@veren/auth-core'
import { bootstrapAdmin, buildAuthKit } from '../src/auth-kit.js'

const ORIGIN = 'http://127.0.0.1:3080'

/** Build the plugin's auth kit over an isolated in-memory database. 在独立内存库上构建插件的 auth kit。 */
async function makeAuth(): Promise<Awaited<ReturnType<typeof buildAuthKit>>> {
  const tables = getAuthTables({ rateLimitStorage: 'memory' })
  const dataSource = new DataSource({ type: 'sqlite', entities: createAuthEntities(tables), synchronize: true })
  await dataSource.initialize()
  return buildAuthKit({
    dataSource,
    secret: 'plugin-test-secret-0123456789abcdef0123456789abcdef',
    origin: ORIGIN,
    secure: false,
    expiresInDays: 7,
  })
}

/** POST through the framework handler with a trusted origin. 带受信 origin 穿过框架处理器 POST。 */
function post(auth: Awaited<ReturnType<typeof buildAuthKit>>, path: string, body: unknown): Promise<Response> {
  return auth.handler(new Request(`${ORIGIN}/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  }))
}

describe('plugin auth kit closed loop | 插件 auth kit 闭环', () => {
  it('sign-up → get-session → sign-out with the dsh-login cookie namespace', async () => {
    const auth = await makeAuth()
    const signUp = await post(auth, '/sign-up/email', { name: 'Admin', email: 'admin@example.com', password: 'correct-horse-1' })
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers.getSetCookie().find(entry => entry.startsWith('dsh-login.session_token='))
    expect(cookie).toBeDefined()
    // Strict 同站策略随装配就位。
    // The Strict same-site policy ships with the assembly.
    expect(cookie).toContain('SameSite=Strict')

    const read = await auth.handler(new Request(`${ORIGIN}/auth/get-session`, {
      headers: { cookie: `dsh-login.session_token=${cookie!.split('=')[1]!.split(';')[0]!}` },
    }))
    const session = await read.json() as { user: { email: string } } | null
    expect(session?.user.email).toBe('admin@example.com')

    const out = await auth.handler(new Request(`${ORIGIN}/auth/sign-out`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: `dsh-login.session_token=${cookie!.split('=')[1]!.split(';')[0]!}` },
    }))
    expect(out.status).toBe(200)
    const gone = await auth.handler(new Request(`${ORIGIN}/auth/get-session`, {
      headers: { cookie: `dsh-login.session_token=${cookie!.split('=')[1]!.split(';')[0]!}` },
    }))
    expect(await gone.json()).toBeNull()
  })

  it('the embedded api face bootstraps the admin exactly once', async () => {
    const auth = await makeAuth()
    await bootstrapAdmin(auth, { email: 'root@example.com', password: 'first-boot-pw-1', name: 'Root' })
    await bootstrapAdmin(auth, { email: 'root@example.com', password: 'different-pw-22', name: 'Root' })
    const signIn = await post(auth, '/sign-in/email', { email: 'root@example.com', password: 'first-boot-pw-1' })
    // 第二次播种不生效：首次口令仍可登录。
    // The second seeding was a no-op: the first password still signs in.
    expect(signIn.status).toBe(200)
  })

  it('the rate limiter engages with the plugin defaults', async () => {
    const tables = getAuthTables({ rateLimitStorage: 'memory' })
    const dataSource = new DataSource({ type: 'sqlite', entities: createAuthEntities(tables), synchronize: true })
    await dataSource.initialize()
    const auth = await buildAuthKit({
      dataSource,
      secret: 'plugin-test-secret-0123456789abcdef0123456789abcdef',
      origin: ORIGIN,
      secure: false,
      expiresInDays: 7,
      rateLimit: { window: 60, max: 2 },
    })
    // 特殊路径（/sign-in*）按框架专属规则 10s/3 限流，插件配置只调兜底规则。
    // Special paths (/sign-in*) follow the framework rule 10s/3; the plugin
    // config tunes only the fallback rule.
    for (let index = 0; index < 3; index++) {
      await post(auth, '/sign-in/email', { email: 'nobody@example.com', password: 'whatever-pw' })
    }
    const fourth = await post(auth, '/sign-in/email', { email: 'nobody@example.com', password: 'whatever-pw' })
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('x-retry-after')).toBe('10')

    // 兜底路径（/get-session POST）跟随插件配置 60s/2。
    // The fallback path (/get-session POST) follows the plugin config 60s/2.
    for (let index = 0; index < 2; index++) {
      await post(auth, '/get-session', {})
    }
    const third = await post(auth, '/get-session', {})
    expect(third.status).toBe(429)
    expect(third.headers.get('x-retry-after')).toBe('60')
  })
})
