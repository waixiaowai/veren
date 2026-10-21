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
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ForumApp from '../src/index.ts'
import { Config as AppConfig, FORUM_APP_DEFINITION, FORUM_APP_ID } from '../src/index.ts'
import { catalogPage, postPage } from '../src/pages.tsx'
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
  const hostFiber = ctx.plugin(ForumService, HostConfig({
    tools: { enabled: true },
  }) as Parameters<typeof HostConfig>[0])
  await hostFiber

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
    await mount()
    for (const page of [catalogPage, postPage]) {
      expect(page.url.startsWith('/apps/forum/')).toBe(true)
      expect(page.pageRevision).toBeGreaterThanOrEqual(1)
      expect('preset' in page).toBe(false)
    }
    expect(postPage.url).toBe('/apps/forum/post/:postId')
    expect(postPage.instanceTitle?.({ postId: '12' })).toBe('主题 #12')
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
