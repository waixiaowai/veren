/**
 * 注册必须发生：宿主工具表里真能看到引导工具（第三轮真机失败的自动化收编），
 * 含先注册页面的回填镜像与 pageKey 命名空间。
 * Registration must happen: the host tool table really holds the bootstrap
 * tools (the automated absorption of the round-3 live failure), including the
 * mirror backfill for pages registered before the assembly and the pageKey
 * namespace.
 * @module tests/assembly-host-tools.spec
 */
import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createElement } from '@veren/prompt-core'
import type { AppId, PageKey } from '@veren/app-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import { wireAppHost } from '../src/index.ts'
import { boot, registerMiniApp } from './app-host.harness.ts'

describe('注册必须发生：宿主工具表里真能看到引导工具（第三轮真机失败的自动化收编）', () => {
  const TASK_TOOLS = ['task_list', 'task_get', 'task_take', 'task_complete', 'task_fail', 'task_cancel', 'task_split']

  it('装配完成后，app_list / app_pages / app_open 与 task_* 都在真实工具表里', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 这三个名字此前在生产装配里从未被注册（真机上模型只能 NO_APP_OPEN）——
    // 本断言堵住"写好了但没人调用"这类缺陷的回归通道。
    expect(h.host.hostTools.has('app_list')).toBe(true)
    expect(h.host.hostTools.has('app_pages')).toBe(true)
    expect(h.host.hostTools.has('app_open')).toBe(true)
    for (const name of TASK_TOOLS) expect(h.host.hostTools.has(name)).toBe(true)
  })

  it('装配整体卸载后，这三个工具一起从工具表里消失', async () => {
    const h = await boot()
    registerMiniApp(h)
    expect(h.host.hostTools.has('app_open')).toBe(true)
    // 卸载 app-host fiber：装配 disposer 逆序摘掉自己注册的工具行
    await h.disposeAssembly()
    expect(h.host.hostTools.has('app_list')).toBe(false)
    expect(h.host.hostTools.has('app_pages')).toBe(false)
    expect(h.host.hostTools.has('app_open')).toBe(false)
  })

  it('装配中途失败（工具注册行抛错）→ 已注册的工具行被逆序回滚摘掉', async () => {
    const h = await boot({ enabled: false, failTool: 'app_open' })
    registerMiniApp(h)
    // app_list / app_pages 先注册成功，app_open 抛错 → 整组回滚
    expect(() => wireAppHost(h.ctx)).toThrow('boom registering app_open')
    expect(h.host.hostTools.has('app_list')).toBe(false)
    expect(h.host.hostTools.has('app_pages')).toBe(false)
    expect(h.host.hostTools.has('app_open')).toBe(false)
    // 其余接缝同样回到"什么也没接"
    await expect(h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey))
      .rejects.toMatchObject({ code: 'page/host-unavailable' })
  })

  it('先于装配注册的页面被回填镜像：wireAppHost 后 openUrl 可解析（真机并发激活的收编）', async () => {
    const h = await boot({ enabled: false })
    // 真机 Loader 按 inject 就绪并发激活：应用插件可能先于装配注册页面
    // （彼时镜像未在 → 只告警不镜像）。装配必须回填，页面才对 openUrl 可见。
    registerMiniApp(h)
    wireAppHost(h.ctx)
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(opened.sessionId).toBeTypeOf('string')
  })

  it('两个应用的页面本地名同名（task/task）→ 都能被 openUrl 解析（pageKey 命名空间的收编）', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 第二个应用注册同名本地页：裸名登记会让它在 duplicate-name 上炸掉
    // （或在幂等检查里被别的应用顶掉）——真机上 notebook/list 与
    // task-workbench/list 正是这么互相吞掉的。
    // 夹具按 §3.10 合规：详情页是真正的 :param 页（旧夹具是字面量
    // /apps/twin/task/1 的"详情形态"页，本轮已清掉）。
    // The fixture is §3.10-compliant: the detail page is a real :param page (the
    // old fixture was a literal /apps/twin/task/1 "detail-shaped" page, removed
    // this round).
    const apps = h.ctx.apps
    apps.register({ id: 'twin' as AppId, name: 'twin', description: '同名页面应用', entry: 'list' as PageKey }, h.ctx)
    const twinPages = apps.pages('twin' as AppId, h.ctx)
    twinPages.register(
      () => createElement('p', { children: 'twin list' }),
      { url: '/apps/twin/list', description: '同名页列表', instructions: 'twin 首页。' },
    )
    twinPages.register(
      (_props: { taskId?: string }, agent) => {
        // 工具只在页面存在：组件体直登（设计律）/ a tool exists only inside a page: registered in the body (design law)
        agent.ctx.tools.register(defineTool({
          name: 'twin__read', description: '读取', parameters: {},
          output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
          execute: async () => ({}),
        }))
        return createElement('p', { children: 'twin task' })
      },
      { url: '/apps/twin/task/:taskId', description: '同名页', writes: true, instructions: '只处理这一条任务。' },
    )
    const a = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/twin/task/1' as PageInstanceKey)
    expect(a.sessionId).not.toBe(b.sessionId)
  })
})
