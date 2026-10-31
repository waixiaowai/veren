/**
 * Composition specs, discovery half: with the stack mounted exactly as the
 * host assembly does, the app is discoverable and active, the entry URL
 * resolves, every page URL lives under /apps/notebook/, the collected builders
 * carry the notebook__ prefix and act on the real service, registration is
 * single-entry, and teardown strips both sides.
 *
 * 组合测试的「可发现」半边：按真实宿主装配挂好全栈后，应用可发现且 active、入口 URL
 * 可解析、页面 URL 全在 /apps/notebook/ 下、收编的构建器带 notebook__ 前缀且作用于
 * 真实服务、单入口注册，且卸载两侧摘干净。
 */

import { describe, expect, it } from 'vitest'
import { APP_DEFINITION, APP_ID } from '../src/index.ts'
import { createAppTools } from '../src/app.ts'
import type { NoteSummary, NoteView } from '@veren/notebook'
import type { AppTool } from './app.harness.ts'
import { TOOL_NAMES, execution, mount, toolValue } from './app.harness.ts'

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
