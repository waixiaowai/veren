/**
 * The forum tool builders driven against the real service.
 *
 * The builders are the one implementation the application layer registers, and
 * each tool's caller is resolved from the live Agent rather than from an
 * argument, so these specs drive `execute` directly: the app-local names, the
 * caller's preset and board, the refusal codes, and the fact that a tool never
 * lets a preset post as another preset.
 *
 * 直驱真实服务的论坛工具构建器测试。
 *
 * 构建器是应用层注册的唯一实现，而每个工具的调用者都取自活着的 Agent 而不是参数，因此这些
 * 用例直驱 `execute`：应用本地名、调用者的预设与板块、拒绝码，以及工具绝不会让一个预设以
 * 另一个预设身份发帖。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { POST_SORTS } from '../src/types.ts'
import {
  AGENT, disposeTrackedRoots, execution, mount, seedBoard, TOOL_NAMES, toolValue,
} from './helpers/tools-mount.ts'

afterEach(disposeTrackedRoots)

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
