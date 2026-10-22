/**
 * 组件页管线（C5/§3.5）单元测试：defineComponentPage 的视图隔离、Markdown
 * 首帧与 PAGE-PATCH diff、ctx.effect/ctx.on 记账与 teardown、ctx.tools.register
 * 记录、useSnapshot 与 load 桥。
 * Component-page pipeline unit tests (C5/§3.5): defineComponentPage view
 * isolation, the Markdown first frame and PAGE-PATCH diff, ctx.effect/ctx.on
 * recording and teardown, ctx.tools.register recording, useSnapshot and the
 * load bridge.
 *
 * 本 spec 用 createElement（.ts 不走 JSX 转换）；JSX 形态由插件迁移的 .tsx
 * 页面与既有 jsx-runtime-pragma.spec 覆盖。
 * This spec uses createElement (a .ts file gets no JSX transform); the JSX form
 * is covered by the .tsx pages of the plugin migrations and the existing
 * jsx-runtime-pragma.spec.
 */
import { describe, expect, it } from 'vitest'
import { createElement, useState } from "@veren/prompt-core"
import { defineComponentPage, isMarkdownDocHost, useSnapshot } from '../src/index.ts'
import type { PageFC } from '../src/index.ts'

/** 假 cordis ctx：只实现组件页会碰到的面 / a fake cordis ctx: only the faces a component page touches */
function fakeCtx() {
  const subscriptions: Array<{ name: string; handler: (payload: unknown) => void }> = []
  const ctx = {
    on: (name: string, handler: (payload: unknown) => void) => {
      subscriptions.push({ name, handler })
      return () => {
        const index = subscriptions.findIndex((s) => s.name === name && s.handler === handler)
        if (index >= 0) subscriptions.splice(index, 1)
      }
    },
    emit: (name: string, payload?: unknown): void => {
      for (const s of [...subscriptions]) if (s.name === name) s.handler(payload)
    },
    tasks: {
      list: async () => [{ id: 'T-1', title: '任务一' }],
    },
  }
  return { ctx: ctx as never, subscriptions }
}

/** 视图测试所需的最小结构面 / the minimal structural face the view tests need */
interface ViewFace {
  host: unknown
  version: number
  syncText(cursor?: number): string
  unsubscribe(): void
  takeRecordedTools(): Array<{ name: string }>
  bodyText(): string
}

function viewOf<P extends Record<string, unknown>>(component: PageFC<P>, meta: Parameters<typeof defineComponentPage<P>>[1], params: P): { view: ViewFace; subscriptions: Array<{ name: string }> } {
  const { ctx, subscriptions } = fakeCtx()
  const registration = defineComponentPage(component, meta, ctx)
  const view = registration.live.mount({ ...params } as Record<string, string>) as unknown as ViewFace
  return { view, subscriptions }
}

describe('defineComponentPage 组件页管线', () => {
  it('首帧渲染 Markdown 正文：h1/p/ul/li 按 §3.2 映射', () => {
    const Page: PageFC<{ status?: string }> = (props) => {
      const [tasks] = useState([{ id: 'T-1', title: '修复登录' }, { id: 'T-2', title: '首页骨架' }])
      return createElement("div", { children: [
        createElement('h1', { children: ['任务列表', props.status ? ` · ${props.status}` : ''] }),
        createElement('p', { children: ['共 ', tasks.length, ' 条。'] }),
        createElement('ul', { children: tasks.map((t) =>
          createElement('li', { key: t.id, children: [createElement('strong', { children: t.id }), ' ', t.title] }),
        ) }),
      ] })
    }
    const { view } = viewOf(Page, { url: '/apps/tasks', description: '任务列表' }, {})
    expect(isMarkdownDocHost(view.host)).toBe(true)
    const body = isMarkdownDocHost(view.host) ? view.host.bodyText() : ''
    expect(body).toContain('# 任务列表')
    expect(body).toContain('共 2 条。')
    expect(body).toContain('- **T-1** 修复登录')
    expect(body).toContain('- **T-2** 首页骨架')
  })

  it('li 的多个行内子节点不重复拼接（逐子只序列化该节点自身）', () => {
    // 回归：逐子累加曾用"从该子起走整条兄弟链"的序列化，每个子都把后面的兄弟
    // 又串了一遍，正文出现 （notebook · active）（notebook · active）notebook ·
    // active）… 这样的重叠后缀。
    // Regression: per-child accumulation used the walk-the-whole-chain serializer,
    // so every child repeated the siblings that follow it and the body showed
    // overlapping suffixes.
    const Page: PageFC = () => createElement('ul', { children: [
      createElement('li', { key: 'notebook', children: ['notebook', '（', 'notebook', ' · ', 'active', '）'] }),
    ] })
    const { view } = viewOf(Page, { url: '/apps/demo', description: '演示' }, {})
    const body = isMarkdownDocHost(view.host) ? view.host.bodyText() : ''
    expect(body).toBe('- notebook（notebook · active）')
  })

  it('useState dispatch → PAGE-PATCH 只含变化单元（变化即补丁）', () => {
    let setDone: ((v: boolean) => void) | undefined
    const Page: PageFC = () => {
      const [done, set] = useState(false)
      setDone = set
      return createElement("div", { children: [
        createElement('h1', { children: '任务' }),
        createElement('ul', { children: [createElement('li', { key: 'T-1', children: done ? '已完成' : '进行中' })] }),
      ] })
    }
    const { view } = viewOf(Page, { url: '/apps/tasks', description: '任务' }, {})
    expect(view.syncText(0)).toBe('') // 首帧无 patch / no patch on the first frame
    setDone!(true)
    const patch = view.syncText(0)
    expect(patch).toContain('已完成')
    expect(patch).not.toContain('# 任务') // 未变的标题不重发 / the unchanged heading is not re-sent
  })

  it('keyed 单元消失 → removal 走删除线；ctx.on 订阅随 unsubscribe 清理', () => {
    let notify: (() => void) | undefined
    const Page: PageFC = (_props, ctx) => {
      const [rows, setRows] = useState([{ id: 'A' }, { id: 'B' }])
      ctx.effect(() => {
        notify = () => setRows((prev) => prev.slice(0, 1))
      })
      ctx.on('tasks/changed', () => undefined)
      return createElement('ul', { children: rows.map((r) => createElement('li', { key: r.id, children: r.id })) })
    }
    const { view, subscriptions } = viewOf(Page, { url: '/apps/tasks', description: '任务' }, {})
    expect(subscriptions).toHaveLength(1) // commit 后订阅真实生效 / the subscription is real after commit
    notify!()
    expect(view.syncText(0)).toContain('~~B~~')
    view.unsubscribe()
    expect(subscriptions).toHaveLength(0) // teardown 退订 / unsubscribed at teardown
  })

  it('会话作用域：effect/on 注册在 agent.ctx 上，视图退订提前清理（官方隔离模型）', () => {
    const owner = fakeCtx()
    // 假会话作用域：记录 effect/on 的注册与注销 / fake session scope: records effect/on registrations
    const scopeSubscriptions: Array<{ name: string; handler: (payload: unknown) => void }> = []
    const scopeEffects: Array<{ cleanup: () => void; label: string | undefined; disposed: boolean }> = []
    const scope = {
      on: (name: string, handler: (payload: unknown) => void) => {
        const entry = { name, handler }
        scopeSubscriptions.push(entry)
        return () => {
          const index = scopeSubscriptions.indexOf(entry)
          if (index >= 0) scopeSubscriptions.splice(index, 1)
        }
      },
      effect: (execute: () => (() => void) | void, label?: string) => {
        const result = execute()
        const entry = { cleanup: typeof result === 'function' ? result : () => undefined, label, disposed: false }
        scopeEffects.push(entry)
        return () => {
          if (entry.disposed) return
          entry.disposed = true
          entry.cleanup()
        }
      },
    }
    let cleanups = 0
    const Page: PageFC = (_props, ctx) => {
      ctx.effect(() => () => { cleanups++ })
      ctx.on('agent/status', () => undefined)
      return createElement('p', { children: 'scoped' })
    }
    const registration = defineComponentPage(Page, { url: '/apps/scoped', description: '作用域页' }, owner.ctx)
    const view = registration.live.mount({}, scope as never) as unknown as ViewFace
    // 事件订阅与 effect 都落在会话作用域，而不是创建者 ctx
    // / subscriptions and effects land on the session scope, not the creator ctx
    expect(owner.subscriptions).toHaveLength(0)
    expect(scopeSubscriptions.map((s) => s.name)).toEqual(['agent/status'])
    expect(scopeEffects).toHaveLength(1)
    // 视图早于 agent 退订：作用域订阅注销、清理提前执行一次
    // / the view tears down before the agent: the scope subscription is removed
    // and the cleanup runs once, early
    view.unsubscribe()
    expect(scopeSubscriptions).toHaveLength(0)
    expect(scopeEffects[0]?.disposed).toBe(true)
    expect(cleanups).toBe(1)
    view.unsubscribe()
    expect(cleanups).toBe(1)
  })

  it('ctx.effect 只运行一次；ctx.tools.register 按名去重', () => {
    let effectRuns = 0
    let run: (() => void) | undefined
    const Page: PageFC = (_props, ctx) => {
      ctx.effect(() => {
        effectRuns++
        run = () => {
          ctx.tools.register({ name: 'task_take', description: 'd', parameters: {}, output: { schema: {}, render: () => [] } } as never)
          ctx.tools.register({ name: 'task_take', description: 'd', parameters: {}, output: { schema: {}, render: () => [] } } as never)
        }
      })
      return createElement('p', { children: 'ok' })
    }
    const { view } = viewOf(Page, { url: '/apps/tasks', description: '任务' }, {})
    run!()
    expect(effectRuns).toBe(1)
    expect(view.takeRecordedTools().map((t) => t.name)).toEqual(['task_take'])
  })

  it('useSnapshot 读 meta.load 的首屏结果；每会话视图互不串台', async () => {
    let loadCount = 0
    const meta = {
      url: '/apps/tasks/:taskId',
      description: '任务详情',
      load: async (params: { taskId: string }) => {
        loadCount++
        return { id: params.taskId, seq: loadCount }
      },
    }
    const Page: PageFC<{ taskId: string }> = () => {
      const snap = useSnapshot<{ id: string; seq: number }>()
      return createElement('p', { children: `${snap?.id}#${snap?.seq}` })
    }
    const { ctx } = fakeCtx()
    const registration = defineComponentPage(Page, meta, ctx)
    // 真实时序（createPageSession 同款）：load 先跑 → live.mount 建视图 →
    // setSnapshot 下发 load 结果（组件重渲为正文）
    // / the real order (same as createPageSession): load runs first → live.mount
    // builds the view → setSnapshot pushes the result (the component re-renders it)
    const sinkOf = (view: unknown) => view as unknown as { setSnapshot(v: unknown): void }
    const dataA = await registration.page.load?.({ taskId: 'T-1' } as never, {})
    const viewA = registration.live.mount({ taskId: 'T-1' }) as unknown as ViewFace
    sinkOf(viewA).setSnapshot(dataA)
    const dataB = await registration.page.load?.({ taskId: 'T-2' } as never, {})
    const viewB = registration.live.mount({ taskId: 'T-2' }) as unknown as ViewFace
    sinkOf(viewB).setSnapshot(dataB)
    const bodyA = isMarkdownDocHost(viewA.host) ? viewA.host.bodyText() : ''
    const bodyB = isMarkdownDocHost(viewB.host) ? viewB.host.bodyText() : ''
    expect(bodyA).toContain('T-1#1')
    expect(bodyB).toContain('T-2#2')
    viewA.unsubscribe()
  })
})
