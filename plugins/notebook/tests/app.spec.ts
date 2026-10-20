/**
 * Composition specs for the notebook application layer: a real cordis Context,
 * a real NotebookService over the real storage stack, and the real
 * AppRegistryService/PageRegistryService. They lock the acceptance face: the
 * app is discoverable and active, the entry URL resolves, every page URL lives
 * under /apps/notebook/, page tools carry the notebook__ prefix, registration
 * is single-entry (catalog pages and page-registry pages match one to one),
 * and teardown strips both sides.
 *
 * 记事本应用层的组合测试：真实 cordis Context、真实存储栈上的 NotebookService，
 * 以及真实的 AppRegistryService/PageRegistryService。用例锁定验收面：应用可发现且
 * active、入口 URL 可解析、页面 URL 全在 /apps/notebook/ 下、页面工具带 notebook__
 * 前缀、单入口注册（应用目录与页面注册表一一对应），以及卸载时两侧摘干净。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import type { PageDefinition } from '@veren/prompt-page'
import NotebookService from '../src/index.ts'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import type { NoteSummary, NoteView } from '../src/types.ts'

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
interface AppTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** The app tools in registration order. 按注册顺序的应用工具名。 */
const TOOL_NAMES = ['list_notes', 'read_note', 'write_note', 'rewrite_note', 'delete_note']

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-app-'))
  roots.push(root)
  return root
}

/**
 * Mount the real storage stack, the notebook service, and (unless turned off)
 * the real registries wired through the app-registry mirror face.
 *
 * 挂载真实存储栈、记事本服务，以及（除非关闭）经 app-registry 镜像面接线的真实注册表。
 */
async function mount(options: { apps?: boolean } = {}): Promise<{
  ctx: Context
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  tools: Map<string, AppTool>
}> {
  const ctx = new Context()
  // Registry services self-provide on their own host context; the mount
  // re-provides the instances on the plugin's context, exactly like the
  // task-workbench composition specs do.
  // 注册表服务在自己的宿主上下文上自我提供；挂载时把这些实例重新 provide 到插件上下文，
  // 与 task-workbench 的组合测试一致。
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  const tools = new Map<string, AppTool>()
  // The mirror face is assembled by app-host; tests wire it explicitly.
  // 镜像面由 app-host 装配；测试里显式接线。
  if (options.apps !== false) {
    ctx.provide('apps', apps)
    ctx.provide('pageRegistry', pageRegistry)
    apps.setPageMirror({
      registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page),
      releaseApp: appId => pageRegistry.releaseApp(appId),
    })
  }
  ctx.provide('tools', {
    register(tool: AppTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })
  // The real storage stack the notebook service opens its domain through.
  // 记事本服务打开存储域所经的真实存储栈。
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber: Fiber = ctx.plugin(NotebookService)
  await fiber
  return { ctx, fiber, apps, pageRegistry, tools }
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

  it('apps 缺席：服务照常激活，仅降级为全局工具', async () => {
    const { fiber, ctx, tools } = await mount({ apps: false })

    expect(ctx.get('apps')).toBeUndefined()
    expect(tools.size).toBe(5)

    await fiber.dispose()
  })
})
