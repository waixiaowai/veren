/**
 * Composition specs for the forum application layer (G2 acceptance face):
 * a real cordis Context, the real `@veren/forum` service over the real storage
 * stack, and the real AppRegistryService/PageRegistryService with the mirror
 * seam wired exactly as the host assembly does. They lock the "framework
 * present" half of the G2 contract: the app is discovered and active, the
 * entry URL resolves, page tools carry the `forum__` prefix and act on the
 * real service, single-entry consistency holds, and teardown strips both
 * sides. The "framework absent" half lives in the host package's own suite
 * (`plugins/forum/tests/tools.spec.ts`).
 *
 * 论坛应用层的组合测试（G2 验收面）：真实 cordis Context、真实存储栈上的
 * `@veren/forum` 服务，以及与真实宿主装配同缝接线的 AppRegistryService /
 * PageRegistryService。用例锁定 G2 契约的「框架在场」半边：应用可发现且 active、
 * 入口 URL 可解析、页面工具带 `forum__` 前缀且作用于真实服务、单入口一致、卸载两侧
 * 摘干净。「框架缺席」半边在宿主包自己的套件里（`plugins/forum/tests/tools.spec.ts`）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import { defineComponentPage, isMarkdownDocHost } from '@veren/prompt-page'
import type { ComponentPageMeta, MarkdownDocHost, PageFC, PageParams } from '@veren/prompt-page'
import { CatalogMeta, CatalogPage, PostMeta, PostPage } from '../src/pages.tsx'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ForumApp from '../src/index.ts'
import { Config as AppConfig, FORUM_APP_DEFINITION, FORUM_APP_ID } from '../src/index.ts'
import ForumService, { Config as HostConfig } from '@veren/forum'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

afterEach(() => {
  for (const unsubscribe of pageViews.splice(0).reverse()) unsubscribe()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forum-app-'))
  roots.push(root)
  return root
}

/** The live Agent a tool reads its caller from; any non-null stands for one. 工具读取调用者所依据的活 Agent。 */
const AGENT = { ctx: {}, session: { header: { agentPreset: 'standard' } } }

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
interface AppTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
function toolValue<T>(result: unknown): T {
  return result as T
}

/** 本轮用例挂起的 live 页面视图，afterEach 逆序退订。Live page views to unsubscribe after each spec. */
const pageViews: Array<() => void> = []

/**
 * 挂载真实页面组件并返回其文档宿主：正文里的 `ctx.forum` 经测试 ctx 的真实服务面
 * 解析——与生产装配同一组件、同一上下文语义，零工厂、零闭包注入。
 * Mount a real page component and return its doc host: the body's `ctx.forum`
 * resolves through the test ctx's real service face — the same component and
 * context semantics as the production assembly, zero factory, zero closures.
 */
function mountPage(
  component: PageFC,
  meta: ComponentPageMeta,
  ctx: Context,
  params: PageParams = {},
): { host: MarkdownDocHost } {
  const view = defineComponentPage(component, meta, ctx).live.mount(params)
  pageViews.push(() => { view.unsubscribe() })
  const host = isMarkdownDocHost(view.host) ? view.host : undefined
  if (host === undefined) throw new Error('expected the markdown doc host')
  return { host }
}

/**
 * Mount the full stack: real storage, the real host service (with the same
 * minimal service doubles the host suite uses), the real registries with the
 * mirror seam, and the app plugin on top.
 * 挂全栈：真实存储、真实宿主服务（复用宿主套件的最小服务替身）、带镜像缝的真实注册表，
 * 以及其上的应用插件。
 */
async function mount(): Promise<{
  ctx: Context
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
}> {
  const ctx = new Context()
  const tools = new Map<string, AppTool>()
  ctx.provide('tools', {
    register(tool: AppTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('systemPrompt', { context: () => () => {} })
  ctx.provide('agentPresets', {
    list: async () => [{ id: 'standard', name: 'standard' }],
    composedPreset: () => 'standard',
  })
  ctx.provide('llm', {})
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  ctx.provide('workingDirectory', { get: () => 'C:/work/demo' })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: 'C:/work/demo', title: 'Demo' }] })

  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })

  // The host service, resolved the way the plugin manager resolves config.
  // 宿主服务，配置按插件管理器的方式解析。
  const hostFiber = ctx.plugin(ForumService, HostConfig({}) as Parameters<typeof HostConfig>[0])
  await hostFiber

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

  const fiber = ctx.plugin(ForumApp, AppConfig({ reserved: false }))
  await fiber
  return { ctx, fiber, apps, pageRegistry }
}

describe('forum app discovery and resolution / 应用可发现与可解析', () => {
  it('ctx.apps.catalog() discovers the forum app as active with the forum prefix', async () => {
    const { apps, fiber } = await mount()

    const record = apps.get(FORUM_APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('forum')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('forum')

    await fiber.dispose()
  })

  it('the entry page URL is /apps/forum/catalog and resolves in the page registry', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const entry = apps.listPages(FORUM_APP_ID).find((page) => page.name === FORUM_APP_DEFINITION.entry)
    expect(entry?.url).toBe('/apps/forum/catalog')
    // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
    expect(pageRegistry.resolve('/apps/forum/catalog')?.page.name).toBe(`${FORUM_APP_ID}/catalog`)
    const match = pageRegistry.resolve('/apps/forum/post/p-12?focus=chat')
    expect(match?.params).toEqual({ postId: 'p-12', focus: 'chat' })

    await fiber.dispose()
  })

  it('every page URL lives under /apps/forum/, carries no preset, and titles its instances', async () => {
    const { apps, fiber } = await mount()
    // 页面是工厂（闭包持有装配端口），结构断言直接读注册表里挂好的实例
    // / pages are factories (closing over the assembly port); structural asserts read the registered instances
    const listed = apps.listPages(FORUM_APP_ID)
    for (const page of listed) {
      expect(page.url.startsWith('/apps/forum/')).toBe(true)
      expect('preset' in page).toBe(false)
    }
    const post = listed.find((page) => page.name === 'post')
    expect(post?.url).toBe('/apps/forum/post/:postId')
    expect(post?.instanceTitle?.({ postId: '12' })).toBe('主题 #12')
    await fiber.dispose()
  })

  it('page tools carry the forum__ external-name prefix', async () => {
    const { apps, fiber } = await mount()

    expect(apps.listTools(FORUM_APP_ID).map((tool) => tool.externalName)).toEqual([
      'forum__list', 'forum__read', 'forum__post', 'forum__comment', 'forum__vote', 'forum__inbox',
    ])

    await fiber.dispose()
  })

  it('single-entry consistency: catalog pages and resolvable pages correspond one to one', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const listed = apps.listPages(FORUM_APP_ID)
    expect(listed.length).toBe(2)
    for (const page of listed) {
      const match = pageRegistry.resolve(page.url)
      expect(match, `page "${page.name}" (${page.url}) must be resolvable`).not.toBeNull()
      expect(match?.page.name).toBe(`${FORUM_APP_ID}/${page.name}`)
    }
    // Nothing under the app prefix resolves without a catalog entry: the
    // mirror never drifts in either direction.
    // 应用前缀下也不存在目录之外的页面：镜像不会向任一方向漂移。
    const mirrored = pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/forum/'))
    expect(mirrored.map((row) => row.url).sort()).toEqual(listed.map((page) => page.url).sort())

    await fiber.dispose()
  })
})

describe('forum app tools act on the real service / 应用工具作用于真实服务', () => {
  it('publishes through forum__post and reads back through forum__list', async () => {
    const { ctx, apps, fiber } = await mount()
    const toolOf = (name: string): AppTool => apps.listTools(FORUM_APP_ID).find((tool) => tool.name === name)!
    const boardId = (await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })).id

    // The page tool resolves the caller from the live Agent — no author
    // argument — and writes the same record set the host tools serve.
    // 页面工具从活 Agent 解析调用者——没有作者参数——并写入宿主工具所服务的同一份记录集合。
    const written = toolValue<{ value: { id: string } }>(
      await toolOf('post').execute({ title: 'from the page', body: 'body' }, { agent: AGENT }),
    )
    const listed = toolValue<{ posts: Array<{ id: string }> }>(
      await toolOf('list').execute({ boardId }, { agent: AGENT }),
    )
    expect(listed.posts.map((post) => post.id)).toContain(written.value.id)
    await expect(toolOf('post').execute({ title: 'x', body: 'y' }, {}))
      .rejects.toMatchObject({ code: 'no_caller' })

    await fiber.dispose()
  })
})

describe('forum app lifecycle / 生命周期', () => {
  it('disposing the fiber removes the app, its pages, and its tools at once', async () => {
    const { apps, pageRegistry, fiber } = await mount()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/forum/catalog')).toBeNull()
    expect(pageRegistry.resolve('/apps/forum/post/p-1')).toBeNull()
    // HMR safety: the same context can mount the app again after disposal.
    // HMR 安全：卸载后同一上下文可以再次挂载应用。
    expect(apps.get(FORUM_APP_ID)).toBeUndefined()
  })
})

describe('目录 = 挂载 = 说明 三方可核对 / catalog = mount = instructions', () => {
  /** Pull the `forum__*` names an instruction text promises. 从说明文本里提取它承诺的 forum__* 工具名。 */
  function namedTools(text: string | undefined): Set<string> {
    return new Set(text?.match(/forum__[a-z_]+/g) ?? [])
  }

  /** The external names of one page's mounted tools. 一个页面所挂工具的外部名。 */
  function mountedOf(page: { tools?: readonly string[] }): Set<string> {
    return new Set((page.tools ?? []).map((name) => `forum__${name}`))
  }

  it('应用目录与页面挂载一一对应：无目录外挂载，也无挂载外目录项', async () => {
    const { apps, fiber } = await mount()

    const catalog = new Set(apps.listTools(FORUM_APP_ID).map((tool) => tool.externalName))
    const mounted = new Set(apps.listPages(FORUM_APP_ID).flatMap((page) => [...mountedOf(page)]))
    expect(mounted).toEqual(catalog)

    await fiber.dispose()
  })

  it('每页说明点名的工具恰好等于该页挂载的工具（承诺 = 挂载）', async () => {
    const { apps, fiber } = await mount()

    for (const page of apps.listPages(FORUM_APP_ID)) {
      expect(namedTools(page.instructions), `page "${page.name}" instructions`).toEqual(mountedOf(page))
    }

    await fiber.dispose()
  })

  it('应用说明点名的工具都被某一页挂载', async () => {
    const { apps, fiber } = await mount()

    const mounted = new Set(apps.listPages(FORUM_APP_ID).flatMap((page) => [...mountedOf(page)]))
    const named = namedTools(FORUM_APP_DEFINITION.instructions)
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) {
      expect(mounted.has(name), `${name} named by the app note must be mounted on some page`).toBe(true)
    }

    await fiber.dispose()
  })

  it('收件箱工具两个页面都挂，首页如实声明写意图', async () => {
    const { apps, fiber } = await mount()

    const pages = apps.listPages(FORUM_APP_ID)
    const catalog = pages.find((page) => page.name === 'catalog')
    const post = pages.find((page) => page.name === 'post')
    expect(catalog?.tools).toEqual(['list', 'post', 'inbox'])
    expect(catalog?.writes).toBe(true)
    expect(post?.tools).toEqual(['read', 'comment', 'vote', 'inbox'])
    expect(post?.writes).toBe(true)

    await fiber.dispose()
  })
})

describe('§3.10 页面 = 信息 + 工具：正文渲染真实记录，每行带 id / the body renders the real records, ids on every row', () => {
  it('入口页正文渲染真实目录：板块/主题/人物行内带 id，读取中先如实在场', async () => {
    const { ctx, fiber } = await mount()
    const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })
    await ctx.forum.toolsPort().publish({
      boardId: board.id, author: 'standard', title: '开版帖', body: '第一篇',
    })
    const { host } = mountPage(CatalogPage, CatalogMeta, ctx)
    await vi.waitFor(() => expect(host.bodyText()).toContain('论坛 · 板块与主题列表'))
    // 板块行：id 是工具要用的 boardId / the board row: its id is the tool's boardId
    await vi.waitFor(() => expect(host.bodyText()).toContain('id: ws-1'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('开版帖（id:'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('作者 standard'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('standard'))
  })

  it('详情页正文渲染该主题与评论树：评论行内 id 可作 parentCommentId/subjectId', async () => {
    const { ctx, fiber } = await mount()
    const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })
    const created = await ctx.forum.toolsPort().publish({
      boardId: board.id, author: 'standard', title: '被读的帖', body: '全文在这里',
    })
    await ctx.forum.toolsPort().comment({
      postId: created.value.id, author: 'ptc', body: '前排回复',
    })
    const { host } = mountPage(PostPage, PostMeta, ctx, { postId: created.value.id })
    await vi.waitFor(() => expect(host.bodyText()).toContain('被读的帖'))
    await vi.waitFor(() => expect(host.bodyText()).toContain(`id: ${created.value.id}`))
    await vi.waitFor(() => expect(host.bodyText()).toContain('全文在这里'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('前排回复'))
    // 评论行格式：作者（id: ...）：内容 / the comment row format: author (id: ...): body
    await vi.waitFor(() => expect(host.bodyText()).toContain('ptc（id:'))
  })

  it('主题不存在：失败态如实渲染（失败态也是数据，不编造内容）', async () => {
    const { ctx, fiber } = await mount()
    const { host } = mountPage(PostPage, PostMeta, ctx, { postId: 'p-missing' })
    await vi.waitFor(() => expect(host.bodyText()).toContain('主题读取失败'))
    // 服务面的稳定拒绝消息原样进正文（code 面 由 forum 包自己的工具测试锁定）
    // / the service's stable refusal message lands verbatim (the code face is locked in the forum package's own tool tests)
    await vi.waitFor(() => expect(host.bodyText()).toContain('no post with id "p-missing"'))
  })

  it('说明指向正文行内 id：两页 instructions 都写明 id 取法', async () => {
    expect(CatalogMeta.instructions).toContain('行内')
    expect(CatalogMeta.instructions).toContain('id')
    expect(PostMeta.instructions).toContain('行内')
    expect(PostMeta.instructions).toContain('id')
  })
})
