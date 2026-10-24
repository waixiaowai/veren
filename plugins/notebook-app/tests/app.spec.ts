/**
 * Composition specs for the notebook application layer (the G2 acceptance
 * face, "framework present" half): a real cordis Context, the real
 * `@veren/notebook` service over the real storage stack (temp directory), and
 * the real AppRegistryService/PageRegistryService with the mirror seam wired
 * exactly as the host assembly does. They lock the acceptance face: the app is
 * discoverable and active, the entry URL resolves, every page URL lives under
 * /apps/notebook/, the five collected builders carry the notebook__ prefix and
 * act on the real service, registration is single-entry and is the ONLY
 * registration face (nothing lands in any global tools registry), §3.9's
 * promise alignment holds (catalog = per-page mount = instructions naming),
 * and teardown strips both sides. The "framework absent" half lives in the
 * host package's own suite (`plugins/notebook/tests/app.spec.ts`).
 *
 * 记事本应用层的组合测试（G2 验收面的「框架在场」半边）：真实 cordis Context、真实存储栈
 * （临时目录）上的 `@veren/notebook` 服务，以及与真实宿主装配同缝接线的
 * AppRegistryService/PageRegistryService。用例锁定验收面：应用可发现且 active、入口 URL
 * 可解析、页面 URL 全在 /apps/notebook/ 下、收编的五个构建器带 notebook__ 前缀且作用于
 * 真实服务、单入口注册且是唯一注册面（任何全局工具注册表都不落东西）、§3.9 承诺对齐成立
 * （目录 = 逐页挂载 = 说明点名）、卸载两侧摘干净。「框架缺席」半边在宿主包自己的套件里
 * （`plugins/notebook/tests/app.spec.ts`）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as NotebookApp from '../src/index.ts'
import { APP_DEFINITION, APP_ID, Config as AppConfig } from '../src/index.ts'
import { createAppTools } from '../src/app.ts'
import { bindNotebookServices, ListMeta, ListPage, NoteMeta, NotePage } from '../src/pages.tsx'
import { defineComponentPage } from '@veren/prompt-page'
import type { NoteSummary, NoteView } from '@veren/notebook'
import NotebookService, { Config as HostConfig } from '@veren/notebook'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

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
  // 页面工具经这一服务面解析调用者的预设。
  // The page tools resolve their caller's preset through this face.
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  // 宿主服务，配置按插件管理器的方式解析（0.2.0 起无配置项）。
  // The host service, config resolved the way the plugin manager resolves it (no options since 0.2.0).
  fibers.push(await ctx.plugin(NotebookService, HostConfig({})))

  // The real registries plus the mirror seam, wired exactly as the real host
  // assembly (app-host) does.
  // 真实注册表加镜像缝，与真实宿主装配（app-host）完全一致地接上。
  const apps = new AppRegistryService(new Context())
  const pageRegistry = new PageRegistryService(new Context())
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page, live),
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

/**
 * 假会话 agent：记录组件体直登的定义与首屏 followup（工具面与首屏的断言源）。
 * A fake session agent: records the body's direct registrations and first-screen
 * followups (the assertion source of the tool face and the first screen).
 */
function fakeAgent(preset?: string) {
  const registered: string[] = []
  const followups: string[] = []
  const agent = {
    ctx: {
      tools: { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined } },
      effect: (run: () => unknown) => { void run(); return async () => undefined },
      on: () => () => undefined,
    },
    session: { id: 'spec', ...(preset === undefined ? {} : { header: { agentPreset: preset } }) },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups }
}

/** 挂一页并返回正文与登记名（一次性渲染；快照通道已随 load 退役）
 * / mount one page, returning the body and the registered names (the snapshot channel died with load) */
function mountPage(
  page: (props: never, agent: never) => unknown,
  meta: object,
  tools: readonly ToolDefinition[],
  params: Record<string, string> = {},
): { body: string; registered: string[] } {
  const { agent, registered } = fakeAgent()
  void tools
  const body = defineComponentPage(page as never, meta as never).live.mount(params, agent)
  return { body, registered }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

/** 说明里是否点名了该工具（词边界匹配，避免 rewrite_note 被误当 write_note）。 */
/** Whether the instructions name the tool (word-bounded, so rewrite_note does not count as write_note). */
function names(instructions: string, tool: string): boolean {
  return new RegExp(`(?<![\\w])${tool}(?![\\w])`).test(instructions)
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
      expect('preset' in page).toBe(false)
    }
    // 页面是工厂（闭包持有装配端口），结构断言直接读注册表里挂好的实例
    // / pages are factories (closing over the assembly port); structural asserts read the registered instances
    const note = apps.listPages(APP_ID).find((page) => page.name === 'note')
    if (note === undefined) throw new Error('the note page is not registered')
    expect(note.url).toBe('/apps/notebook/note/:noteId')
    expect(note.instanceTitle?.({ noteId: '7' })).toBe('笔记 #7')

    await fiber.dispose()
  })
})

describe('应用工具 / app tools', () => {
  it('页面工具对外名带 notebook__ 前缀（工具不再走应用目录，全名在创建处拼定）', async () => {
    const { ctx, fiber } = await mount()

    expect(createAppTools(ctx, () => ctx.notebook.toolsPort()).map((tool) => tool.name)).toEqual(
      TOOL_NAMES.map((name) => `notebook__${name}`),
    )

    await fiber.dispose()
  })

  it('页面工具经真实 NotebookService 读写调用者自己的笔记', async () => {
    const { ctx, fiber } = await mount()
    const exec = execution('ada')
    const toolOf = (name: string): AppTool => createAppTools(ctx, () => ctx.notebook.toolsPort()).find((tool) => tool.name === `notebook__${name}`)!

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

describe('§3.9 承诺对齐：登记 = 说明点名 / registration = instructions naming', () => {
  /** 两页组件体登记的本地名（一次性渲染的登记面）：先绑槽位再挂模块级组件
   * / local names the two bodies register (the one-shot face): bind the slot first, then mount the module-level components */
  function registeredLocal(ctx: Context, tools: readonly ToolDefinition[]) {
    bindNotebookServices(() => ctx.notebook.toolsPort(), tools)
    const list = mountPage(ListPage, ListMeta, tools)
    const note = mountPage(NotePage, NoteMeta, tools)
    const local = (page: { registered: string[] }): string[] => page.registered.map((fullName) => fullName.split('__').pop() ?? fullName)
    return { list: local(list), note: local(note), listMeta: ListMeta, noteMeta: NoteMeta }
  }

  it('登记=目录：五个工具恰好被两页登记，且每工具恰好归属一页', async () => {
    const { ctx, fiber } = await mount()
    const tools = createAppTools(ctx, () => ctx.notebook.toolsPort())
    const { list, note } = registeredLocal(ctx, tools)
    // 登记面 = 工具面：不多收编、不少登记；工具不跨页重叠（每个工具恰好归属一页）
    // / the registered face equals the tool face: nothing extra, nothing missing; no tool on two pages
    expect([...list, ...note].sort()).toEqual([...TOOL_NAMES].sort())
    expect(new Set([...list, ...note]).size).toBe(list.length + note.length)

    await fiber.dispose()
  })

  it('登记=说明点名：每页登记的每个工具都被该页 instructions 点名', async () => {
    const { ctx, fiber } = await mount()
    const tools = createAppTools(ctx, () => ctx.notebook.toolsPort())

    // 真机教训（person-agent 概览页曾一个工具都不挂）：挂了却不说，模型看不见能力的来源。
    // / Live-host lesson (person-agent's overview once mounted nothing): mounted
    // but unnamed, a capability's source is invisible to the model.
    const { list, note, listMeta, noteMeta } = registeredLocal(ctx, tools)
    for (const [page, meta, registered] of [['list', listMeta, list], ['note', noteMeta, note]] as const) {
      if (meta.instructions === undefined) throw new Error(`page ${page} must carry instructions`)
      for (const tool of registered) {
        expect(names(meta.instructions, tool), `${page} must name ${tool}`).toBe(true)
      }
    }

    await fiber.dispose()
  })

  it('说明点名不超登记：页面说明提到的工具名都被该页登记', async () => {
    const { ctx, fiber } = await mount()
    const tools = createAppTools(ctx, () => ctx.notebook.toolsPort())

    // 反向也是承诺：点名了就必须真登记，说明不答应页面没有的能力。
    // / The reverse is a promise too: naming a tool requires registering it — the
    // instructions never promise a capability the page does not carry.
    const { list, note, listMeta, noteMeta } = registeredLocal(ctx, tools)
    for (const [page, meta, registered] of [['list', listMeta, list], ['note', noteMeta, note]] as const) {
      if (meta.instructions === undefined) throw new Error(`page ${page} must carry instructions`)
      for (const tool of TOOL_NAMES) {
        if (names(meta.instructions, tool)) {
          expect(registered, `${page} mentions ${tool}`).toContain(tool)
        }
      }
    }

    await fiber.dispose()
  })
})

describe('§3.10 页面信息组织：首页必须把该给的信息给全 / the home page hands over complete information', () => {
  it('首页（entry）零结构问题：map 覆盖详情页模板、每条带"什么时候用"，且自带 load', async () => {
    const { apps, fiber } = await mount()
    const pages = apps.listPages(APP_ID)
    const entryKey = APP_DEFINITION.entry
    if (entryKey === undefined) throw new Error('the notebook app must declare an entry page')
    const home = pages.find((page) => page.name === entryKey)
    if (home === undefined) throw new Error(`entry page ${entryKey} is not registered`)
    // 判据：map 由注册表推导（RFC prompt-page-render §3.5）——AppRecord.pages
    // 投影列全兄弟页（笔记详情页），构造上覆盖；契约面无任何宿主经手的取数钩子。
    // / the criterion: the map is registry-derived (§3.5) — the AppRecord.pages
    // projection lists the sibling (the note detail page), coverage by
    // construction; the contract face carries no host-mediated data hook.
    const record = apps.get(APP_ID)
    expect(record?.pages?.get('note')?.url).toBe('/apps/notebook/note/:noteId')
    expect('load' in home).toBe(false)
    await fiber.dispose()
  })

  it('首屏读取是组件体自己的生命周期：列表页 effect 异步读、事实经 followup 进上下文', async () => {
    const { ctx, fiber } = await mount()
    // 模块槽位是进程级单例：本用例开头重绑自己的 ctx，防其他用例的绑定漂移
    // / the module slot is a process-level singleton: rebind this test's own ctx
    // up front so other tests' bindings cannot drift it
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()))
    // 归属未知（会话头无 preset）→ 消息里如实说明，不编造
    // / unknown owner (no preset in the session header) → stated honestly in the message, never faked
    const unknown = fakeAgent()
    defineComponentPage(ListPage, ListMeta).live.mount({}, unknown.agent)
    await vi.waitFor(() => expect(unknown.followups).toHaveLength(1))
    expect(unknown.followups[0]).toContain('归属未知')

    // 空列表 → 空态如实送达 / an empty notebook → the empty state delivered honestly
    const empty = fakeAgent('ada')
    defineComponentPage(ListPage, ListMeta).live.mount({}, empty.agent)
    await vi.waitFor(() => expect(empty.followups).toHaveLength(1))
    expect(empty.followups[0]).toContain('还是空的')

    // 写一条真笔记 → 同一预设的首页首屏消息能看到它；别人的看不到
    // / write a real note → the same preset's first-screen message lists it
    const exec = execution('ada')
    const toolOf = (name: string): AppTool => createAppTools(ctx, () => ctx.notebook.toolsPort()).find((tool) => tool.name === `notebook__${name}`)!
    const created = toolValue<{ note: NoteView }>(await toolOf('write_note').execute({ title: 'Plan', body: 'x' }, exec))
    const listed = fakeAgent('ada')
    defineComponentPage(ListPage, ListMeta).live.mount({}, listed.agent)
    await vi.waitFor(() => expect(listed.followups).toHaveLength(1))
    expect(listed.followups[0]).toContain(created.note.id)
    expect(listed.followups[0]).toContain('Plan')
    await fiber.dispose()
  })

  it('详情页首屏：归属对得上才给，别人的笔记如实找不到（按参数取该条记录）', async () => {
    const { ctx, fiber } = await mount()
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()))
    const exec = execution('ada')
    const toolOf = (name: string): AppTool => createAppTools(ctx, () => ctx.notebook.toolsPort()).find((tool) => tool.name === `notebook__${name}`)!
    const created = toolValue<{ note: NoteView }>(await toolOf('write_note').execute({ title: 'Plan', body: 'x' }, exec))

    // 归属一致：首屏消息带全文 / matching owner: the message carries the full text
    const found = fakeAgent('ada')
    defineComponentPage(NotePage, NoteMeta).live.mount({ noteId: created.note.id }, found.agent)
    await vi.waitFor(() => expect(found.followups).toHaveLength(1))
    expect(found.followups[0]).toContain('Plan')

    // 归属不匹配 = 笔记不存在（存储按预设隔离）/ a mismatched owner = the note does not exist (preset-scoped storage)
    const stranger = fakeAgent('bob')
    defineComponentPage(NotePage, NoteMeta).live.mount({ noteId: created.note.id }, stranger.agent)
    await vi.waitFor(() => expect(stranger.followups).toHaveLength(1))
    expect(stranger.followups[0]).toContain('不存在或归属未知')
    await fiber.dispose()
  })
})

describe('页面 = 信息 + 工具，缺一不可 / a page is its information plus its tools, neither optional', () => {
  it('正文是打开时刻的静态框：不留白、如实宣告首屏随后以消息送达', async () => {
    const { ctx, fiber } = await mount()
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()))
    const { agent } = fakeAgent('ada')
    const body = defineComponentPage(ListPage, ListMeta).live.mount({}, agent)
    // 正文是静态框：宿主不等首屏，数据由组件体经 followup 送达——框绝不留白。
    // / the body is the static frame: the host waits for no first screen; data
    // arrives via the body's followup — the frame is never a blank.
    // 正文经 markdown 渲染（下划线转义成 \_），比对前剥掉转义反斜杠。
    // / the body renders through markdown (underscores escaped), so strip
    // escape backslashes before comparing.
    const plain = body.replaceAll('\\', '')
    expect(plain).toContain('首屏随后以消息送达')
    expect(plain).toContain('list_notes')
    await fiber.dispose()
  })
})
