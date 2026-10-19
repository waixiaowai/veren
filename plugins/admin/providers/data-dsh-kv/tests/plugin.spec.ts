/**
 * Plugin wiring: loud config failure, capability registration through the
 * kernel, and disposal closing the domain and unregistering the provider.
 *
 * 插件接线：配置错误显式失败、经内核注册能力，以及卸载时关闭 domain 并注销 provider。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AdminKernel } from '@veren/admin-kernel'
import { createKvDatabase } from '../src/adapter.ts'
import { ADMIN_DATA_DOMAIN_NAME } from '../src/domain.ts'
import { Config, MANIFEST, apply, inject, name, registerDataProvider } from '../src/plugin.ts'
import { FakeDomain } from './fake-domain.ts'

/** One booted root context with its kernel and fake domain. 一个已装好的根上下文及其内核与假 domain。 */
interface Booted {
  readonly ctx: Context
  readonly kernel: AdminKernel
  readonly domain: FakeDomain
}

/** Publish a Host-service double the plugin only reads narrowly. 发布插件只窄读的宿主服务替身。 */
function provide(ctx: Context, service: string, value: object): void {
  ctx.provide(service, value)
}

/**
 * Mount the kernel plus the storage services this plugin reads on one fresh
 * root context.
 *
 * 在全新根上下文上挂载内核与该插件读取的存储服务。
 */
function boot(backends: readonly string[] = ['json']): Booted {
  const ctx = new Context()
  const kernel = new AdminKernel(ctx, { essential: [] })
  const domain = new FakeDomain()
  provide(ctx, 'storage', {
    backend: {
      get: (backend: string) => {
        if (!backends.includes(backend)) throw new Error(`no backend '${backend}'`)
        return { name: backend }
      },
      names: () => [...backends],
    },
  })
  provide(ctx, 'storageDomain', {
    open: async () => domain,
    get: () => undefined,
    closeAll: async () => {},
  })
  return { ctx, kernel, domain }
}

describe('plugin declaration', () => {
  it('declares the data capability over the admin_data domain', () => {
    expect(name).toBe('admin-data-dsh-kv')
    expect([...inject]).toEqual(['admin', 'storage', 'storageDomain'])
    expect(MANIFEST).toMatchObject({
      id: 'dsh-kv',
      capability: 'data',
      contract: '^1.0',
      priority: 0,
      dataDomain: ADMIN_DATA_DOMAIN_NAME,
    })
  })

  it('defaults the storage intent to the json backend with no routes', () => {
    expect(Config({}).storage).toEqual({ backend: 'json', routes: {} })
  })
})

describe('plugin registration', () => {
  it('serves records through the kernel façade after apply', async () => {
    const { ctx, kernel } = boot()
    expect(kernel.has('data')).toBe(false)

    await apply(ctx, { storage: { backend: 'json' } })

    expect(kernel.has('data')).toBe(true)
    expect(ctx.adminData.features.transactions).toBe(false)

    const notes = ctx.adminData.table<{ readonly id: string, readonly text: string }>('notes')
    await notes.save({ id: 'n1', text: 'ok' })
    expect(notes.find('n1')).toMatchObject({ text: 'ok' })
    await expect(kernel.refreshHealth()).resolves.toMatchObject({ backends: [{ name: 'data', health: { status: 'ok' } }] })

    await ctx.fiber.dispose()
  })

  it('closes the domain and drops the registration on dispose', async () => {
    const { ctx, kernel, domain } = boot()
    await apply(ctx, { storage: { backend: 'json' } })
    expect(kernel.has('data')).toBe(true)

    await ctx.fiber.dispose()

    expect(domain.closes).toBe(1)
    expect(kernel.has('data')).toBe(false)
  })

  it('mounts as a loader-shaped plugin and unloads with its fiber', async () => {
    const { ctx, kernel, domain } = boot()

    const fiber = ctx.plugin({ name, inject: [...inject], Config, apply }, { storage: { backend: 'json' } })
    await fiber
    expect(kernel.has('data')).toBe(true)

    await fiber.dispose()

    expect(kernel.has('data')).toBe(false)
    expect(domain.closes).toBe(1)
    await ctx.fiber.dispose()
  })

  it('removes the registration through the returned disposer', () => {
    const { ctx, kernel, domain } = boot()
    const dispose = registerDataProvider(ctx, createKvDatabase({ domain }))
    expect(kernel.has('data')).toBe(true)

    dispose()

    expect(kernel.has('data')).toBe(false)
  })

  it('fails loud naming an unregistered backend and the registered names', async () => {
    const { ctx, kernel, domain } = boot(['json'])

    const failure = await apply(ctx, { storage: { backend: 'sqlite' } }).catch((reason: unknown) => reason)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("'sqlite'")
    expect((failure as Error).message).toContain('registered: json')
    expect(domain.closes).toBe(0)
    expect(kernel.has('data')).toBe(false)
  })

  it('fails loud on an unregistered route target', async () => {
    const { ctx } = boot(['json'])

    await expect(apply(ctx, { storage: { backend: 'json', routes: { admin_data: 'sqlite' } } }))
      .rejects.toThrow(/sqlite/)
  })
})
