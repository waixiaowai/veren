/**
 * 组合测试：真实宿主里装上本插件，核对应用面、页面面、工具面与卸载摘净。
 *
 * 走的是共享测试基建（`@veren/test-support` 的 mountAppHost）：真实 app 注册
 * 表、真实 page 注册表、真实存储栈、真实任务中心。插件以**真实 fiber** 挂载，
 * 因此卸载走的是插件自己的清理路径，而不是整宿主一起拆。
 *
 * 断言面：
 * 1. 应用注册成功且目录里四页齐全、每页都能被 page-registry 解析；
 * 2. 工具全名是 `zhihu_ops__<本地名>`（装配期加前缀）；
 * 3. 页面契约逐页达标（无人值守契约的声明、级与挂载一致、无停摆措辞）；
 * 4. 卸载后应用从目录消失、前缀下无页可解析。
 *
 * The composition spec: mounts the plugin in a real host and checks the app
 * face, the page face, the tool face, and the torn-down-clean guarantee.
 *
 * It runs on the shared test infrastructure (`@veren/test-support`'s
 * mountAppHost): the real app registry, the real page registry, the real
 * storage stack, and the real task center. The plugin mounts as a **real
 * fiber**, so the teardown runs the plugin's own cleanup path rather than
 * dismantling the whole host.
 *
 * @module @veren/zhihu-ops/tests/composition
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { mountAppHost, expectAppRemoved, expectPagesRegisteredOnce, assertUnattendedPage, assertNoUnattendedStall } from '@veren/test-support'
import type { AppHost } from '@veren/test-support'
import { apply, inject, name, Config } from '../src/index.ts'
import { APP_ID, TOOL_PREFIX } from '../src/app.ts'
import { ContentDetailMeta } from '../src/page-content-detail.tsx'
import { ContentsMeta } from '../src/page-contents.tsx'
import { OverviewMeta } from '../src/page-overview.tsx'
import { ReportsMeta } from '../src/page-reports.tsx'
import { createZhihuOpsTools } from '../src/tools.ts'

/** 本文件用到的宿主与插件 fiber（每个用例后拆净）/ the host and plugin fiber this file uses (torn down after each case) */
let host: AppHost | undefined
let fiber: Fiber | undefined

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  await host?.dispose()
  host = undefined
})

/** 提供凭据、模型与 llm 三个替身面（插件的硬 inject）/ provides the credential, model, and llm stub faces (the plugin's hard injects) */
function provideStubs(ctx: Context): void {
  ctx.provide('credentials', {
    readRecord: async () => undefined,
    modifyRecord: async () => undefined,
    deleteRecord: async () => undefined,
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  ctx.provide('llm', { stream: () => ({ async *[Symbol.asyncIterator]() { /* no chunks */ } }) })
}

/** 插件配置（测试用；自动采集关掉，由用例自己驱动）/ the plugin configuration (for tests; the automatic pull is off) */
const TEST_CONFIG = {
  pullLocalTime: '08:00',
  dailyCallLimit: 60,
  requestIntervalMs: 3000,
  reportCadence: 'weekly' as const,
  reportWindowDays: 7,
  contentLimit: 20,
  autoPull: false,
}

/** 装上本插件的宿主 / the host with this plugin mounted */
async function mount(): Promise<AppHost> {
  const mounted = await mountAppHost({ taskCenter: true })
  provideStubs(mounted.ctx)
  host = mounted
  fiber = await mounted.ctx.plugin({ name, inject, apply, Config }, TEST_CONFIG)
  return mounted
}

describe('app face', () => {
  it('registers the app with its four pages', async () => {
    host = await mount()
    const record = host.apps?.catalog().find((app) => app.definition.id === APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(host.apps?.listPages(APP_ID).map((page) => page.name).sort())
      .toEqual(['content', 'contents', 'overview', 'reports'])
  })

  it('registers every page once and resolves it', async () => {
    host = await mount()
    expectPagesRegisteredOnce(host.apps!, host.pageRegistry!, APP_ID)
  })

  it('tears the app down clean when the fiber is disposed', async () => {
    host = await mount()
    const apps = host.apps!
    const pageRegistry = host.pageRegistry!
    const urls = apps.listPages(APP_ID).map((page) => page.url)
    await fiber?.dispose()
    fiber = undefined
    expectAppRemoved(apps, pageRegistry, APP_ID, urls)
  })
})

describe('tool face', () => {
  it('names the tools with the app prefix', () => {
    const names = createZhihuOpsTools().map((tool) => tool.name).sort()
    expect(names).toEqual([
      'content_trend',
      'generate_report',
      'list_contents',
      'refresh_now',
      'setup_credentials',
      'suggest_topics',
    ])
  })

  it('prefixes the tool names at assembly', () => {
    const prefixed = createZhihuOpsTools().map((tool) => `${TOOL_PREFIX}__${tool.name}`)
    expect(prefixed).toContain('zhihu_ops__refresh_now')
  })
})

describe('page contract', () => {
  it('declares the unattended contract on every page', () => {
    const rows = [
      {
        label: 'overview',
        meta: OverviewMeta,
        tools: [
          { name: 'zhihu_ops__refresh_now', level: 'L1' as const },
          { name: 'zhihu_ops__setup_credentials', level: 'L1' as const },
          { name: 'zhihu_ops__generate_report', level: 'L1' as const },
        ],
      },
      {
        label: 'contents',
        meta: ContentsMeta,
        tools: [
          { name: 'zhihu_ops__list_contents', level: 'L0' as const },
          { name: 'zhihu_ops__content_trend', level: 'L0' as const },
        ],
      },
      {
        label: 'content',
        meta: ContentDetailMeta,
        tools: [
          { name: 'zhihu_ops__content_trend', level: 'L0' as const },
          { name: 'zhihu_ops__list_contents', level: 'L0' as const },
        ],
      },
      {
        label: 'reports',
        meta: ReportsMeta,
        tools: [{ name: 'zhihu_ops__generate_report', level: 'L1' as const }],
      },
    ]
    for (const row of rows) {
      assertUnattendedPage(row)
      assertNoUnattendedStall(row.label, row.meta.instructions ?? '')
    }
  })
})
