import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanQrImages, hangUntilAbort, jsonResponse, seedAccount, setupProvider, trackQrImage, until,
} from './support.ts'

afterEach(async () => {
  await cleanQrImages()
})

describe('WeChat QR authorization', () => {
  it('writes a local PNG, polls to confirmed, and stores state in the domain without the token', async () => {
    let polls = 0
    let updates = 0
    const { provider, store, secrets } = await setupProvider((url, init) => {
      if (url.pathname.endsWith('/get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
      }
      if (url.pathname.endsWith('/get_qrcode_status')) {
        polls += 1
        return jsonResponse(polls === 1 ? { status: 'wait' } : {
          status: 'confirmed',
          bot_token: 'token-1',
          ilink_bot_id: 'acc-1',
          ilink_user_id: 'owner-1',
          baseurl: 'https://ilinkai.weixin.qq.com/',
        })
      }
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) {
        updates += 1
        return updates === 1
          ? jsonResponse({ ret: 0, msgs: [], get_updates_buf: 'cursor-1' })
          : hangUntilAbort(init)
      }
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({})
    })

    const attempt = await provider.bind({ method: 'qrcode' })
    expect(attempt.status).toBe('pending')
    const imagePath = attempt.challenge?.imagePath
    expect(imagePath).toBeTruthy()
    trackQrImage(imagePath)
    const png = await readFile(imagePath as string)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(attempt.challenge?.url).toBeUndefined()

    const account = await attempt.wait()
    expect(account.id).toBe('acc-1')
    expect(attempt.status).toBe('bound')
    const stored = await secrets.read('acc-1')
    expect(stored?.token).toBe('token-1')

    const state = store.states().find(candidate => candidate.accountId === 'acc-1')
    expect(state?.displayName).toBe('WeChat acc-1')
    expect(JSON.stringify(state)).not.toContain('token-1')
    expect(JSON.stringify(state)).not.toContain('context_token')

    await provider.stop()
  })

  it('drops stale same-owner accounts when a fresh pairing confirms (one live bot per WeChat account)', async () => {
    // 预置同 owner 的旧账号：服务端已作废其 token，但本地行还在
    // / pre-seed a stale same-owner account: the server killed its token, the
    // local row remains
    const { provider, store, secrets } = await setupProvider((url, init) => {
      if (url.pathname.endsWith('/get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-2', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
      }
      if (url.pathname.endsWith('/get_qrcode_status')) {
        return jsonResponse({
          status: 'confirmed',
          bot_token: 'token-2',
          ilink_bot_id: 'acc-2',
          ilink_user_id: 'owner-1',
          baseurl: 'https://ilinkai.weixin.qq.com/',
        })
      }
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({})
    })

    await store.putState({
      accountId: 'stale-bot',
      displayName: 'WeChat stale-bot',
      ownerId: 'owner-1',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      cursor: '',
      seen: [],
    })
    await secrets.write('stale-bot', { token: 'dead-token' })

    const attempt = await provider.bind({ method: 'qrcode' })
    await attempt.wait()

    // 同 owner 旧账号行与凭据一并清除；新账号保留
    // / the stale same-owner row and its credential are gone; the new account stays
    expect(store.states().map(state => state.accountId)).toEqual(['acc-2'])
    expect(await secrets.read('stale-bot')).toBeUndefined()
    expect((await secrets.read('acc-2'))?.token).toBe('token-2')

    await provider.stop()
  })

  it('keeps other waiters settled when one waiter aborts', async () => {
    let confirm = false
    const { provider, store, secrets } = await setupProvider((url, init) => {
      if (url.pathname.endsWith('/get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
      }
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/get_qrcode_status')) {
        return jsonResponse(confirm
          ? {
              status: 'confirmed',
              bot_token: 'token-1',
              ilink_bot_id: 'acc-x',
              ilink_user_id: 'owner-1',
              baseurl: 'https://ilinkai.weixin.qq.com/',
            }
          : { status: 'wait' })
      }
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await provider.start()
    const attempt = await provider.bind({ method: 'qrcode' })
    const imagePath = attempt.challenge?.imagePath
    trackQrImage(imagePath)
    const controller = new AbortController()
    const aborted = attempt.wait(controller.signal)
    const kept = attempt.wait()
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'IM_BIND_EXPIRED' })
    confirm = true
    await until(() => attempt.status === 'bound')
    await expect(kept).resolves.toMatchObject({ id: 'acc-x' })
    await provider.stop()
  })
})
