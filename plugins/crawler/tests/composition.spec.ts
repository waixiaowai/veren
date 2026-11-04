import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply, name } from '../src/index.ts'
import { Config } from '../src/config.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

/**
 * 组合验收：真实 cordis 上下文 + 真实 ToolRuntime + 可覆写的宿主服务替身
 * （webServer/storageDomain），注册面与注销器语义真实。
 * Composition acceptance: a real cordis context plus the real ToolRuntime
 * with overridable host services (webServer/storageDomain), so the
 * registration and disposer semantics are real.
 */

/** 可覆写的宿主服务替身 / overridable host service doubles */
function fakeHostServices(domain: CrawlerStore | undefined) {
  const routes: Array<{ kind: string; path: string; handler?: unknown }> = []
  const upgrades: Array<{ path: string }> = []
  return {
    routes,
    upgrades,
    webServer: {
      register: (route: { kind: string; path: string; handler?: unknown }) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      registerUpgrade: (route: { path: string }) => {
        upgrades.push(route)
        return () => {
          const index = upgrades.indexOf(route)
          if (index >= 0) upgrades.splice(index, 1)
        }
      },
    },
    storageDomain: {
      get: (_name: string) => undefined,
      open: async () => domain,
    },
  }
}

interface RegisteredUpgrade {
  path: string
  handler?: unknown
}

/** 构造带全部宿主服务的 cordis 上下文 / builds a cordis ctx with all host services */
function testContext(domain: CrawlerStore | undefined) {
  const ctx = new Context()
  const disposer = () => () => {}
  ;(ctx as unknown as Record<string, unknown>).systemPrompt = {
    tools: () => disposer(),
    section: () => disposer(),
  }
  const host = fakeHostServices(domain)
  ;(ctx as unknown as Record<string, unknown>).webServer = host.webServer
  ;(ctx as unknown as Record<string, unknown>).storageDomain = host.storageDomain
  ;(ctx as unknown as Record<string, unknown>).apps = {
    register: () => disposer,
    pages: (_id: string, pageCtx: Context) => ({
      register: (_page: unknown, _meta: unknown) => pageCtx.effect(() => () => {}, 'test:page'),
    }),
  }
  new ToolRuntime(ctx)
  return { ctx, routes: host.routes, upgrades: host.upgrades }
}

const config: Config = {
  enableIpProxy: false,
  crawlerMaxNotesCount: 5,
  maxCommentsCountSingleNotes: 3,
  maxConcurrencyNum: 1,
  platform: 'tieba',
  crawlerType: 'search',
  loginType: 'cookie',
  browserDataRoot: './browser-data-test',
  browserChannel: 'chrome' as const,
  mediaRoot: './media-test',
}

describe('crawler composition on real cordis ctx', () => {
  it('registers six tools after apply', async () => {
    const { ctx } = testContext(undefined)
    await apply(ctx, config)
    const names = ctx.tools.schemas().map((schema: { name: string }) => schema.name)
    for (const tool of ['start', 'stop', 'status', 'logs', 'data', 'wordcloud']) {
      expect(names).toContain(`crawler__${tool}`)
    }
  })

  it('plugin name is stable for Loader registration', () => {
    expect(name).toBe('veren-crawler')
  })
})
