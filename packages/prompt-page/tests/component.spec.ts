/**
 * 组件页管线（一次性渲染形态）单元测试：defineComponentPage 的契约映射、
 * 唯一一次渲染、Markdown 成型（§3.2 映射）、组件体经 agent.ctx 直登工具/
 * effect/on。load 与 useSnapshot 已退役——首屏读取是组件体自己的生命周期
 * （effect 发起、followup 送达），本文件锁定"挂载不经手任何数据"。
 * Component-page pipeline unit tests (the one-shot form): defineComponentPage's
 * contract mapping, the exactly-once render, Markdown shaping (the §3.2
 * mapping), body registrations via agent.ctx (tools/effect/on). load and
 * useSnapshot are retired — the first-screen read is the body's own lifecycle
 * (started by an effect, delivered by a followup); this file locks in "the
 * mount touches no data".
 *
 * 本 spec 用 createElement（.ts 不走 JSX 转换）；JSX 形态由插件迁移的 .tsx
 * 页面与既有 jsx-runtime-pragma.spec 覆盖。
 * This spec uses createElement (a .ts file gets no JSX transform); the JSX form
 * is covered by the .tsx pages of the plugin migrations and the existing
 * jsx-runtime-pragma.spec.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from "@veren/prompt-core"
// 类型-only：拉取 ctx.tools 的 declaration merging（假 agent 的工具面由此获得类型）
// / type-only: pulls the ctx.tools merge (types the fake agent's tool face)
import type {} from '@deepseek-ai/dsh-tools'
import { defineComponentPage, isComponentPageRegistration } from '../src/index.ts'
import type { PageFC } from '../src/index.ts'

/**
 * 假会话 agent：ctx.tools.register / ctx.effect / ctx.on 记录登记——页面体拿到的
 * agent 就是它（原样，不扩展）。
 * A fake session agent: ctx.tools.register / ctx.effect / ctx.on record their
 * registrations — the agent the body receives IS this object (as-is, no extension).
 */
function fakeAgent() {
  const registered: Array<{ name: string }> = []
  const effects: Array<{ label: string | undefined; ran: boolean; dispose: () => void }> = []
  const subscriptions: Array<{ name: string }> = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push({ name: definition.name })
          return () => undefined
        },
      },
      effect: (run: () => (() => void) | void, label?: string) => {
        const entry = { label, ran: true, dispose: () => undefined }
        run()
        effects.push(entry)
        return async () => undefined
      },
      on: (name: string, _handler: (payload: unknown) => void) => {
        subscriptions.push({ name })
        return () => undefined
      },
    },
    session: { id: 'agent-1' },
  }
  return { agent: agent as never, registered, effects, subscriptions }
}

/** 最小挂载面：defineComponentPage 的 live.mount 返回正文 Markdown（两参，无快照）
 * / the minimal mount face: live.mount returns the body markdown (two params, no snapshot) */
function mountOf<P extends Record<string, unknown>>(
  component: PageFC<P>,
  meta: Parameters<typeof defineComponentPage<P>>[1],
  params: P,
  agent: unknown,
): string {
  const registration = defineComponentPage(component, meta)
  return registration.live.mount({ ...params } as Record<string, string>, agent as never)
}

describe('defineComponentPage 一次性渲染管线', () => {
  it('唯一一次渲染成型 Markdown 正文：h1/p/ul/li 按 §3.2 映射', () => {
    let runs = 0
    const Page: PageFC<{ status?: string }> = (props) => {
      runs++
      const tasks = [{ id: 'T-1', title: '修复登录' }, { id: 'T-2', title: '首页骨架' }]
      return createElement("div", { children: [
        createElement('h1', { children: ['任务列表', props.status ? ` · ${props.status}` : ''] }),
        createElement('p', { children: ['共 ', tasks.length, ' 条。'] }),
        createElement('ul', { children: tasks.map((t) =>
          createElement('li', { key: t.id, children: [createElement('strong', { children: t.id }), ' ', t.title] }),
        ) }),
      ] })
    }
    const body = mountOf(Page, { url: '/apps/tasks', description: '任务列表' }, {}, fakeAgent().agent)
    expect(runs).toBe(1) // 体恰好执行一次 / the body runs exactly once
    expect(body).toContain('# 任务列表')
    expect(body).toContain('共 2 条。')
    expect(body).toContain('- **T-1** 修复登录')
    expect(body).toContain('- **T-2** 首页骨架')
  })

  it('li 的多个行内子节点不重复拼接（逐子只序列化该节点自身）', () => {
    // 回归：逐子累加曾用"从该子起走整条兄弟链"的序列化，每个子都把后面的兄弟
    // 又串了一遍，正文出现 （notebook · active）（notebook · active）… 的重叠后缀。
    // Regression: per-child accumulation once walked the whole sibling chain per
    // child, so every child repeated the siblings after it — overlapping suffixes.
    const Page: PageFC = () => createElement('ul', { children: [
      createElement('li', { key: 'notebook', children: ['notebook', '（', 'notebook', ' · ', 'active', '）'] }),
    ] })
    const body = mountOf(Page, { url: '/apps/demo', description: '演示' }, {}, fakeAgent().agent)
    expect(body).toBe('- notebook（notebook · active）')
  })

  it('工具经 agent.ctx.tools.register 直登：全名原样、体只登记一次', () => {
    const { agent, registered } = fakeAgent()
    const Page: PageFC = (_props, agentInBody) => {
      agentInBody.ctx.tools.register({ name: 'task_workbench__take_task', description: 'd', parameters: {}, output: { schema: {}, render: () => [] } } as never)
      agentInBody.ctx.tools.register({ name: 'task_workbench__complete_task', description: 'd', parameters: {}, output: { schema: {}, render: () => [] } } as never)
      return createElement('p', { children: 'ok' })
    }
    mountOf(Page, { url: '/apps/tasks', description: '任务' }, {}, agent)
    // 挂载方不经手定义：登记面就是组件体直呼的那两笔，全名原样
    // / the mounter never handles definitions: the face is exactly the body's
    // two registrations, full names untouched
    expect(registered.map((tool) => tool.name)).toEqual(['task_workbench__take_task', 'task_workbench__complete_task'])
  })

  it('agent.ctx.effect 在挂载时执行（清理随 agent 的约定不变；首屏读由此发起）', () => {
    const { agent, effects } = fakeAgent()
    const Page: PageFC = (_props, agentInBody) => {
      ;(agentInBody.ctx.effect as (run: () => void, label?: string) => unknown)(() => undefined, 'page:first-screen')
      return createElement('p', { children: 'ok' })
    }
    mountOf(Page, { url: '/apps/effects', description: '效果页' }, {}, agent)
    expect(effects).toHaveLength(1)
    expect(effects[0]?.label).toBe('page:first-screen')
  })

  it('契约映射：name 缺省取 URL 末段、writes/instanceTitle 适配进 PageDefinition；meta 无任何行为钩子', () => {
    const registration = defineComponentPage(
      (() => createElement('p', { children: 'ok' })) as PageFC,
      {
        url: '/apps/demo/task/:taskId',
        description: '详情',
        writes: true,
        instanceTitle: (params) => `任务 #${params.taskId}`,
      },
    )
    expect(isComponentPageRegistration(registration)).toBe(true)
    expect(registration.page.name).toBe('task')
    expect(registration.page.url).toBe('/apps/demo/task/:taskId')
    expect(registration.page.writes).toBe(true)
    expect(registration.page.instanceTitle?.({ taskId: 'T-1' })).toBe('任务 #T-1')
    // load 已退役：契约面上没有任何宿主经手的取数钩子
    // / load is retired: the contract face carries no host-mediated data hook
    expect('load' in registration.page).toBe(false)
    expect('load' in registration.live).toBe(false)
  })

  it('mount 不收快照：二参签名，挂载不经手任何数据', () => {
    // 回归锁：mount(params, agent)——第三参（首屏快照）随 load 一起删除，
    // 防止宿主经手取数的旧路悄悄回来。
    // / Regression lock: mount(params, agent) — the third parameter (the
    // first-screen snapshot) died with load, so the old host-mediated data
    // path cannot sneak back.
    const registration = defineComponentPage(
      (() => createElement('p', { children: 'ok' })) as PageFC,
      { url: '/apps/demo', description: '演示' },
    )
    expect(registration.live.mount.length).toBe(2)
  })
})
