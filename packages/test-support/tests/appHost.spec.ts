/**
 * Package specs: the test host mounts real registry/task-center plugins, the
 * mirror seam works end to end, degrade toggles stay available, and every
 * mount disposes paired — nothing (not even a temp directory) is left behind.
 *
 * 包级测试：测试宿主挂真实注册表/任务中心插件，镜像面端到端可用，降级开关
 * 在位，且每次装配成对拆除——连临时目录都不留下。
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createElement } from '@veren/prompt-core'
import type { AppId, AppRegistryService, PageKey } from '@veren/app-registry'
import type { PageRegistryService } from '@veren/page-registry'
import type { AppHost } from '../src/index.ts'
import { expectAppRemoved, expectPagesRegisteredOnce, mountAppHost, TempDirs } from '../src/index.ts'

// Brand minting follows the repo idiom (zero runtime cost). 品牌铸造沿用仓库惯例（零运行时开销）。
const MINI_APP_ID = 'mini' as AppId
const MINI_ENTRY = 'main' as PageKey

/** 注册表必须在场，否则显式失败而不是断言 undefined。The registries must be present; fail loudly instead of asserting on undefined. */
function requireRegistries(host: AppHost): { apps: AppRegistryService; pageRegistry: PageRegistryService } {
  if (host.apps === undefined || host.pageRegistry === undefined) {
    throw new Error('registries were not mounted')
  }
  return { apps: host.apps, pageRegistry: host.pageRegistry }
}

/** 注册一个两级一工具的迷你应用（§3.10 合规夹具）/ register a mini app with two levels and one tool (a §3.10-compliant fixture) */
function registerMiniApp(host: AppHost, scope: Context): void {
  const { apps } = requireRegistries(host)
  apps.register({
    id: MINI_APP_ID, name: 'mini', description: '装配验证应用', entry: MINI_ENTRY,
  }, scope)
  const pages = apps.pages(MINI_APP_ID, scope)
  // 工具先于页面进目录（注册路径要求）/ tools enter the catalog before pages (the registration path requires it)
  apps.tools(MINI_APP_ID, scope).define(defineTool({
    name: 'read', description: '读取', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  }))
  // 组件页是唯一形态：PageFC + meta 经 register 现场适配（§3.5 定案，map 由
  // 注册表推导，不再手写）。
  // Component pages are the only shape: a PageFC + meta, adapted on the spot by
  // register (§3.5; the map is registry-derived, never hand-written).
  // 一级页（entry）：无参（§3.10.5 规则 1）/ the home page (entry): parameter-free (§3.10.5 rule 1)
  pages.register(
    () => createElement('h1', { children: 'mini 主页' }),
    { url: '/apps/mini/main', description: '主页', instructions: 'mini 首页。' },
  )
  // 二级页：带 :param + writes + 工具 + 说明（§3.10.5 规则 3）
  // / the detail page: a :param plus writes, a tool and instructions (§3.10.5 rule 3)
  pages.register(
    (props) => createElement('h1', { children: `mini 文档 ${props.docId ?? ''}` }),
    {
      url: '/apps/mini/doc/:docId', description: '文档页',
      tools: ['read'], writes: true, instructions: '只处理 params.docId 指定的这一篇文档。',
    },
  )
}

describe('mountAppHost 装配与清理', () => {
  it('registries 开启：两服务在场，镜像面单入口注册端到端可用，fiber 销毁后摘净', async () => {
    const host = await mountAppHost()
    // 应用挂在自己的插件 fiber 上，销毁即整应用摘除（与真实生命周期同路径）。
    // The app lives on its own plugin fiber; disposing it removes the whole
    // app (the real lifecycle path).
    const fiber = host.ctx.plugin({ name: 'mini-fixture', inject: [] as const, apply: (scope: Context) => { registerMiniApp(host, scope) } })
    await fiber
    const { apps, pageRegistry } = requireRegistries(host)
    expectPagesRegisteredOnce(apps, pageRegistry, MINI_APP_ID)
    expect(pageRegistry.resolve('/apps/mini/main')).not.toBeNull()
    // 工具经应用注册表面可解析，外部名带前缀 / tools resolve with the prefixed external name
    expect(apps.listTools(MINI_APP_ID).map((tool) => tool.externalName)).toEqual(['mini__read'])
    await fiber.dispose()
    expectAppRemoved(apps, pageRegistry, MINI_APP_ID, ['/apps/mini/main'])
    await host.dispose()
  })

  it('taskCenter 开启：真实任务中心跑在临时存储上，dispose 后各服务摘除', async () => {
    const host = await mountAppHost({ taskCenter: true })
    expect(await host.ctx.taskCenter.list({})).toEqual([])
    await host.dispose()
    // provide/fiber 全部成对拆除：宿主面上不再解析到任何挂上去的服务。
    // Every provide/fiber tears down paired: none of the mounted services
    // resolve on the host face anymore.
    expect(host.ctx.get('taskCenter')).toBeUndefined()
    expect(host.ctx.get('storageDomain')).toBeUndefined()
  })

  it('降级开关：registries 缺席时 apps/pageRegistry 缺席，storage 仍可用', async () => {
    const host = await mountAppHost({ registries: false, storage: true })
    expect(host.apps).toBeUndefined()
    expect(host.pageRegistry).toBeUndefined()
    expect(host.ctx.get('apps')).toBeUndefined()
    expect(host.ctx.get('pageRegistry')).toBeUndefined()
    expect(host.ctx.get('storageDomain')).toBeDefined()
    await host.dispose()
  })

  it('降级开关：storage 显式关闭时须连 registries 一起关（默认挂 storage），否则 fail loud', async () => {
    // page-registry 声明 inject ['storageDomain']：registries 开着而 storage 关着
    // 是装配错误，直接拒绝而不是悄悄给出半死宿主。
    // page-registry declares inject ['storageDomain']: registries on while
    // storage off is an assembly error — reject it instead of returning a
    // half-dead host.
    await expect(mountAppHost({ storage: false })).rejects.toThrow('storageDomain')
    const host = await mountAppHost({ registries: false, storage: false })
    expect(host.apps).toBeUndefined()
    expect(host.pageRegistry).toBeUndefined()
    expect(host.ctx.get('storageDomain')).toBeUndefined()
    await host.dispose()
  })
})

describe('TempDirs 创建与清理成对', () => {
  it('disposeAll 后目录在磁盘上不存在，且实例可继续复用', () => {
    const dirs = new TempDirs()
    const first = dirs.create('pairing')
    expect(existsSync(first)).toBe(true)
    dirs.disposeAll()
    expect(existsSync(first)).toBe(false)
    const second = dirs.create('pairing')
    expect(existsSync(second)).toBe(true)
    dirs.disposeAll()
    expect(existsSync(second)).toBe(false)
  })
})
