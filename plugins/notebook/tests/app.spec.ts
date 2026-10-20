/**
 * Composition specs for the notebook application layer, mounted on the shared
 * @veren/test-support host: a real cordis Context, a real NotebookService over
 * the real storage stack (temp directory), and the real
 * AppRegistryService/PageRegistryService with the mirror seam wired by the
 * harness. They lock the acceptance face: the app is discoverable and active,
 * the entry URL resolves, every page URL lives under /apps/notebook/, page
 * tools carry the notebook__ prefix, registration is single-entry (catalog
 * pages and page-registry pages match one to one), and teardown strips both
 * sides.
 *
 * 记事本应用层的组合测试，搭在共享的 @veren/test-support 宿主上：真实 cordis
 * Context、真实存储栈（临时目录）上的 NotebookService，以及由测试基建接好镜像缝
 * 的真实 AppRegistryService/PageRegistryService。用例锁定验收面：应用可发现且
 * active、入口 URL 可解析、页面 URL 全在 /apps/notebook/ 下、页面工具带
 * notebook__ 前缀、单入口注册（应用目录与页面注册表一一对应），以及卸载时两侧
 * 摘干净。
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import type { PageDefinition } from '@veren/prompt-page'
import { expectPagesRegisteredOnce, mountAppHost } from '@veren/test-support'
import type { AppHost } from '@veren/test-support'
import NotebookService, { Config } from '../src/index.ts'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import type { NoteSummary, NoteView } from '../src/types.ts'

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
interface AppTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** The app tools in registration order. 按注册顺序的应用工具名。 */
const TOOL_NAMES = ['list_notes', 'read_note', 'write_note', 'rewrite_note', 'delete_note']

/** Hosts mounted by one test, disposed newest-first after it. 一条用例挂的宿主，测后逆序拆除。 */
const hosts: AppHost[] = []

afterEach(async () => {
  for (const host of hosts.reverse()) await host.dispose()
  hosts.length = 0
})

/** 挂共享宿主并启动配置驱动的记事本服务。Mount the shared host and start the notebook service with a resolved config. */
async function mountWithConfig(appEnabled: boolean): Promise<{
  host: AppHost
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
}> {
  const host = await mountAppHost({ storage: true })
  hosts.push(host)
  const fiber: Fiber = await host.ctx.plugin(NotebookService, Config({
    tools: { enabled: true },
    app: { enabled: appEnabled },
  }))
  if (host.apps === undefined || host.pageRegistry === undefined) {
    throw new Error('registries were not mounted')
  }
  return { host, fiber, apps: host.apps, pageRegistry: host.pageRegistry }
}

/** 挂共享宿主（注册表 + 镜像面 + 临时目录上的真实存储）并启动记事本服务。Mount the shared host (registries + mirror + real storage over a temp dir) and start the notebook service. */
async function mount(): Promise<{
  host: AppHost
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
}> {
  return mountWithConfig(true)
}

/** The execution context one tool call carries. 一次工具调用携带的执行上下文。 */
function execution(preset: string): { agent: unknown } {
  return { agent: { ctx: { preset }, session: { header: { agentPreset: preset } } } }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

describe('应用可发现与可解析 / discoverable and resolvable', () => {
  it('ctx.apps.catalog() 发现 notebook：active、toolPrefix=notebook', async () => {
    const { apps, fiber } = await mount()

    const record = apps.get(APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('notebook')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('notebook')

    await fiber.dispose()
  })

  it('入口页 URL 合法（/apps/notebook/list）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const entryKey = APP_DEFINITION.entry
    const entry = apps.listPages(APP_ID).find((page) => page.name === entryKey)
    expect(entry?.url).toBe('/apps/notebook/list')
    expect(pageRegistry.resolve('/apps/notebook/list')?.page.name).toBe('list')
    const match = pageRegistry.resolve('/apps/notebook/note/n-7?focus=chat')
    expect(match?.params).toEqual({ noteId: 'n-7', focus: 'chat' })

    await fiber.dispose()
  })

  it('两页 URL 全部在 /apps/notebook/ 下，页面不绑定预设', async () => {
    const { apps, fiber } = await mount()

    for (const page of apps.listPages(APP_ID)) {
      expect(page.url.startsWith('/apps/notebook/')).toBe(true)
      expect(page.pageRevision).toBeGreaterThanOrEqual(1)
      expect('preset' in page).toBe(false)
    }
    const note = apps.listPages(APP_ID).find((page) => page.name === 'note') as PageDefinition<NoteView | undefined>
    expect(note.url).toBe('/apps/notebook/note/:noteId')
    expect(note.instanceTitle?.({ noteId: '7' })).toBe('笔记 #7')

    await fiber.dispose()
  })
})

describe('应用工具 / app tools', () => {
  it('页面工具对外名带 notebook__ 前缀', async () => {
    const { apps, fiber } = await mount()

    expect(apps.listTools(APP_ID).map((tool) => tool.externalName)).toEqual(
      TOOL_NAMES.map((name) => `notebook__${name}`),
    )

    await fiber.dispose()
  })

  it('页面工具经真实 NotebookService 读写调用者自己的笔记', async () => {
    const { apps, fiber } = await mount()
    const exec = execution('ada')
    const toolOf = (name: string): AppTool => apps.listTools(APP_ID).find((tool) => tool.name === name)!

    const created = toolValue<{ note: NoteView }>(
      await toolOf('write_note').execute({ title: 'Plan', body: 'first draft' }, exec),
    )
    expect(created.note).toMatchObject({ title: 'Plan', body: 'first draft' })

    const listed = toolValue<{ notes: NoteSummary[] }>(await toolOf('list_notes').execute({}, exec))
    expect(listed.notes.map((note) => note.id)).toEqual([created.note.id])
    await expect(toolOf('read_note').execute({ id: created.note.id }, execution('bob')))
      .rejects.toMatchObject({ code: 'notebook/note-not-found' })

    await fiber.dispose()
  })

  it('单入口注册一致：应用目录的页面与 page-registry 可解析的页面一一对应', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const listed = apps.listPages(APP_ID).map((page) => page.name).sort()
    const resolved = apps.listPages(APP_ID)
      .map((page) => pageRegistry.resolve(page.url)?.page.name)
      .sort()
    expect(resolved).toEqual(listed)
    // 断言助手：双向核对（每页可解析且名字一致；前缀下没有目录外页面）。
    // Assertion helper: both directions (each page resolves with the same
    // name; nothing under the prefix lives outside the catalog).
    expectPagesRegisteredOnce(apps, pageRegistry, APP_ID)
    // 没有目录外的第 /apps/notebook/ 注册（没有第二条注册路径）
    expect(pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/notebook/'))).toHaveLength(listed.length)

    await fiber.dispose()
  })
})

describe('生命周期 / lifecycle', () => {
  it('插件 fiber 销毁 → 应用从 catalog 与 URL 索引同时摘除', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/notebook/list')).toBeNull()
    expect(pageRegistry.resolve('/apps/notebook/note/n-1')).toBeNull()
  })

  it('config.app.enabled=false：应用层不注册，全局工具照常（显式配置，非运行期探测）', async () => {
    // 应用框架是声明的硬 inject（G13），"apps 缺席照常激活"的降级通道并不存在；
    // 真正的开关是配置：关掉应用层，全局 `notebook_*` 工具照常登记。
    // The app framework is a declared hard inject (G13); no "activate without
    // apps" degrade channel exists. The real switch is config: with the app
    // layer off, the global `notebook_*` tools still register.
    const { host, apps, fiber } = await mountWithConfig(false)

    expect(apps.catalog()).toHaveLength(0)
    // 全局工具照常登记进宿主工具表：恰好五条、全部带 notebook 前缀。
    // Global tools still land in the host tool table: exactly five, all
    // carrying the notebook prefix.
    expect(host.tools.names()).toHaveLength(TOOL_NAMES.length)
    for (const name of host.tools.names()) expect(name.startsWith('notebook')).toBe(true)

    await fiber.dispose()
  })
})
