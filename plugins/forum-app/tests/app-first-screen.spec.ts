/**
 * Composition specs — §3.10 页面 = 信息 + 工具：首屏消息渲染真实记录，每行带
 * id。正文是静态框；首屏数据由组件体自己的 effect 异步读出、经 followup 送达
 * （失败态也是信息，拒绝原样进消息）。
 * Composition specs — §3.10 a page = information + tools: the first-screen
 * message renders the real records with ids on every row. The body is the
 * static frame; the first-screen data is read by the body's own effect and
 * delivered via followup (failures are information too — the refusal lands
 * verbatim in the message).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogMeta, CatalogPage, PostMeta, PostPage } from '../src/pages.tsx'
import { disposeTrackedRoots, makeFixture, mount, mountPage } from './helpers/app-mount.ts'

afterEach(disposeTrackedRoots)

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
