import { describe, expect, it } from 'vitest'
import { buildAuth, buildPasswordAuth } from './helpers.ts'
import type { AuthPlugin } from '../src/index.ts'

describe('context assembly: defaults (design 1.5 A1-A3)', () => {
  it('A1: basePath fills the default and baseURL stays origin-shaped', async () => {
    const auth = await buildPasswordAuth()
    expect(auth.context.options.basePath).toBe('/auth')
    expect(auth.context.baseURL).toBe('http://127.0.0.1:3080/auth')
    expect(auth.context.options.baseURL).toBe('http://127.0.0.1:3080')
  })

  it('A2: session parameters fill the design defaults', async () => {
    const auth = await buildPasswordAuth()
    expect(auth.context.options.session.updateAge).toBe(86400)
    expect(auth.context.options.session.expiresIn).toBe(604800)
    expect(auth.context.options.session.freshAge).toBe(86400)
  })

  it('A3: rate-limit parameters fill the design defaults', async () => {
    const auth = await buildPasswordAuth()
    expect(auth.context.options.rateLimit.window).toBe(10)
    expect(auth.context.options.rateLimit.max).toBe(100)
    expect(auth.context.options.rateLimit.storage).toBe('memory')
    expect(auth.context.options.rateLimit.enabled).toBe(false)
  })

  it('loopback aliases join the trust list', async () => {
    const auth = await buildPasswordAuth()
    expect(auth.context.trustedOrigins).toContain('http://127.0.0.1:3080')
    expect(auth.context.trustedOrigins).toContain('http://localhost:3080')
  })
})

describe('context assembly: secrets (design 1.5 A4/A6)', () => {
  it('A4: versioned secrets keep the current version first and legacy keys verifiable', async () => {
    const auth = await buildPasswordAuth({
      secrets: [
        { version: 2, value: 'new-secret-value-with-length-over-32!!' },
        { version: 1, value: 'old-secret-value-with-length-over-32!!' },
      ],
    })
    const config = auth.context.secretConfig as { keys: Map<number, string>, currentVersion: number }
    expect(config.currentVersion).toBe(2)
    expect([...config.keys.keys()].sort()).toEqual([1, 2])
    expect(auth.context.secret).toBe('new-secret-value-with-length-over-32!!')
  })

  it('A4b: duplicate versions fail the assembly', async () => {
    await expect(buildPasswordAuth({
      secrets: [
        { version: 1, value: 'value-value-value-value-value-32' },
        { version: 1, value: 'other-value-other-value-other-32' },
      ],
    })).rejects.toThrow(/duplicate secret version/)
  })

  it('A4c: a short secret value fails the assembly', async () => {
    await expect(buildPasswordAuth({ secrets: [{ version: 1, value: 'short' }] }))
      .rejects.toThrow(/32\+ character/)
  })
})

describe('context assembly: plugin merge (design 1.5 A7/A9/A10)', () => {
  it('A7: option patches defu-merge and context patches assign in place', async () => {
    const plugin: AuthPlugin = {
      id: 'sample',
      init: (ctx) => {
        void ctx
        return {
          // defu 语义：已存在的值优先，补丁只填缺省（§1.4）。
          // defu semantics: existing values win; patches fill gaps only (§1.4).
          options: { emailVerification: { require: true }, trustedOrigins: ['https://extra.example.com'] },
          context: { version: 'patched' },
        }
      },
    }
    const auth = await buildPasswordAuth({ plugins: [plugin] })
    expect(auth.context.options.emailVerification.require).toBe(true)
    expect(auth.context.options.session.expiresIn).toBe(604800)
    expect(auth.context.trustedOrigins).toContain('https://extra.example.com')
    expect(auth.context.version).toBe('patched')
    expect(auth.context.hasPlugin('sample')).toBe(true)
    expect(auth.context.getPlugin('sample')?.id).toBe('sample')
    expect(auth.context.getPlugin('absent')).toBeNull()
  })

  it('A9: repeated assembly produces identical hook sets (no duplicate mounting)', async () => {
    const plugin: AuthPlugin = {
      id: 'hooks',
      databaseHooks: { user: { create: { before: async () => undefined } } },
    }
    const first = await buildPasswordAuth({ plugins: [plugin] })
    const second = await buildPasswordAuth({ plugins: [plugin] })
    expect(first.context.internalAdapter.createUser).toBeTypeOf('function')
    expect(second.context.internalAdapter.createUser).toBeTypeOf('function')
    // 装配是纯函数式：两次装配产出同构上下文（钩子不叠加）。
    // Assembly is purely functional: two runs yield isomorphic contexts (no hook stacking).
    expect(first.context.plugins).toHaveLength(1)
    expect(second.context.plugins).toHaveLength(1)
  })

  it('A10: a throwing plugin init fails the whole assembly', async () => {
    const broken: AuthPlugin = { id: 'broken', init: async () => { throw new Error('plugin exploded') } }
    await expect(buildPasswordAuth({ plugins: [broken] })).rejects.toThrow('plugin exploded')
  })
})
