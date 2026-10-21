/**
 * Composition specs for the notebook application layer (the G2 acceptance
 * face, "framework present" half): a real cordis Context, the real
 * `@veren/notebook` service over the real storage stack (temp directory), and
 * the real AppRegistryService/PageRegistryService with the mirror seam wired
 * exactly as the host assembly does. They lock the acceptance face: the app is
 * discoverable and active, the entry URL resolves, every page URL lives under
 * /apps/notebook/, page tools carry the notebook__ prefix and act on the real
 * service, registration is single-entry, and teardown strips both sides. The
 * "framework absent" half lives in the host package's own suite
 * (`plugins/notebook/tests/app.spec.ts`).
 *
 * 记事本应用层的组合测试（G2 验收面的「框架在场」半边）：真实 cordis Context、真实存储栈
 * （临时目录）上的 `@veren/notebook` 服务，以及与真实宿主装配同缝接线的
 * AppRegistryService/PageRegistryService。用例锁定验收面：应用可发现且 active、入口 URL
 * 可解析、页面 URL 全在 /apps/notebook/ 下、页面工具带 notebook__ 前缀且作用于真实服务、
 * 单入口注册、卸载两侧摘干净。「框架缺席」半边在宿主包自己的套件里
 * （`plugins/notebook/tests/app.spec.ts`）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { PageDefinition } from '@veren/prompt-page'
import * as NotebookApp from '../src/index.ts'
import { APP_DEFINITION, APP_ID, Config as AppConfig } from '../src/index.ts'
import type { NoteSummary, NoteView } from '@veren/notebook'
import NotebookService, { Config as HostConfig } from '@veren/notebook'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

/** Fibers mounted by one test, disposed newest-first after it. 一条用例挂的 fiber，测后逆序拆除。 */
const fibers: Fiber[] = []

afterEach(async () => {
  for (const fiber of fibers.reverse()) await fiber.dispose()
  fibers.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-app-'))
  roots.push(root)
  return root
}

/**
 * Mount the full stack: real storage, the real notebook service, and the real
 * registries with the mirror seam wired exactly as the host assembly does.
 * 挂全栈：真实存储、真实记事本服务，以及与真实宿主装配完全一致地接好镜像缝的真实注册表。
 */
async function mount(): Promise<{
  ctx: Context
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
}> {
  const ctx = new Context()
  // The global `notebook_*` tools land here; the page tools live in the app
  // registry's own catalog.
  // 全局 `notebook_*` 工具落在这里；页面工具住在应用注册表自己的目录里。
  ctx.provide('tools', { register: () => () => undefined } as unknown as Context['tools'])
  // The page tools resolve their caller's preset through this face.
  // 页面工具经这一服务面解析调用者的预设。
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  // 宿主服务，配置按插件管理器的方式解析。The host service, config resolved the
  // way the plugin manager resolves it.
  fibers.push(await ctx.plugin(NotebookService, HostConfig({ tools: { enabled: true } })))

  // The real registries plus the mirror seam, wired exactly as the real host
  // assembly (app-host) does.
  // 真实注册表加镜像缝，与真实宿主装配（app-host）完全一致地接上。
  const apps = new AppRegistryService(new Context())
  const pageRegistry = new PageRegistryService(new Context())
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page),
    releaseApp: appId => pageRegistry.releaseApp(appId),
  })

  const fiber = await ctx.plugin(NotebookApp, AppConfig({}))
  fibers.push(fiber)
  return { ctx, fiber, apps, pageRegistry }
}

/** The execution context one tool call carries. 一次工具调用携带的执行上下文。 */
function execution(preset: string): { agent: unknown } {
  return { agent: { ctx: { preset }, session: { header: { agentPreset: preset } } } }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
interface AppTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** The app tools in registration order. 按注册顺序的应用工具名。 */
const TOOL_NAMES = ['list_notes', 'read_note', 'write_note', 'rewrite_note', 'delete_note']

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
    // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
    expect(pageRegistry.resolve('/apps/notebook/list')?.page.name).toBe('notebook/list')
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

    const listed = apps.listPages(APP_ID).map((page) => `${APP_ID}/${page.name}`).sort()
    const resolved = apps.listPages(APP_ID)
      .map((page) => pageRegistry.resolve(page.url)?.page.name)
      .sort()
    // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
    expect(resolved).toEqual(listed)
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
})
