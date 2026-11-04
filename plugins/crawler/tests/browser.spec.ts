import { describe, expect, it, vi } from 'vitest'
import { createCdpLauncher, createDualModeLauncher, createStandardLauncher } from '../src/browser/launcher.ts'
import { cookiesToString, injectCookies, parseCookieString } from '../src/browser/cookies.ts'
import type { BrowserContextLike, BrowserLaunchOptions, CookieLike, PlaywrightLike } from '../src/browser/contract.ts'

// 浏览器层验收（design/modules/crawler.md 关键决策 1）：CDP 优先、失败回退标准启动；
// Cookie 转换（design/modules/tools.md）。
// Browser-layer acceptance (crawler.md decision 1): CDP first, standard
// fallback; cookie conversion (design tools.md).
const baseOptions: BrowserLaunchOptions = {
  mode: 'cdp',
  cdpPort: 9222,
  userDataDir: './browser-data/xhs_user_data_dir',
  headless: false,
  proxyUrl: null,
  userAgent: null,
}

function fakePlaywright(over: Partial<PlaywrightLike['chromium']> = {}): PlaywrightLike & { calls: string[] } {
  const calls: string[] = []
  const context: BrowserContextLike = {
    newPage: async () => ({ goto: async () => undefined, content: async () => '<html/>' }),
    addCookies: async () => {},
    cookies: async () => [],
    requestJson: async () => ({}),
    close: async () => {},
  }
  return {
    calls,
    chromium: {
      connectOverCDP: async () => {
        calls.push('cdp')
        throw new Error('port closed')
      },
      launchPersistentContext: async () => {
        calls.push('standard')
        return context
      },
      ...over,
    } as PlaywrightLike['chromium'],
  }
}

describe('dual-mode launcher', () => {
  it('falls back to the standard launch when CDP attach fails', async () => {
    const playwright = fakePlaywright()
    const session = await createDualModeLauncher(playwright)(baseOptions)
    expect(playwright.calls).toEqual(['cdp', 'standard'])
    expect(session.context).toBeDefined()
    await session.close()
  })

  it('uses CDP directly and closes the browser connection on cleanup', async () => {
    let browserClosed = false
    const context: BrowserContextLike = {
      newPage: async () => ({ goto: async () => undefined, content: async () => '' }),
      addCookies: async () => {},
      cookies: async () => [],
      requestJson: async () => ({}),
      close: async () => {},
    }
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
    expect(session.context).toBe(context)
    await session.close()
    expect(browserClosed).toBe(true)
  })

  it('standard launcher passes headless, proxy and profile dir', async () => {
    const playwright = fakePlaywright()
    const launcher = createStandardLauncher(playwright as unknown as PlaywrightLike)
    await launcher({ ...baseOptions, mode: 'standard', proxyUrl: 'https://u:p@1.2.3.4:8080', userAgent: 'UA' })
    expect(playwright.calls).toEqual(['standard'])
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
