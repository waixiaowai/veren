/**
 * Profiles without the Web session controller.
 *
 * A profile shaped like the headless, ACP, and SDK bundles: the core agent
 * registry is mounted, the Web application's session controller is not. This is
 * the shape that left the plugin permanently pending before the runtime learned
 * to drive Sessions through `ctx.agents`.
 *
 * 没有 Web session controller 的 profile。形如 headless、ACP、SDK 组合的 profile：只挂
 * 核心 agent 注册表，不挂 Web 应用的 session controller。在运行时学会经 `ctx.agents`
 * 驱动会话之前，正是这种形态让本插件永远 pending。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import StartupAutostartService from '../src/index.ts'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { cleanupTempRoots, item, provideStub, seed, settleEvery, tempRoot } from './harness.ts'

afterEach(cleanupTempRoots)

/** The core-registry calls one controller-less boot recorded. */
interface CoreCalls {
  readonly created: Record<string, unknown>[]
  readonly resumed: Record<string, unknown>[]
  readonly followup: { readonly sessionId: string; readonly text: string }[]
  readonly inject: { readonly sessionId: string; readonly text: string }[]
  setups: number
}

/** A fake Agent recording the inbox operations the runtime performs on it. */
function coreAgent(sessionId: string, calls: CoreCalls): Record<string, unknown> {
  return {
    session: { id: sessionId },
    followup: (message: { content: readonly { text: string }[] }) => {
      calls.followup.push({ sessionId, text: message.content[0]?.text ?? '' })
    },
    inject: (message: { content: readonly { text: string }[] }) => {
      calls.inject.push({ sessionId, text: message.content[0]?.text ?? '' })
    },
  }
}

/** Mount the plugin over a controller-less profile. */
async function bootCoreOnly(options: {
  readonly root: string
  readonly defaultModel?: boolean
  /** How many rows must be stamped before the boot returns. 返回前必须盖章的行数。 */
  readonly expected?: number
}): Promise<{ ctx: Context; calls: CoreCalls }> {
  const ctx = new Context()
  const calls: CoreCalls = { created: [], resumed: [], followup: [], inject: [], setups: 0 }
  provideStub(ctx, 'agents', {
    withoutInitiator: <T>(work: () => T): T => work(),
    get: () => undefined,
    async create(createOptions: Record<string, unknown>) {
      calls.created.push(createOptions)
      const setup = createOptions.setup
      if (typeof setup === 'function') {
        calls.setups += 1
        ;(setup as (agentCtx: Context) => void)(new Context())
      }
      return { agent: coreAgent(String(createOptions.sessionId), calls), dispose: async () => {} }
    },
    async resume(resumeOptions: Record<string, unknown>) {
      calls.resumed.push(resumeOptions)
      const setup = resumeOptions.setup
      if (typeof setup === 'function') {
        calls.setups += 1
        ;(setup as (agentCtx: Context) => void)(new Context())
      }
      return { agent: coreAgent(String(resumeOptions.resumeSessionId), calls), dispose: async () => {} }
    },
  })
  provideStub(ctx, 'sessions', { flush: async () => true })
  if (options.defaultModel !== false) {
    provideStub(ctx, 'agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    })
  }
  // Awaited in order for the same reason as `boot`: the service injects
  // `storageDomain`, so an unresolved domain plugin leaves the service pending.
  // 与 `boot` 同理按序 await：服务注入 `storageDomain`，domain 插件未就绪时服务会一直
  // pending。
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: options.root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(StartupAutostartService)
  // All four enabled items commit a run stamp, so waiting for four means the
  // whole drive finished rather than partially ran.
  // 四个启用项都会写运行戳记，因此等四个表示整轮驱动跑完，而不是跑了一半。
  await settleEvery(ctx, options.expected ?? 1)
  return { ctx, calls }
}

describe('profiles without the Web session controller', () => {
  it('creates, wakens, and quietly queues through the core registry', async () => {
    const root = tempRoot()
    seed(root, [
      item({ id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl', message: 'go' }),
      item({ id: 'startup-queue', name: 'queue', action: 'queue_message', sessionId: 'session-q', message: 'later' }),
      item({ id: 'startup-resume', name: 'resume', action: 'resume_session', sessionId: 'session-r' }),
      item({ id: 'startup-wake', name: 'wake', action: 'message_session', sessionId: 'session-w', message: 'wake up' }),
    ])
    const { ctx, calls } = await bootCoreOnly({ root, expected: 4 })

    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]?.meta).toEqual({ cwd: 'C:/hl' })
    expect(String(calls.created[0]?.sessionId)).toMatch(/^session-/)
    expect(calls.created[0]?.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    // The deployment default is installed on every Agent this runtime mints or adopts.
    expect(calls.setups).toBe(4)
    // Items run in id order, which is what the catalog orders equal-instant rows by.
    expect(calls.resumed.map(call => call.resumeSessionId)).toEqual(['session-q', 'session-r', 'session-w'])
    expect(calls.followup.map(call => call.sessionId)).toEqual([calls.created[0]?.sessionId, 'session-w'])
    expect(calls.inject).toHaveLength(1)
    expect(calls.inject[0]?.sessionId).toBe('session-q')

    const stored = await ctx.startupAutostart.catalog()
    expect(stored.map(entry => entry.lastOutcome?.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    await ctx.fiber.dispose()
  })

  it('uses the item model over the deployment default and survives a profile with neither', async () => {
    const root = tempRoot()
    seed(root, [item({
      id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl',
      model: { provider: 'deepseek-official', model: 'deepseek-pro', reasoningEffort: 'high' },
    })])
    const { ctx, calls } = await bootCoreOnly({ root })
    expect(calls.created[0]?.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-pro' })
    await ctx.fiber.dispose()

    const bare = tempRoot()
    seed(bare, [item({ id: 'startup-new', name: 'new', action: 'new_session', cwd: 'C:/hl' })])
    const second = await bootCoreOnly({ root: bare, defaultModel: false })
    expect(second.calls.created[0]?.agentOptions).toBeUndefined()
    expect(second.calls.created[0]?.setup).toBeUndefined()
    expect((await second.ctx.startupAutostart.catalog())[0]?.lastOutcome?.status).toBe('ok')
    await second.ctx.fiber.dispose()
  })

  it('refuses a preset or workspace target instead of quietly creating a plain Session', async () => {
    const root = tempRoot()
    seed(root, [item({ id: 'startup-preset', name: 'preset', action: 'new_session', preset: 'standard' })])
    const { ctx, calls } = await bootCoreOnly({ root })

    const stored = await ctx.startupAutostart.catalog()
    expect(stored[0]?.lastOutcome?.status).toBe('failed')
    expect(stored[0]?.lastOutcome?.detail).toContain('only the Web application mounts the session controller')
    expect(calls.created).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
