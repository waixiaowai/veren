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
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageParams } from '@veren/prompt-page'
import { bindForumServices, CatalogMeta, CatalogPage, PostMeta, PostPage } from '../src/pages.tsx'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ForumApp from '../src/index.ts'
import { Config as AppConfig, FORUM_APP_DEFINITION, FORUM_APP_ID } from '../src/index.ts'
import type { ForumToolsPort } from '@veren/forum'
import ForumService, { Config as HostConfig } from '@veren/forum'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

afterEach(() => {
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

/**
 * 假会话 agent：记录组件体直登的定义（页面的工具面断言源）。
 * A fake session agent: records the body's direct registrations (the assertion
 * source of a page's tool face).
 */
function fakeAgent() {
  const registered: Array<{ name: string; definition: unknown }> = []
  const followups: string[] = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push({ name: definition.name, definition })
          return () => undefined
        },
      },
      effect: (run: () => unknown) => { void run(); return async () => undefined },
      on: () => () => undefined,
    },
    session: { id: 'spec' },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups }
}

/** 记录型 agent（一次构造，多处使用）/ a recording agent (built once, used everywhere) */
interface ForumFixture {
  registered: Array<{ name: string; definition: unknown }>
  agent: never
}

/** 绑定装配槽位（真 ctx + 真 port）并挂一只记录型 agent：组件是模块级的，
 * 依赖经 bindForumServices 进槽位，体里经 agent.ctx 解析服务
 * / bind the assembly slot (real ctx + port) and hold a recording agent: the
 * components are module-level; dependencies enter via bindForumServices and the
 * bodies resolve services through agent.ctx */
function makeFixture(ctx: Context, port: () => ForumToolsPort): ForumFixture {
  bindForumServices(ctx, port)
  const { agent, registered } = fakeAgent()
  return { registered, agent }
}

/** 按本地名取组件体登记的全名定义（exec 与名字无关，测试直呼无碍）
 * / a body-registered full-named definition by local name (execute ignores the name) */
function toolOf(fixture: ForumFixture, localName: string): AppTool {
  const found = fixture.registered.find((entry) => entry.name === `forum__${localName}`)
  if (found === undefined) throw new Error(`tool forum__${localName} was not registered by the page bodies`)
  return found.definition as AppTool
}

/**
 * 挂载真实页面组件（一次性渲染）并等首屏落地：正文是静态框（立即成型），
 * 首屏数据由组件体自己的 effect 异步读出、经 followup 送达——与生产同一条路，
 * 零工厂、零闭包注入。返回正文与首屏消息。
 * Mount a real page component (one-shot) and wait for the first screen to land:
 * the body is the static frame (finalized at once), the first-screen data is
 * read by the body's own effect and delivered via followup — the same path as
 * production, zero factory, zero closures. Returns the body plus the
 * first-screen messages.
 */
async function mountPage(
  component: (props: never, agent: never) => unknown,
  meta: ComponentPageMeta<never>,
  port: () => ForumToolsPort,
  params: PageParams = {},
): Promise<{ body: string; followups: string[] }> {
  const fixture = fakeAgent()
  const body = defineComponentPage(component as PageFC, meta as ComponentPageMeta).live.mount(params, fixture.agent)
  await vi.waitFor(() => expect(fixture.followups.length).toBeGreaterThan(0))
  return { body, followups: fixture.followups }
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
  port: () => ForumToolsPort
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
  return { ctx, fiber, apps, pageRegistry, port: () => ctx.forum.toolsPort() }
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

  it('page tools carry the forum__ external-name prefix (bodies register full names in the one render)', async () => {
    const { ctx, fiber, port } = await mount()
    const fixture = makeFixture(ctx, port)
    // 按页断言：入口页三件；详情页四件（inbox 两页都挂——处理主题的会话也要读通知）
    // / per-page asserts: the catalog page's three; the post page's four (inbox
    // rides both pages — a session working one post still reads its notices)
    const catalogRegistration = defineComponentPage(CatalogPage, CatalogMeta)
    catalogRegistration.live.mount({}, fixture.agent)
    expect(fixture.registered.map((entry) => entry.name)).toEqual(['forum__list', 'forum__post', 'forum__inbox'])
    const postRegistration = defineComponentPage(PostPage, PostMeta)
    postRegistration.live.mount({ postId: 'p-1' }, fixture.agent)
    expect(fixture.registered.slice(3).map((entry) => entry.name)).toEqual(['forum__read', 'forum__comment', 'forum__vote', 'forum__inbox'])

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
    const { ctx, fiber, port } = await mount()
    const fixture = makeFixture(ctx, port)
    // 两个组件体的登记动作把构建器产物带出来（execute 与名字无关）
    // / the bodies' registrations bring the builder products out (execute ignores the name)
    defineComponentPage(CatalogPage, CatalogMeta).live.mount({}, fixture.agent)
    defineComponentPage(PostPage, PostMeta).live.mount({ postId: 'p-1' }, fixture.agent)
    const boardId = (await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })).id

    // The page tool resolves the caller from the live Agent — no author
    // argument — and writes the same record set the host tools serve.
    // 页面工具从活 Agent 解析调用者——没有作者参数——并写入宿主工具所服务的同一份记录集合。
    const written = toolValue<{ value: { id: string } }>(
      await toolOf(fixture, 'post').execute({ title: 'from the page', body: 'body' }, { agent: AGENT }),
    )
    const listed = toolValue<{ posts: Array<{ id: string }> }>(
      await toolOf(fixture, 'list').execute({ boardId }, { agent: AGENT }),
    )
    expect(listed.posts.map((post) => post.id)).toContain(written.value.id)
    await expect(toolOf(fixture, 'post').execute({ title: 'x', body: 'y' }, {}))
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

describe('挂载 = 说明 两方可核对 / mount = instructions', () => {
  /** Pull the `forum__*` names an instruction text promises. 从说明文本里提取它承诺的 forum__* 工具名。 */
  function namedTools(text: string | undefined): Set<string> {
    return new Set(text?.match(/forum__[a-z_]+/g) ?? [])
  }

  /** The external names one page's body registers. 一个页面组件体登记的外部名。 */
  function registeredOf(fixture: ForumFixture, page: 'catalog' | 'post'): Set<string> {
    const before = fixture.registered.length
    void (page === 'catalog'
      ? defineComponentPage(CatalogPage, CatalogMeta).live.mount({}, fixture.agent)
      : defineComponentPage(PostPage, PostMeta).live.mount({ postId: 'p-1' }, fixture.agent))
    return new Set(fixture.registered.slice(before).map((entry) => entry.name))
  }

  it('每页说明点名的工具恰好等于该页组件体登记的工具（承诺 = 登记）', async () => {
    const { ctx, fiber, port } = await mount()
    const fixture = makeFixture(ctx, port)
    expect(namedTools(CatalogMeta.instructions)).toEqual(registeredOf(fixture, 'catalog'))
    expect(namedTools(PostMeta.instructions)).toEqual(registeredOf(fixture, 'post'))
    await fiber.dispose()
  })

  it('应用说明点名的工具都被某一页登记', async () => {
    const { ctx, fiber, port } = await mount()
    const fixture = makeFixture(ctx, port)
    registeredOf(fixture, 'catalog')
    registeredOf(fixture, 'post')
    const mounted = new Set(fixture.registered.map((entry) => entry.name))
    const named = namedTools(FORUM_APP_DEFINITION.instructions)
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) {
      expect(mounted.has(name), `${name} named by the app note must be registered on some page`).toBe(true)
    }

    await fiber.dispose()
  })

  it('收件箱工具两个页面都登记，首页如实声明写意图', async () => {
    const { apps, fiber } = await mount()

    const pages = apps.listPages(FORUM_APP_ID)
    const catalog = pages.find((page) => page.name === 'catalog')
    const post = pages.find((page) => page.name === 'post')
    expect(catalog?.writes).toBe(true)
    expect(post?.writes).toBe(true)

    await fiber.dispose()
  })
})

describe('§3.10 页面 = 信息 + 工具：首屏消息渲染真实记录，每行带 id / the first-screen message renders the real records, ids on every row', () => {
  it('入口页首屏消息渲染真实目录：板块/主题/人物行内带 id（组件体异步读、followup 送达）', async () => {
    const { ctx, fiber } = await mount()
    const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })
    await ctx.forum.toolsPort().publish({
      boardId: board.id, author: 'standard', title: '开版帖', body: '第一篇',
    })
    const fixture = makeFixture(ctx, () => ctx.forum.toolsPort())
    void fixture
    const { body, followups } = await mountPage(CatalogPage, CatalogMeta, () => ctx.forum.toolsPort())
    // 正文是静态框 / the body is the static frame
    expect(body).toContain('论坛 · 板块与主题列表')
    expect(body).toContain('随后以消息送达')
    // 首屏消息携带真实目录（板块行 id 是工具要用的 boardId）
    // / the first-screen message carries the real catalog (the board row's id is the tool's boardId)
    const screen = followups.join('\n')
    expect(screen).toContain('id: ws-1')
    expect(screen).toContain('开版帖（id:')
    expect(screen).toContain('作者 standard')
  })

  it('详情页首屏消息渲染该主题与评论树：评论行内 id 可作 parentCommentId/subjectId', async () => {
    const { ctx, fiber } = await mount()
    const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path: 'C:/work/demo' })
    const created = await ctx.forum.toolsPort().publish({
      boardId: board.id, author: 'standard', title: '被读的帖', body: '全文在这里',
    })
    await ctx.forum.toolsPort().comment({
      postId: created.value.id, author: 'ptc', body: '前排回复',
    })
    const { body, followups } = await mountPage(PostPage, PostMeta, () => ctx.forum.toolsPort(), { postId: created.value.id })
    expect(body).toContain(`论坛主题 ${created.value.id}`)
    const screen = followups.join('\n')
    expect(screen).toContain('被读的帖')
    expect(screen).toContain(`id: ${created.value.id}`)
    expect(screen).toContain('全文在这里')
    expect(screen).toContain('前排回复')
    // 评论行格式：作者（id: ...）：内容 / the comment row format: author (id: ...): body
    expect(screen).toContain('ptc（id:')
  })

  it('主题不存在：服务面拒绝原样随首屏消息送达（失败态也是信息）', async () => {
    const { ctx, fiber } = await mount()
    // 详情读会 reject（服务面的稳定拒绝）——拒绝消息必须原样进首屏消息
    // （code 面由 forum 包自己的工具测试锁定）。
    // / the detail read rejects (the service's stable refusal) — the refusal
    // must land verbatim in the first-screen message (the code face is locked
    // in the forum package's own tool tests).
    const { followups } = await mountPage(
      PostPage,
      PostMeta,
      () => ctx.forum.toolsPort(),
      { postId: 'p-missing' },
    )
    const screen = followups.join('\n')
    expect(screen).toContain('读取失败')
    expect(screen).toContain('no post with id "p-missing"')
  })

  it('说明指向正文行内 id：两页 instructions 都写明 id 取法', async () => {
    const { ctx, port } = await mount()
    const fixture = makeFixture(ctx, port)
    expect(CatalogMeta.instructions).toContain('行内')
    expect(CatalogMeta.instructions).toContain('id')
    expect(PostMeta.instructions).toContain('行内')
    expect(PostMeta.instructions).toContain('id')
  })
})
