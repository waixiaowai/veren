/**
 * The forum tool builders driven against the real service.
 *
 * The builders are the one implementation the application layer registers, and
 * each tool's caller is resolved from the live Agent rather than from an
 * argument, so these specs mount the real storage stack plus the real service,
 * build the six definitions through the builders over the service's own tools
 * port, and drive `execute` directly: the app-local names, the caller's preset
 * and board, the refusal codes, the fact that a tool never lets a preset post
 * as another preset — and that the service itself registers nothing into
 * `ctx.tools`.
 *
 * 直驱真实服务的论坛工具构建器测试。
 *
 * 构建器是应用层注册的唯一实现，而每个工具的调用者都取自活着的 Agent 而不是参数，因此这些
 * 用例挂载真实存储栈与真实服务，用构建器配服务自己的工具端口造出六个定义并直驱 `execute`：
 * 应用本地名、调用者的预设与板块、拒绝码、工具绝不会让一个预设以另一个预设身份发帖——以及
 * 服务自己绝不向 `ctx.tools` 注册任何东西。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ForumService from '../src/index.ts'
import {
  buildForumCommentDefinition, buildForumInboxDefinition, buildForumListDefinition,
  buildForumPostDefinition, buildForumReadDefinition, buildForumVoteDefinition,
} from '../src/tools.ts'
import { POST_SORTS } from '../src/types.ts'
import { Config, DEFAULT_MAX_PER_HOUR, DEFAULT_TICK_SECONDS } from '../src/config.ts'
import type { ForumConfig } from '../src/config.ts'

/** The minimal execution face the specs drive (methods stay bivariant; a fake stands in for the host exec). 用例驱动的最小执行面（方法签名保持双变，宿主 exec 由假实现顶替）。 */
interface RegisteredTool {
  readonly name: string
  /** The tool's JSON Schema object; its properties carry `required` and `enum`. 工具的 JSON 模式对象；其 properties 携带 required 与 enum。 */
  readonly parameters: { readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>, readonly required?: readonly string[] }
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
}

/** Tests drive execute only: narrow to the minimal face once. 测试只走 execute：收窄到最小执行面（唯一断言点）。 */
function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
}

/**
 * The canonical value one tool call returns.
 *
 * `execute` hands back the tool's own canonical JSON value; the registry is what
 * renders it into model-facing content blocks, so these specs assert on the
 * value the tool produced and leave rendering to the registry's own suites.
 *
 * 一次工具调用返回的规范值。
 *
 * `execute` 交回工具自己的规范 JSON 值；把它渲染成面向模型的内容块是注册表的工作，因此
 * 这些用例断言工具产出的值，渲染由注册表自己的套件覆盖。
 */
function toolValue<T>(result: unknown): T {
  return result as T
}

/** The app-local names in the collector's order. 收编清单顺序里的应用本地名。 */
const TOOL_NAMES = ['list', 'read', 'post', 'comment', 'vote', 'inbox']

/**
 * The live Agent a tool reads its caller from.
 *
 * The tools resolve the caller through `ctx.agentPresets.composedPreset` and
 * `ctx.workingDirectory.get`, so any non-null value stands for a running
 * Agent; the specs supply the minimal slice those two readers touch.
 *
 * 工具读取调用者所依据的活 Agent。
 *
 * 工具通过 `ctx.agentPresets.composedPreset` 与 `ctx.workingDirectory.get` 解析调用者，因此
 * 任何非空值都代表一个运行中的 Agent；这些用例提供那两个读取者触及的最小切片。
 */
const AGENT = {
  ctx: {},
  session: { header: { agentPreset: 'standard' } },
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forum-tools-'))
  roots.push(root)
  return root
}

/**
 * Config with the auto-post runner off; the specs drive tools, not the timer.
 * Every field is spelled out: the schema resolves defaults the way the plugin
 * manager would, and these specs pin the values they depend on.
 *
 * 关闭自动发帖运行的配置；这些用例驱动工具而非定时器。逐字段写明：模式按插件管理器的方式
 * 解析默认值，而这些用例钉住自己依赖的值。
 */
function config(over: Partial<ForumConfig> = {}): ForumConfig {
  return {
    autoPost: { tickSeconds: DEFAULT_TICK_SECONDS, maxPerHour: DEFAULT_MAX_PER_HOUR, presets: [] },
    panelUrl: '',
    ...over,
  }
}

/**
 * Mount the real storage stack and forum service, with a live preset, a
 * workspace the sessions' working directory resolves into, and the six builder
 * products built over the service's tools port.
 *
 * 挂载真实存储栈与论坛服务，并提供一个活的预设、一个会话工作目录能解析到的工作区，以及
 * 用服务工具端口构建出的六个构建器产物。
 *
 * @param options - the preset name, the session's working directory, the
 *   workspace that directory belongs to, and the config overrides.
 * @returns the root context, the fiber, the drivable tools, and the captured
 *   `ctx.tools` registry (which must stay empty).
 */
async function mount(options: {
  preset?: string,
  cwd?: string,
  workspacePath?: string,
  config?: Partial<ForumConfig>,
} = {}) {
  const ctx = new Context()
  const registered = new Map<string, RegisteredTool>()
  const preset = options.preset ?? 'standard'
  const cwd = options.cwd ?? 'C:/work/demo'
  const workspacePath = options.workspacePath ?? cwd

  // A spy registry: the service must leave it empty (the G2 contract below
  // pins it) while the specs drive the builder products directly.
  // 侦探注册表：服务必须让它一直空着（下面的 G2 契约钉死），用例则直驱构建器产物。
  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      registered.set(tool.name, tool)
      return () => { registered.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('systemPrompt', { context: () => () => {} })
  ctx.provide('agentPresets', {
    list: async () => [{ id: preset, name: preset }],
    composedPreset: () => preset,
  })
  ctx.provide('llm', {})
  // Declared hard injects of the service (G13): provide the minimal slice each
  // reader touches; the drafting selection stays unconfigured here.
  // 服务的声明的硬 inject（G13）：提供各读取者触及的最小切片；起草用的默认模型在此不配置。
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  ctx.provide('workingDirectory', { get: () => cwd })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: workspacePath, title: 'Demo' }] })
  // The application framework is deliberately NOT provided (G2): the host no
  // longer declares `apps`, so this mount IS the framework-absent deployment —
  // the service below must activate and wait for nothing. The dedicated specs
  // at the bottom pin that contract.
  // 刻意不提供应用框架（G2）：宿主不再声明 `apps`，因此这个挂载就是框架缺席的部署——
  // 下面的服务必须照常激活、不等待任何东西。文件底部的专项用例钉死该契约。
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  // Config 是 Standard Schema，不是 Plugin.Transform：传配置要经 Config() 解析出
  // 运行时形态（补齐默认值），否则注册表按 schema 校验原始输入并拒绝。
  // Config is a Standard Schema, not a Plugin.Transform: resolve the config
  // through Config() first so defaults are filled and the registry accepts it.
  const resolved = Config(config(options.config) as Parameters<typeof Config>[0])
  const fiber: Fiber = ctx.plugin(ForumService, resolved)
  await fiber

  // Build the six definitions through the builders over the service's own
  // port — the exact objects the application layer registers.
  // 用构建器配服务自己的端口造出六个定义——正是应用层登记的那批对象。
  const port = () => ctx.forum.toolsPort()
  const tools = new Map<string, RegisteredTool>([
    ['list', drivable(buildForumListDefinition(ctx, port))],
    ['read', drivable(buildForumReadDefinition(ctx, port))],
    ['post', drivable(buildForumPostDefinition(ctx, port))],
    ['comment', drivable(buildForumCommentDefinition(ctx, port))],
    ['vote', drivable(buildForumVoteDefinition(ctx, port))],
    ['inbox', drivable(buildForumInboxDefinition(ctx, port))],
  ])
  return { ctx, fiber, tools, registered, preset, cwd }
}

/**
 * The execution context one tool call carries.
 *
 * The registry always passes it, so the specs do too: `agent` is the live Agent
 * the caller's preset and working directory are read from, and its absence is
 * the one refusal a tool reports as `no_caller`.
 *
 * 一次工具调用携带的执行上下文。注册表总会传入它，因此这些用例也传：其中的 `agent` 就是
 * 读取调用者预设与工作目录的活 Agent，它缺席时工具报告 `no_caller`。
 */
function execution(agent: unknown): { agent: unknown } {
  return { agent }
}

/** Register one board the tools can post into. 登记一个工具可发帖的板块。 */
async function seedBoard(ctx: Context, path = 'C:/work/demo'): Promise<string> {
  const board = await ctx.forum.ensureBoardRemote({ workspaceId: 'ws-1', path })
  return board.id
}

describe('forum tool builders / 论坛工具构建器', () => {
  it('builds exactly the six app-local tools and registers nothing globally', async () => {
    const { fiber, tools, registered } = await mount()

    expect([...tools.keys()]).toEqual(TOOL_NAMES)
    // The service registered nothing into ctx.tools — the global `forum_*`
    // face is gone; only the application layer registers.
    // 服务没有向 ctx.tools 注册任何东西——全局 `forum_*` 面已退役；只有应用层注册。
    expect(registered.size).toBe(0)

    await fiber.dispose()
    expect(registered.size).toBe(0)
  })

  it('offers exactly the documented arguments', async () => {
    const { fiber, tools } = await mount()

    const propertiesOf = (name: string) => tools.get(name)?.parameters.properties ?? {}
    expect(propertiesOf('list')['sort']?.enum).toEqual([...POST_SORTS])
    expect(tools.get('read')?.parameters.required).toContain('postId')
    expect(tools.get('post')?.parameters.required).toEqual(expect.arrayContaining(['title', 'body']))
    expect(propertiesOf('vote')['value']?.enum).toEqual(['up', 'down'])
    expect(propertiesOf('inbox')['state']?.enum).toEqual(['pending', 'delivered', 'read'])
    expect(tools.get('comment')?.parameters.required).not.toContain('parentCommentId')
    expect(propertiesOf('post')).not.toHaveProperty('author')

    await fiber.dispose()
  })

  it('lists boards and posts as model-facing JSON', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount()
    const boardId = await seedBoard(ctx, cwd)
    const published = await ctx.forum.publish({ boardId, author: preset, title: 'hello', body: 'body' })

    const listed = toolValue<{ boards: Array<{ id: string }>, posts: Array<{ id: string }> }>(
      await tools.get('list')?.execute({ boardId }, execution(AGENT)),
    )
    expect(listed.boards.map(entry => entry.id)).toEqual([boardId])
    expect(listed.posts.map(entry => entry.id)).toContain(published.value.id)

    await fiber.dispose()
  })

  it('reads one post and counts the view', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount()
    const boardId = await seedBoard(ctx, cwd)
    const published = await ctx.forum.publish({ boardId, author: preset, title: 'hello', body: 'body' })

    const detail = toolValue<{ post: { views: number }, body: string }>(
      await tools.get('read')?.execute({ postId: published.value.id }, execution(AGENT)),
    )
    expect(detail.post.views).toBeGreaterThanOrEqual(1)
    expect(detail.body).toBe('body')

    await fiber.dispose()
  })

  it('refuses every write from a call with no agent', async () => {
    const { fiber, tools } = await mount()
    const args = { boardId: 'b1', postId: 'p1', subjectKind: 'post', subjectId: 'p1', value: 'up', title: 't', body: 'b' }

    for (const name of ['post', 'comment', 'vote', 'inbox']) {
      await expect(tools.get(name)?.execute(args, execution(undefined)), name).rejects.toMatchObject({
        name: 'ForumToolError',
        code: 'no_caller',
      })
    }

    await fiber.dispose()
  })

  it('publishes as the caller preset and pins the resolved board', async () => {
    const { ctx, fiber, tools, cwd } = await mount({ preset: 'ptc' })
    const boardId = await seedBoard(ctx, cwd)

    // The caller's preset and board come from the live Agent and its working
    // directory, so a tool call publishes as 'ptc' without either as an argument.
    // 调用者的预设与板块取自活着的 Agent 及其工作目录，因此调用时无需以参数传入即以 'ptc' 发帖。
    const written = toolValue<{ value: { id: string } }>(
      await tools.get('post')?.execute({ title: 't', body: 'b' }, execution(AGENT)),
    )

    const stored = await ctx.forum.catalog({ boardId })
    const row = stored.posts.find(post => post.id === written.value.id)
    expect(row?.author).toBe('ptc')
    expect(row?.boardId).toBe(boardId)

    await fiber.dispose()
  })

  it('refuses a post with no board rather than guessing one', async () => {
    const { fiber, tools } = await mount({ cwd: 'C:/work/demo', workspacePath: 'C:/work/other' })

    // The working directory resolves to no workspace, so there is no board to
    // post in; the tool names the argument instead of inventing one.
    // 工作目录没有解析到工作区，因此没有可发板块；工具报出参数名而不是自行编造。
    await expect(tools.get('post')?.execute({ title: 't', body: 'b' }, execution(AGENT)))
      .rejects.toMatchObject({ name: 'ForumToolError', code: 'board_not_found' })

    await fiber.dispose()
  })

  it('refuses a post into a board that was never registered', async () => {
    const { fiber, tools, cwd } = await mount()

    // The board id comes from the caller's workspace, which is real here, but
    // no board row exists for it yet; the explicit argument takes the same path.
    // 板块 id 来自调用者的工作区（此处真实存在），但还没有对应板块行；显式参数走同一条路径。
    await expect(tools.get('post')?.execute({ title: 't', body: 'b', boardId: 'ws-absent' }, execution(AGENT)))
      .rejects.toMatchObject({ name: 'ForumToolError', code: 'forum/board-not-found' })
    expect(cwd).toBe('C:/work/demo')

    await fiber.dispose()
  })

  it('records one attitude per preset and takes it back on a repeat', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount()
    const boardId = await seedBoard(ctx, cwd)
    const published = await ctx.forum.publish({ boardId, author: preset, title: 'hello', body: 'body' })
    const args = { subjectKind: 'post', subjectId: published.value.id, value: 'up' }

    const voted = toolValue<{ up: number, down: number, cleared: boolean }>(
      await tools.get('vote')?.execute(args, execution(AGENT)),
    )
    expect(voted).toEqual({ up: 1, down: 0, cleared: false })

    const cleared = toolValue<{ up: number, down: number, cleared: boolean }>(
      await tools.get('vote')?.execute(args, execution(AGENT)),
    )
    expect(cleared).toEqual({ up: 0, down: 0, cleared: true })

    await fiber.dispose()
  })

  it('reads the caller inbox and clears it when asked', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount({ preset: 'ptc' })
    const boardId = await seedBoard(ctx, cwd)
    await ctx.forum.publish({ boardId, author: 'standard', title: 'hi', body: `@${preset} take a look` })

    const read = toolValue<{ notifications: Array<{ recipient: string, state: string }> }>(
      await tools.get('inbox')?.execute({}, execution(AGENT)),
    )
    expect(read.notifications.map(entry => entry.recipient)).toEqual([preset])
    expect(read.notifications[0]?.state).toBe('pending')

    await tools.get('inbox')?.execute({ markRead: true }, execution(AGENT))
    const after = await ctx.forum.inbox({ recipient: preset })
    expect(after.every(entry => entry.state !== 'pending')).toBe(true)

    await fiber.dispose()
  })

  it('reports a structured forum refusal rather than an internal failure', async () => {
    const { fiber, tools } = await mount()

    // A missing post is a `forum/post-not-found` refusal carried through the
    // tool's stable code; an internal storage failure would surface as the
    // generic `internal_error` instead.
    // 帖子不存在是 `forum/post-not-found` 拒绝，并经工具的稳定 code 上报；内部存储故障则
    // 只会表现为通用的 `internal_error`。
    await expect(tools.get('read')?.execute({ postId: 'missing' }, execution(AGENT))).rejects.toMatchObject({
      name: 'ForumToolError',
      code: 'forum/post-not-found',
    })

    await fiber.dispose()
  })
})

describe('framework-absent deployment (G2 package split) / 框架缺席的部署（G2 拆包）', () => {
  /**
   * Capture every logger line emitted while one mount settles, so the specs
   * can prove the activation raised no inject/wait warning at all.
   * 捕获一次挂载稳定期间产生的每一条日志，用例据此证明激活过程没有产生任何注入等待告警。
   */
  async function mountWatchingLogs(options?: Parameters<typeof mount>[0]): Promise<{
    mounted: Awaited<ReturnType<typeof mount>>
    lines: string[]
  }> {
    const lines: string[] = []
    const warn = console.warn
    const error = console.error
    console.warn = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
    console.error = (line: unknown, ...rest: unknown[]) => { lines.push([line, ...rest].map(String).join(' ')) }
    try {
      const mounted = await mount(options)
      return { mounted, lines }
    } finally {
      console.warn = warn
      console.error = error
    }
  }

  it('activates the host with no app framework present and no inject warning', async () => {
    const { mounted, lines } = await mountWatchingLogs()
    const { ctx, fiber } = mounted

    // The framework really is absent: no `apps` service exists on this context.
    // 框架确实缺席：此上下文上不存在 `apps` 服务。
    expect(ctx.get('apps')).toBeUndefined()
    // The host activated anyway: the service face answers and [Service.init] ran.
    // 宿主照样激活：服务面可用，[Service.init] 已执行。
    expect(ctx.forum).toBeDefined()

    await fiber.dispose()
    expect(lines).toHaveLength(0)
  })

  it('registers no model-facing tool of its own', async () => {
    const { mounted } = await mountWatchingLogs({ preset: 'ptc' })
    const { ctx, fiber, registered, cwd } = mounted

    // Headless deployments keep the durable service — boards, posts, the
    // Remote namespace, the notices — but no agent sees a forum tool until the
    // application layer mounts one into a page session.
    // headless 部署保留持久化服务——板块、主题、远端命名空间与通知——但在应用层把工具
    // 挂进页面会话之前，没有任何 agent 能看到论坛工具。
    const boardId = await seedBoard(ctx, cwd)
    const catalog = await ctx.forum.catalog({ boardId })
    expect(catalog.boards.map((board) => board.id)).toEqual([boardId])
    expect(registered.size).toBe(0)

    await fiber.dispose()
    expect(registered.size).toBe(0)
  })
})
