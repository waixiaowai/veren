/**
 * Kernel behavior: version negotiation, provider selection, replacement and the
 * boot gate.
 *
 * 内核行为：版本协商、provider 选择、替换与启动门禁。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AdminError, type AdminAuth, type AdminDatabase, type ProviderManifest } from '@veren/admin-contract'
import { AdminKernel } from '../src/plugin.ts'
import { satisfies } from '../src/range.ts'

/** Build a manifest for one capability. 为某个能力构造清单。 */
function manifest(overrides: Partial<ProviderManifest> & Pick<ProviderManifest, 'id' | 'capability'>): ProviderManifest {
  return {
    contract: '^1.0',
    priority: 0,
    label: overrides.id,
    ...overrides,
  }
}

describe('contract range matching', () => {
  it('admits a caret range within the same major', () => {
    expect(satisfies('1.2.3', '^1.0')).toBe(true)
    expect(satisfies('1.0.0', '^1.2')).toBe(false)
    expect(satisfies('2.0.0', '^1.0')).toBe(false)
  })

  it('admits a tilde range within the same minor', () => {
    expect(satisfies('1.2.9', '~1.2')).toBe(true)
    expect(satisfies('1.3.0', '~1.2')).toBe(false)
  })

  it('admits comparator conjunctions and alternatives', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
    expect(satisfies('3.0.0', '^1.0 || ^3.0')).toBe(true)
  })

  it('admits a wildcard', () => {
    expect(satisfies('9.9.9', '*')).toBe(true)
  })

  it('rejects malformed versions', () => {
    expect(() => satisfies('1.2.3', '^x')).toThrow()
  })
})

describe('AdminKernel registration', () => {
  it('selects the highest priority provider and falls back on disposal', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    const low = { marker: 'low' }
    const high = { marker: 'high' }
    const disposeLow = kernel.register(manifest({ id: 'low', capability: 'access' }), low)
    const disposeHigh = kernel.register(manifest({ id: 'high', capability: 'access', priority: 10 }), high)

    expect(kernel.require('access')).toBe(high)
    disposeHigh()
    expect(kernel.require('access')).toBe(low)
    disposeLow()
    expect(kernel.has('access')).toBe(false)
  })

  it('refuses a provider whose contract excludes this version', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    expect(() => kernel.register(manifest({ id: 'old', capability: 'auth', contract: '^2.0' }), {})).toThrow(AdminError)
  })

  it('refuses a provider that reuses a priority inside one capability', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    kernel.register(manifest({ id: 'a', capability: 'audit' }), {})
    expect(() => kernel.register(manifest({ id: 'b', capability: 'audit' }), {})).toThrow(/priority/)
  })

  it('lists providers highest priority first in the catalog', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    kernel.register(manifest({ id: 'a', capability: 'navigation' }), {})
    kernel.register(manifest({ id: 'b', capability: 'navigation', priority: 5 }), {})
    const state = kernel.catalog().capabilities.find((entry) => entry.capability === 'navigation')
    expect(state?.active?.id).toBe('b')
    expect(state?.providers.map((provider) => provider.id)).toEqual(['b', 'a'])
  })
})

describe('AdminKernel boot gate', () => {
  it('reports every missing essential capability', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    expect(() => kernel.ready()).toThrow(AdminError)
    try {
      kernel.ready()
    } catch (error) {
      expect((error as AdminError).code).toBe('ESSENTIAL_CAPABILITY_MISSING')
      expect((error as AdminError).details?.missing).toEqual(['data', 'auth', 'access', 'navigation', 'audit'])
    }
  })

  it('passes once every essential capability has a provider', () => {
    const kernel = new AdminKernel(new Context(), { essential: [] })
    const empty = {}
    for (const capability of ['data', 'auth', 'access', 'navigation', 'audit'] as const) {
      kernel.register(manifest({ id: `p-${capability}`, capability }), empty)
    }
    expect(() => kernel.ready()).not.toThrow()
  })

  it('fails loudly on an unknown configured essential name', () => {
    expect(() => new AdminKernel(new Context(), { essential: ['taskz'] })).toThrow(/unknown capabilities/)
  })
})

describe('capability façades', () => {
  it('resolves the active provider on every call', async () => {
    const ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    const first: AdminAuth = {
      setupRequired: async () => true,
      setup: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      authenticate: async () => undefined,
      listUsers: async () => [],
      createUser: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
      listTokens: async () => [],
      createToken: vi.fn(),
      revokeToken: vi.fn(),
    }
    const second: AdminAuth = { ...first, setupRequired: async () => false }

    kernel.register(manifest({ id: 'first', capability: 'auth' }), first)
    expect(await ctx.adminAuth.setupRequired()).toBe(true)

    const disposeSecond = kernel.register(manifest({ id: 'second', capability: 'auth', priority: 1 }), second)
    expect(await ctx.adminAuth.setupRequired()).toBe(false)

    disposeSecond()
    expect(await ctx.adminAuth.setupRequired()).toBe(true)
  })

  it('fails loudly when a façade is used without a provider', () => {
    const ctx = new Context()
    new AdminKernel(ctx, { essential: [] })
    expect(() => (ctx.adminAuth as AdminAuth).setupRequired()).toThrow(AdminError)
  })

  it('exposes data features through the data façade', () => {
    const ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    const emptyTable = { find: () => undefined, list: () => [], save: async () => {}, remove: async () => false, size: 0 }
    const database: AdminDatabase = {
      features: { transactions: false, secondaryIndexes: false, fullText: false },
      table: () => emptyTable,
      transaction: async (work) => work({ table: () => emptyTable }),
      health: async () => ({ status: 'ok' }),
    }
    kernel.register(manifest({ id: 'kv', capability: 'data' }), database)
    expect(ctx.adminData.features.transactions).toBe(false)
  })
})
