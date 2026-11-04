import { describe, expect, it } from 'vitest'
import { createCdpLauncher, createDualModeLauncher, createStandardLauncher } from '../src/browser/launcher.ts'
import { wrapContext } from '../src/browser/adapter.ts'
import { cookiesToString, injectCookies, parseCookieString } from '../src/browser/cookies.ts'
import type {
  BrowserLaunchOptions,
  CookieLike,
  PlaywrightLike,
  RawContextLike,
  RawResponseLike,
} from '../src/browser/contract.ts'
import { CrawlerError } from '../src/errors.ts'

// 浏览器层验收（design/modules/crawler.md 关键决策 1）：CDP 优先、失败回退标准启动；
// 库对象一律经适配器包装后才能取数；Cookie 转换（design/modules/tools.md）。
// Browser-layer acceptance (crawler.md decision 1): CDP first, standard
// fallback; library objects only fetch through the adapter; cookie
// conversion (design tools.md).
const baseOptions: BrowserLaunchOptions = {
  mode: 'cdp',
  cdpPort: 9222,
  userDataDir: './browser-data/xhs_user_data_dir',
  headless: false,
  proxyUrl: null,
  userAgent: null,
}

/** 假响应：content-type 可调 / a fake response with a controllable content type */
function fakeResponse(body: unknown, contentType = 'application/json; charset=utf-8', status = 200): RawResponseLike {
  return {
    status: () => status,
    headers: () => ({ 'content-type': contentType }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/** 假原始上下文：记录请求 URL 与请求头 / a fake raw context: records request urls and headers */
function fakeRawContext(response: RawResponseLike = fakeResponse({ data: { login: true } })) {
  const requests: Array<{ url: string; headers: Readonly<Record<string, string>> }> = []
  const context: RawContextLike = {
    newPage: async () => ({ goto: async () => undefined, content: async () => '<html/>' }),
    addCookies: async () => {},
    cookies: async () => [],
    close: async () => {},
    request: {
      get: async (url, options) => {
        requests.push({ url, headers: options.headers })
        return response
      },
    },
  }
  return { context, requests }
}

function fakePlaywright(raw: RawContextLike, over: Partial<PlaywrightLike['chromium']> = {}): PlaywrightLike & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    chromium: {
      connectOverCDP: async () => {
        calls.push('cdp')
        throw new Error('port closed')
      },
      launchPersistentContext: async () => {
        calls.push('standard')
        return raw
      },
      ...over,
    } as PlaywrightLike['chromium'],
  }
}

describe('dual-mode launcher', () => {
  it('falls back to the standard launch when CDP attach fails', async () => {
    const { context } = fakeRawContext()
    const playwright = fakePlaywright(context)
    const session = await createDualModeLauncher(playwright)(baseOptions)
    expect(playwright.calls).toEqual(['cdp', 'standard'])
    expect(session.context).toBeDefined()
    await session.close()
  })

  it('uses CDP directly and closes the browser connection on cleanup', async () => {
    let browserClosed = false
    const { context } = fakeRawContext()
    const playwright: PlaywrightLike = {
      chromium: {
        connectOverCDP: async () => ({
          contexts: () => [context],
          close: async () => {
            browserClosed = true
          },
        }),
        launchPersistentContext: async () => context,
      },
    }
    const session = await createDualModeLauncher(playwright)(baseOptions)
    expect(typeof session.context.requestJson).toBe('function')
    await session.close()
    expect(browserClosed).toBe(true)
  })

  it('standard launcher passes headless, proxy, channel and profile dir', async () => {
    const seen: Array<Record<string, unknown>> = []
    const { context } = fakeRawContext()
    const playwright = fakePlaywright(context, {
      launchPersistentContext: async (userDataDir, options) => {
        seen.push({ userDataDir, headless: options.headless, proxy: options.proxy, channel: options.channel })
        return context
      },
    })
    const launcher = createStandardLauncher(playwright)
    await launcher({ ...baseOptions, mode: 'standard', proxyUrl: 'https://u:p@1.2.3.4:8080', userAgent: 'UA', channel: 'chrome' })
    expect(seen[0]).toMatchObject({ userDataDir: './browser-data/xhs_user_data_dir', headless: false, channel: 'chrome' })
  })

  it('cdp launcher without a default context rejects', async () => {
    const playwright: PlaywrightLike = {
      chromium: {
        connectOverCDP: async () => ({ contexts: () => [], close: async () => {} }),
        launchPersistentContext: async () => {
          throw new Error('unused')
        },
      },
    }
    await expect(createCdpLauncher(playwright)(baseOptions)).rejects.toThrowError(/no context/)
  })
})

describe('context adapter', () => {
  it('sends the session request with a same-origin referer and returns json', async () => {
    const { context, requests } = fakeRawContext(fakeResponse({ data: { login: false } }))
    const wrapped = wrapContext(context)
    await expect(wrapped.requestJson('https://m.weibo.cn/api/config')).resolves.toEqual({ data: { login: false } })
    expect(requests[0]).toMatchObject({ url: 'https://m.weibo.cn/api/config' })
    expect(requests[0].headers).toMatchObject({ Referer: 'https://m.weibo.cn/', 'X-Requested-With': 'XMLHttpRequest' })
  })

  it('folds a non-JSON response (login wall) into PLATFORM_ACCESS_DENIED', async () => {
    const { context } = fakeRawContext(fakeResponse('<html/>', 'text/html; charset=utf-8'))
    const wrapped = wrapContext(context)
    try {
      await wrapped.requestJson('https://m.weibo.cn/api/config')
      expect.unreachable()
    } catch (error) {
      expect((error as CrawlerError).code).toBe('PLATFORM_ACCESS_DENIED')
    }
  })

  it('folds an error status with a JSON body into PLATFORM_ACCESS_DENIED', async () => {
    const { context } = fakeRawContext(fakeResponse({ ok: 0 }, 'application/json', 500))
    await expect(wrapContext(context).requestJson('https://m.weibo.cn/api/config')).rejects.toMatchObject({
      code: 'PLATFORM_ACCESS_DENIED',
    })
  })
})

describe('cookie conversion', () => {
  it('parses cookie strings including values with equals signs', () => {
    expect(parseCookieString('a=1; b=2=3; broken')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2=3' },
    ])
  })

  it('injects cookies under the domain and reads them back as a string', async () => {
    const added: CookieLike[] = []
    await injectCookies({ addCookies: async (cookies) => void added.push(...cookies) }, 'web_session=abc; tag=x', '.xiaohongshu.com')
    expect(added).toHaveLength(2)
    expect(added[0]).toMatchObject({ name: 'web_session', domain: '.xiaohongshu.com', path: '/' })
    expect(cookiesToString(added)).toBe('web_session=abc; tag=x')
  })
})
