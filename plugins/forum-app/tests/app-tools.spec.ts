/**
 * Composition specs — the page tools act on the real service, and the
 * mount = instructions doctrine holds: every tool a page's instructions name
 * is exactly the set its body registers, and every tool the app note names is
 * registered on some page.
 *
 * 组合测试——页面工具作用于真实服务，且「挂载 = 说明」两方可核对：每页说明
 * 点名的工具恰好等于该页组件体登记的工具，应用说明点名的每个工具都被某一页登记。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponentPage } from '@veren/prompt-page'
import { CatalogMeta, CatalogPage, PostMeta, PostPage } from '../src/pages.tsx'
import { FORUM_APP_DEFINITION, FORUM_APP_ID } from '../src/index.ts'
import { AGENT, disposeTrackedRoots, makeFixture, mount, toolOf, toolValue } from './helpers/app-mount.ts'
import type { ForumFixture } from './helpers/app-mount.ts'

afterEach(disposeTrackedRoots)

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

describe('挂载 = 说明 两方可核对 / mount = instructions', () => {
  /** Pull the tool names an instruction text promises: the `forum__*` page tools
   *  plus the page-scoped task trio (task_take/task_complete/task_fail, the
   *  delivery-report face whose names deliberately match the global face).
   *  从说明文本里提取它承诺的工具名：forum__* 页面工具 + 页面作用域 task 三件
   *  （投递回报面，名字刻意与全局面一致）。 */
  function namedTools(text: string | undefined): Set<string> {
    return new Set([...(text?.match(/forum__[a-z_]+/g) ?? []), ...(text?.match(/task_(?:take|complete|fail)\b/g) ?? [])])
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
