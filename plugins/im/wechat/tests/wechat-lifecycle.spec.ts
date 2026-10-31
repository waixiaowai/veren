import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanQrImages, hangUntilAbort, jsonResponse, seedAccount, seedContext, setupProvider,
} from './support.ts'

afterEach(async () => {
  await cleanQrImages()
})

describe('WeChat lifecycle', () => {
  it('fails start with a structured error when the storage domain is unavailable', async () => {
    const { provider, store } = await setupProvider((url) => {
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({ ret: 0 })
    })
    store.break('domain im_wechat is closed')
    await expect(provider.start()).rejects.toMatchObject({
      code: 'IM_INTERNAL',
      message: expect.stringContaining('domain im_wechat is closed'),
    })
  })

  it('does not start monitors when stop lands during start', async () => {
    let updates = 0
    const { provider, store, secrets } = await setupProvider((url) => {
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) updates += 1
      return jsonResponse({ ret: 0 })
    })
    await seedAccount(store, secrets)
    const starting = provider.start()
    await provider.stop()
    await starting
    expect(await provider.accounts()).toHaveLength(0)
    // Give any leaked monitor a chance to poll; it must never have started.
    // 给可能泄漏的 monitor 一次轮询机会；它绝不应启动过。
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(updates).toBe(0)
  })

  it('removes one account: monitor stopped, state and contexts deleted, others kept', async () => {
    const { provider, store, secrets } = await setupProvider((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await seedContext(store, 'acc-1', 'user-1', 'ctx-1')
    await store.putState({
      accountId: 'acc-2',
      displayName: 'Second',
      ownerId: 'owner-2',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      cursor: '',
      seen: [],
    })
    await secrets.write('acc-2', { token: 'token-2' })
    await provider.start()
    expect((await provider.accounts()).map(account => account.id)).toEqual(['acc-1', 'acc-2'])

    await provider.removeAccount('acc-1')

    expect((await provider.accounts()).map(account => account.id)).toEqual(['acc-2'])
    expect(store.statesById.has('acc-1')).toBe(false)
    expect(store.contextToken('acc-1', 'user-1')).toBeUndefined()
    expect(store.statesById.get('acc-2')).toMatchObject({ accountId: 'acc-2' })
    await provider.stop()
  })
})

describe('real account', () => {
  const enabled = process.env.IM_WECHAT_REAL === '1'
  it.skipIf(!enabled)('runs only when IM_WECHAT_REAL=1', () => {
    expect(enabled).toBe(true)
  })
})
