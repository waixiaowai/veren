/**
 * Composition specs, page-information half: §3.9's promise alignment (catalog
 * = per-page mount = instructions naming), §3.10's complete first-screen
 * hand-over (registry-derived map, effect-driven first screen, honest
 * not-found), and the page-is-information-plus-tools frame.
 *
 * 组合测试的「页面信息」半边：§3.9 承诺对齐（目录 = 逐页挂载 = 说明点名）、§3.10 首屏
 * 信息给全（注册表推导的地图、effect 驱动的首屏、如实的找不到），以及「页面 = 信息 +
 * 工具」的正文框架。
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createAppTools } from '../src/app.ts'
import { buildPageTaskTools } from '@veren/task-center'
import { bindNotebookServices, ListMeta, ListPage, NoteMeta, NotePage } from '../src/pages.tsx'
import { defineComponentPage } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { APP_DEFINITION, APP_ID } from '../src/index.ts'
import type { NoteView } from '@veren/notebook'
import type { AppTool } from './app.harness.ts'
import { TOOL_NAMES, execution, fakeAgent, mount, mountPage, names, toolValue } from './app.harness.ts'

describe('§3.9 承诺对齐：登记 = 说明点名 / registration = instructions naming', () => {
  /** 两页组件体登记的本地名（一次性渲染的登记面）：先绑槽位再挂模块级组件
   * / local names the two bodies register (the one-shot face): bind the slot first, then mount the module-level components */
  function registeredLocal(ctx: Context, tools: readonly ToolDefinition[]) {
    bindNotebookServices(() => ctx.notebook.toolsPort(), tools, () =>
    buildPageTaskTools(() => ctx.taskCenter, {
      urlOfSession: async (sessionId: string) => {
        const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
        return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
      },
    }))
    const list = mountPage(ListPage, ListMeta, tools)
    const note = mountPage(NotePage, NoteMeta, tools)
    const local = (page: { registered: string[] }): string[] => page.registered.map((fullName) => fullName.split('__').pop() ?? fullName)
    return { list: local(list), note: local(note), listMeta: ListMeta, noteMeta: NoteMeta }
  }

  it('登记=目录：五个目录工具恰好被两页登记，且每工具恰好归属一页；task 三件两页同挂', async () => {
    const { ctx, fiber } = await mount()
    const tools = createAppTools(ctx, () => ctx.notebook.toolsPort())
    const { list, note } = registeredLocal(ctx, tools)
    // 登记面 = 工具面（目录工具）：不多收编、不少登记、不跨页重叠。
    // task_take/task_complete/task_fail 是页面作用域投递回报面（§6），刻意两页同挂、
    // 不在应用目录里（名字与宿主全局面一致）。
    // / The registered face equals the tool face for the CATALOG tools: nothing
    // extra, nothing missing, no catalog tool on two pages. The task trio is the
    // page-scoped delivery-report face (§6) — deliberately on both pages and not
    // in the app catalog (names match the host global face).
    const catalog = (names: readonly string[]) => names.filter((name) => !name.startsWith('task_'))
    const trio = (names: readonly string[]) => names.filter((name) => name.startsWith('task_')).sort()
    expect([...catalog(list), ...catalog(note)].sort()).toEqual([...TOOL_NAMES].sort())
    expect(new Set([...catalog(list), ...catalog(note)]).size).toBe(catalog(list).length + catalog(note).length)
    expect(trio(list)).toEqual(['task_complete', 'task_fail', 'task_take'])
    expect(trio(note)).toEqual(['task_complete', 'task_fail', 'task_take'])

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
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()), () =>
    buildPageTaskTools(() => ctx.taskCenter, {
      urlOfSession: async (sessionId: string) => {
        const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
        return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
      },
    }))
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
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()), () =>
    buildPageTaskTools(() => ctx.taskCenter, {
      urlOfSession: async (sessionId: string) => {
        const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
        return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
      },
    }))
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
    bindNotebookServices(() => ctx.notebook.toolsPort(), createAppTools(ctx, () => ctx.notebook.toolsPort()), () =>
    buildPageTaskTools(() => ctx.taskCenter, {
      urlOfSession: async (sessionId: string) => {
        const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
        return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
      },
    }))
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
