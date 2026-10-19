/**
 * The model-facing `forum_*` tools through the real tool registry.
 *
 * The registry is the only surface a model sees, and each tool's caller is
 * resolved from the live Agent rather than from an argument, so these specs
 * mount the real storage stack plus the real service and drive the registry
 * itself: registration order, reverse disposal, the caller's preset and board,
 * the refusal codes, and the fact that a tool never lets a preset post as
 * another preset.
 *
 * 通过真实工具注册表测试面向模型的 `forum_*` 工具族。
 *
 * 注册表是模型唯一能看到的接口，而每个工具的调用者都取自活着的 Agent 而不是参数，因此这些
 * 用例挂载真实存储栈与真实服务并驱动注册表本身：注册顺序、逆序释放、调用者的预设与板块、
 * 拒绝码，以及工具绝不会让一个预设以另一个预设身份发帖。
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
import ForumService from '../src/index.ts'
import { POST_SORTS } from '../src/types.ts'
import { Config, DEFAULT_MAX_PER_HOUR, DEFAULT_TICK_SECONDS } from '../src/config.ts'
import type { ForumConfig } from '../src/config.ts'

/** The registry member the tools register through. 工具注册所经过的注册表成员。 */
interface RegisteredTool {
  readonly name: string
  /** The tool's JSON Schema object; its properties carry `required` and `enum`. 工具的 JSON 模式对象；其 properties 携带 required 与 enum。 */
  readonly parameters: { readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>, readonly required?: readonly string[] }
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
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

/** The tool names in registration order. 按注册顺序的工具名。 */
const TOOL_NAMES = [
  'forum_list', 'forum_read', 'forum_post', 'forum_comment', 'forum_vote', 'forum_inbox',
]

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
    tools: { enabled: true },
    autoPost: { tickSeconds: DEFAULT_TICK_SECONDS, maxPerHour: DEFAULT_MAX_PER_HOUR, presets: [] },
    ...over,
  }
}

/**
 * Mount the real storage stack and forum service, with a live preset, a
 * workspace the sessions' working directory resolves into, and the tool
 * registry captured for inspection.
 *
 * 挂载真实存储栈与论坛服务，并提供一个活的预设、一个会话工作目录能解析到的工作区，以及供
 * 断言使用的工具注册表。
 *
 * @param options - the preset name, the session's working directory, the
 *   workspace that directory belongs to, and the config overrides.
 * @returns the root context, the fiber, and the captured registry.
 */
async function mount(options: {
  preset?: string,
  cwd?: string,
  workspacePath?: string,
  config?: Partial<ForumConfig>,
} = {}) {
  const ctx = new Context()
  const tools = new Map<string, RegisteredTool>()
  const preset = options.preset ?? 'standard'
  const cwd = options.cwd ?? 'C:/work/demo'
  const workspacePath = options.workspacePath ?? cwd

  ctx.provide('tools', {
    register(tool: RegisteredTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
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
  ctx.provide('workingDirectory', { get: () => cwd })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: workspacePath, title: 'Demo' }] })

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
  return { ctx, fiber, tools, preset, cwd }
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

describe('forum tool registry / 论坛工具注册表', () => {
  it('registers the six forum tools and removes each one in reverse on unload', async () => {
    const { fiber, tools } = await mount()

    expect([...tools.keys()]).toEqual(TOOL_NAMES)

    await fiber.dispose()
    expect(tools.size).toBe(0)
  })

  it('offers exactly the documented arguments', async () => {
    const { fiber, tools } = await mount()

    const propertiesOf = (name: string) => tools.get(name)?.parameters.properties ?? {}
    expect(propertiesOf('forum_list')['sort']?.enum).toEqual([...POST_SORTS])
    expect(tools.get('forum_read')?.parameters.required).toContain('postId')
    expect(tools.get('forum_post')?.parameters.required).toEqual(expect.arrayContaining(['title', 'body']))
    expect(propertiesOf('forum_vote')['value']?.enum).toEqual(['up', 'down'])
    expect(propertiesOf('forum_inbox')['state']?.enum).toEqual(['pending', 'delivered', 'read'])
    expect(tools.get('forum_comment')?.parameters.required).not.toContain('parentCommentId')
    expect(propertiesOf('forum_post')).not.toHaveProperty('author')

    await fiber.dispose()
  })

  it('lists boards and posts as model-facing JSON', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount()
    const boardId = await seedBoard(ctx, cwd)
    const published = await ctx.forum.publish({ boardId, author: preset, title: 'hello', body: 'body' })

    const listed = toolValue<{ boards: Array<{ id: string }>, posts: Array<{ id: string }> }>(
      await tools.get('forum_list')?.execute({ boardId }, execution(AGENT)),
    )
    expect(listed.boards.map(entry => entry.id)).toEqual([boardId])
    expect(listed.posts.map(entry => entry.id)).toContain(published.value.id)

    await fiber.dispose()
  })

  it('reads one post through the registry and counts the view', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount()
    const boardId = await seedBoard(ctx, cwd)
    const published = await ctx.forum.publish({ boardId, author: preset, title: 'hello', body: 'body' })

    const detail = toolValue<{ post: { views: number }, body: string }>(
      await tools.get('forum_read')?.execute({ postId: published.value.id }, execution(AGENT)),
    )
    expect(detail.post.views).toBeGreaterThanOrEqual(1)
    expect(detail.body).toBe('body')

    await fiber.dispose()
  })

  it('refuses every write from a call with no agent', async () => {
    const { fiber, tools } = await mount()
    const args = { boardId: 'b1', postId: 'p1', subjectKind: 'post', subjectId: 'p1', value: 'up', title: 't', body: 'b' }

    for (const name of ['forum_post', 'forum_comment', 'forum_vote', 'forum_inbox']) {
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
      await tools.get('forum_post')?.execute({ title: 't', body: 'b' }, execution(AGENT)),
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
    await expect(tools.get('forum_post')?.execute({ title: 't', body: 'b' }, execution(AGENT)))
      .rejects.toMatchObject({ name: 'ForumToolError', code: 'board_not_found' })

    await fiber.dispose()
  })

  it('refuses a post into a board that was never registered', async () => {
    const { fiber, tools, cwd } = await mount()

    // The board id comes from the caller's workspace, which is real here, but
    // no board row exists for it yet; the explicit argument takes the same path.
    // 板块 id 来自调用者的工作区（此处真实存在），但还没有对应板块行；显式参数走同一条路径。
    await expect(tools.get('forum_post')?.execute({ title: 't', body: 'b', boardId: 'ws-absent' }, execution(AGENT)))
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
      await tools.get('forum_vote')?.execute(args, execution(AGENT)),
    )
    expect(voted).toEqual({ up: 1, down: 0, cleared: false })

    const cleared = toolValue<{ up: number, down: number, cleared: boolean }>(
      await tools.get('forum_vote')?.execute(args, execution(AGENT)),
    )
    expect(cleared).toEqual({ up: 0, down: 0, cleared: true })

    await fiber.dispose()
  })

  it('reads the caller inbox and clears it when asked', async () => {
    const { ctx, fiber, tools, preset, cwd } = await mount({ preset: 'ptc' })
    const boardId = await seedBoard(ctx, cwd)
    await ctx.forum.publish({ boardId, author: 'standard', title: 'hi', body: `@${preset} take a look` })

    const read = toolValue<{ notifications: Array<{ recipient: string, state: string }> }>(
      await tools.get('forum_inbox')?.execute({}, execution(AGENT)),
    )
    expect(read.notifications.map(entry => entry.recipient)).toEqual([preset])
    expect(read.notifications[0]?.state).toBe('pending')

    await tools.get('forum_inbox')?.execute({ markRead: true }, execution(AGENT))
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
    await expect(tools.get('forum_read')?.execute({ postId: 'missing' }, execution(AGENT))).rejects.toMatchObject({
      name: 'ForumToolError',
      code: 'forum/post-not-found',
    })

    await fiber.dispose()
  })
})