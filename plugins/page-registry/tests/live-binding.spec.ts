/**
 * 实时视图绑定（§3.10.3）的端口级行为：会话提交时 bind、废弃/回滚时 unbind、
 * 无绑定的页面保持静态、bind 失败走既有的两阶段回滚。
 * Port-level behavior of the live-view binding (§3.10.3): bind at commit,
 * unbind on deprecation/rollback, static pages stay untouched, and a bind
 * failure rides the existing two-phase rollback.
 */
import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, defineComponentPage } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import type { ComponentPageRegistration, InstanceKvPort, PageInstanceRecord, PageSession } from '@veren/prompt-page'
import { PageRegistryService } from '../src/index.ts'
import type { PageDataIdentity, PageDataPort, PageRuntimePorts, PageSessionPort } from '../src/runtime.ts'
import type { AppRecord } from '@veren/app-registry'

/** 权威 store 假件（ExternalStore<TaskItem[]> 同构）：可变、可订阅、引用稳定 */
/** The authoritative store fake (isomorphic to ExternalStore<TaskItem[]>): mutable, subscribable, stable references */
interface TaskItem { readonly id: string; readonly title: string }

function fakeStore(initial: TaskItem[]): {
  getState(): TaskItem[]
  subscribe(listener: () => void): () => void
  mutate(next: TaskItem[]): void
} {
  let items = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate(next) {
      items = next
      for (const listener of listeners) listener()
    },
  }
}

/** 实时视图端口假件：只记录 bind/unbind（视图订阅行为归 app-host 的枢纽测试） */
/** The live-view port fake: records only (the view-subscription side belongs to the app-host hub tests) */
function fakePageData() {
  const bound = new Map<string, { view: PageSession<never>; identity: PageDataIdentity }>()
  const unbound: string[] = []
  let failBind: Error | undefined
  const port: PageDataPort = {
    bind: (sessionId, view, identity) => {
      if (failBind !== undefined) throw failBind
      bound.set(sessionId, { view, identity })
    },
    // 端口契约：unbind 即解绑（与真实枢纽一致：条目移除 + 订阅退订由枢纽自证）
    // / Port contract: unbind removes the binding (the real hub also unsubscribes)
    unbind: (sessionId) => {
      bound.delete(sessionId)
      unbound.push(sessionId)
    },
  }
  return { port, bound, unbound, failBind: (error?: Error) => { failBind = error } }
}

/** 组件页（组件形态，RFC prompt-page-render §3.5）：订阅权威 store / the component page (subscribing to the authoritative store) */
function taskPage(store: { getState(): TaskItem[]; subscribe(listener: () => void): () => void }): ComponentPageRegistration {
  return defineComponentPage(
    () => createElement('ul', { children: store.getState().map((t) => createElement('li', { key: t.id, children: t.title })) }),
    { url: '/apps/demo/task/:id', description: '任务详情页', store },
  )
}

/** 会话端口假件（与 runtime.spec 同形，只记录）/ the session-port fake (same shape as runtime.spec, recording only) */
function fakeSessions() {
  const created: string[] = []
  const messages = new Map<string, string[]>()
  const released: string[] = []
  const destroyed: string[] = []
  const port: PageSessionPort = {
    exists: (id) => created.includes(id) && !destroyed.includes(id),
    mintId: () => `s-${created.length + 1}`,
    async create(id) { created.push(id); messages.set(id, []) },
    async appendUserMessage(id, text, source) { messages.get(id)?.push(`${source}::${text}`) },
    async mountTools() {},
    async releaseTools(id) { released.push(id) },
    async focus() {},
    async destroy(id) { destroyed.push(id) },
  }
  return { port, created, messages, released, destroyed }
}

/** 内存 KV（与 runtime.spec 同形）/ the in-memory KV (same shape as runtime.spec) */
function memKv(): InstanceKvPort & { readonly map: Map<string, PageInstanceRecord> } {
  const map = new Map<string, PageInstanceRecord>()
  return {
    map,
    get: (key) => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    del: async (key) => map.delete(key),
    all: () => [...map.values()],
  }
}

/** 组装服务 + 带实时绑定的页面 + 全部假件端口 / assemble the service, a live page, and fake ports */
function makeService(options: { pageData?: ReturnType<typeof fakePageData>; withLive?: boolean } = {}) {
  const ctx = new Context()
  const service = new PageRegistryService(ctx)
  const store = fakeStore([{ id: 't-1', title: '初始任务' }])
  const registration = taskPage(store)
  const dispose = options.withLive === false
    ? service.registerAppPage('demo', registration.page)
    : service.registerAppPage('demo', registration.page, registration.live)
  void dispose
  const sessions = fakeSessions()
  const app: AppRecord = {
    definition: { id: 'demo' as never, name: 'Demo', description: 'demo app', entry: 'task' as never },
    owner: 'test', version: '1.0.0', toolPrefix: 'demo', state: 'active',
  }
  const toolsOf = () => new Map([['read', defineTool({
    name: 'read', description: '读材料', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  })]])
  const pageData = options.pageData ?? fakePageData()
  const ports = {
    sessions: sessions.port,
    apps: { get: () => app },
    toolsOf,
    pageData: pageData.port,
  } satisfies PageRuntimePorts
  const kv = memKv()
  service.bindPorts(ports, new KvPageInstanceIndex(kv, { sessionExists: (id) => sessions.port.exists(id) }))
  return { service, store, sessions, pageData }
}

describe('实时视图端口（§3.10.3）：bind 随提交、unbind 随废弃/回滚', () => {
  it('①带 live 的页面打开 → bind 发生：视图已挂基线快照，身份带 pageKey 与规范 URL', async () => {
    const { service, pageData } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const entry = pageData.bound.get(opened.sessionId)
    expect(entry).toBeDefined()
    expect(entry?.identity.pageKey).toBe('demo/task')
    expect(entry?.identity.url).toBe('/apps/demo/task/1')
    // 视图是活的：初始基线已渲染（版本 > 0）
    // The view is alive: the initial baseline has rendered (version > 0)
    expect(entry?.view.host.currentVersion).toBeGreaterThan(0)
  })

  it('②同一 URL 重开 → 旧会话 unbind、新会话 bind；两个会话各持独立视图', async () => {
    const { service, pageData } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    const second = await service.openUrl('/apps/demo/task/1')
    expect(pageData.unbound).toEqual([first.sessionId])
    expect(pageData.bound.has(first.sessionId)).toBe(false)
    expect(pageData.bound.has(second.sessionId)).toBe(true)
    expect(pageData.bound.get(second.sessionId)?.view).not.toBe(pageData.bound.get(first.sessionId)?.view)
  })

  it('③未带 live 的页面打开 → 端口零调用（静态页面路径不受影响）', async () => {
    const { service, pageData } = makeService({ withLive: false })
    await service.openUrl('/apps/demo/task/1')
    expect(pageData.bound.size).toBe(0)
    expect(pageData.unbound).toHaveLength(0)
  })

  it('④bind 失败 → 走既有回滚：会话销毁、工具摘除、openUrl 原样抛错', async () => {
    const pageData = fakePageData()
    pageData.failBind(new Error('hub exploded'))
    const { service, sessions } = makeService({ pageData })
    await expect(service.openUrl('/apps/demo/task/1')).rejects.toThrow('hub exploded')
    expect(sessions.destroyed).toHaveLength(1)
    expect(sessions.released).toHaveLength(1)
    // 回滚里也解绑（幂等；失败发生在 bind 内部，unbind 不该再炸）
    // The rollback also unbinds (idempotent; the failure happened inside bind)
    expect(pageData.unbound).toHaveLength(1)
  })
})
