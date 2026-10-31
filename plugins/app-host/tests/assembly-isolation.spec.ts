/**
 * 隔离是真的：同一宿主两个会话的 agent 作用域互不可见（工具/事件/标题三个面）。
 * Isolation is real: two sessions on one host never see each other's agent
 * scopes (tools, events, and titles).
 * @module tests/assembly-isolation.spec
 */
import { describe, expect, it } from 'vitest'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, registerMiniApp } from './app-host.harness.ts'

describe('隔离是真的：同一宿主两个会话的 agent 作用域互不可见', () => {
  it('/task/1 与 /task/2 各自的作用域只看得到自己的工具；销毁 A 后 B 原样', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 打开即激活（H 根因修复）：两个会话的 agent 在 openUrl 内就被创建，
    // 各自的工具挂进各自的作用域，销毁 A 不影响 B
    const a = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/mini/task/2' as PageInstanceKey)
    expect(a.sessionId).not.toBe(b.sessionId)
    const scopeA = h.host.scopes.get(a.sessionId)
    const scopeB = h.host.scopes.get(b.sessionId)
    if (scopeA === undefined || scopeB === undefined) throw new Error('expected both agents to be created at open')
    // 各自作用域里恰好挂了一次页面工具（同名工具不互相覆盖、不串台）
    expect([...scopeA.registry.keys()]).toEqual(['mini__read', 'mini__write'])
    expect([...scopeB.registry.keys()]).toEqual(['mini__read', 'mini__write'])
    // 页面引导工具在页面作用域内被屏蔽（递归自开防护 + 作用域互斥）
    expect(scopeA.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // 作用域实例不同：A 的登记与 B 的登记是两个真实的、分开的表
    expect(scopeA.ctx).not.toBe(scopeB.ctx)
    // 销毁 A 的 agent（作用域随 fiber 注销）：A 工具消失，B 原样
    h.host.stopAgent(a.sessionId)
    expect(scopeA.registry.size).toBe(0)
    expect([...scopeB.registry.keys()]).toEqual(['mini__read', 'mini__write'])
  })

  it('打开即激活：openUrl 返回时 agent 已在场，页面工具已挂、PAGE 块已 followup、标题已落盘', async () => {
    const h = await boot()
    registerMiniApp(h)
    const focusEvents: Array<{ sessionId: string }> = []
    h.ctx.on('app-host/focus', (payload) => { focusEvents.push(payload) })
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scope.registry.keys()]).toEqual(['mini__read', 'mini__write']) // 工具只对该 agent 可见
    expect(scope.followups.some((m) => m.startsWith('PAGE mini/task'))).toBe(true) // PAGE 块（pageKey 名）经 followup 进入会话
    // instanceTitle 以 user source 的 session/title 落盘：侧栏按它显示
    const titles = h.sessions.get(opened.sessionId)?.titles ?? []
    expect(titles).toEqual([{ title: '任务页', messageSeqs: [], source: { kind: 'user' } }])
    // focus 端口真实实现：openUrl 结束时发了切界面事件
    expect(focusEvents).toEqual([{ sessionId: opened.sessionId }])
  })

  it('agent.ctx.on 挂在各自 agent 作用域：两个页面会话互不串事件（scopeTarget 过滤）', async () => {
    const h = await boot()
    const deliveries: string[] = []
    registerMiniApp(h, deliveries)
    const a = await h.pages.openUrl('/apps/mini/events/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/mini/events/2' as PageInstanceKey)
    const agentA = h.host.agentOf(a.sessionId)
    const agentB = h.host.agentOf(b.sessionId)
    if (agentA === undefined || agentB === undefined) throw new Error('expected both stable agents')
    agentEvents(h.ctx, agentA).emit('agent/status', { status: 'idle' })
    // 只有 A 会话的监听器收到；订阅若落在无标签 ctx，这里会是 2
    // / only A's listener fires; an untagged ctx subscription would make this 2
    expect(deliveries).toHaveLength(1)
    agentEvents(h.ctx, agentB).emit('agent/status', { status: 'idle' })
    expect(deliveries).toHaveLength(2)
  })
})
