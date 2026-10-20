/**
 * Storage-domain behavior of the WeChat provider over the real JSON backend.
 *
 * These specs mount the same storage stack a booting Harness uses, so the domain
 * name, schemas, reopen path, and context-token pruning are exercised for real —
 * not only through the in-memory seam used by the provider specs.
 *
 * 微信 provider 在真实 JSON 后端上的存储域行为。这些用例挂载与启动中的 Harness 相同的
 * 存储栈，因此域名称、schema、重开路径与 context_token 裁剪都走真实实现，而不只是 provider
 * 用例里的内存缝隙。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { WechatProvider } from '../src/provider.ts'
import {
  WECHAT_CONTEXT_LIMIT, WECHAT_DOMAIN_NAME, openWechatStore, wechatDomain,
} from '../src/state.ts'
import type { WechatState } from '../src/state.ts'
import {
  MemorySecrets, hangUntilAbort, jsonResponse, mockFetch,
} from './support.ts'

const roots: string[] = []
const qrImages: string[] = []

afterEach(async () => {
  for (const path of qrImages.splice(0)) await rm(path, { force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'im-wechat-storage-'))
  roots.push(root)
  return root
}

/** Mount the real storage stack on one fresh root. */
async function boot(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

/** One representative stored account. */
function account(overrides: Partial<WechatState> = {}): WechatState {
  return {
    accountId: 'acc-1',
    displayName: 'Test Account',
    ownerId: 'owner-1',
    baseUrl: 'https://ilinkai.weixin.qq.com/',
    cursor: 'cursor-1',
    seen: ['m1', 'm2'],
    ...overrides,
  }
}

describe('WeChat storage domain', () => {
  it('persists account state and context tokens across a reopen', async () => {
    const ctx = await boot(tempRoot())
    const store = await openWechatStore(ctx)
    await store.putState(account())
    await store.putContextToken('acc-1', 'user-1', 'ctx-1', 1)

    expect(store.states()).toEqual([account()])
    expect(store.contextToken('acc-1', 'user-1')).toBe('ctx-1')

    await store.close()
    expect(ctx.storageDomain.get(WECHAT_DOMAIN_NAME)).toBeUndefined()

    const reopened = await openWechatStore(ctx)
    expect(reopened.states()).toEqual([account()])
    expect(reopened.contextToken('acc-1', 'user-1')).toBe('ctx-1')

    await reopened.deleteState('acc-1')
    expect(reopened.states()).toEqual([])
    expect(reopened.contextToken('acc-1', 'user-1')).toBeUndefined()
    await reopened.close()
    await ctx.fiber.dispose()
  })

  it('takes over a domain left open by a previous activation', async () => {
    const ctx = await boot(tempRoot())
    const leftover = await ctx.storageDomain.open(wechatDomain)

    const store = await openWechatStore(ctx)

    expect(ctx.storageDomain.get(WECHAT_DOMAIN_NAME)).not.toBe(leftover)
    await store.putState(account())
    expect(store.states()).toHaveLength(1)
    await store.close()
    await ctx.fiber.dispose()
  })

  it('caps the per-account context-token cache and prunes the oldest entry', async () => {
    const ctx = await boot(tempRoot())
    const store = await openWechatStore(ctx)
    for (let index = 0; index <= WECHAT_CONTEXT_LIMIT; index += 1) {
      await store.putContextToken('acc-1', `user-${index}`, `ctx-${index}`, index)
    }

    expect(store.contextToken('acc-1', 'user-0')).toBeUndefined()
    expect(store.contextToken('acc-1', `user-${WECHAT_CONTEXT_LIMIT}`))
      .toBe(`ctx-${WECHAT_CONTEXT_LIMIT}`)
    await store.close()
    await ctx.fiber.dispose()
  })

  it('binds an account end-to-end and leaves its state in the domain', async () => {
    const ctx = await boot(tempRoot())
    const store = await openWechatStore(ctx)
    const provider = new WechatProvider({
      store,
      secrets: new MemorySecrets(),
      fetchImpl: mockFetch((url, init) => {
        if (url.pathname.endsWith('/get_bot_qrcode')) {
          return jsonResponse({ qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
        }
        if (url.pathname.endsWith('/get_qrcode_status')) {
          return jsonResponse({
            status: 'confirmed',
            bot_token: 'token-1',
            ilink_bot_id: 'acc-1',
            ilink_user_id: 'owner-1',
            baseurl: 'https://ilinkai.weixin.qq.com/',
          })
        }
        if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
        if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
        if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
        return jsonResponse({})
      }),
      longPollTimeoutMs: 20,
      pollIntervalMs: 5,
      logger: ctx.logger,
    })

    const attempt = await provider.bind({ method: 'qrcode', label: 'Domain Account' })
    const imagePath = attempt.challenge?.imagePath
    expect(imagePath).toBeTruthy()
    if (imagePath !== undefined) qrImages.push(imagePath)
    await expect(attempt.wait()).resolves.toMatchObject({ id: 'acc-1' })
    expect(store.states()).toMatchObject([{
      accountId: 'acc-1',
      displayName: 'Domain Account',
      ownerId: 'owner-1',
      cursor: '',
      seen: [],
    }])

    await provider.stop()
    await store.close()
    await ctx.fiber.dispose()
  })
})
