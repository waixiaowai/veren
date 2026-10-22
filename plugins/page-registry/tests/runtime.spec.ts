import { describe, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, PageError, defineComponentPage, deprecatedRowKey, useSnapshot } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import type { InstanceKvPort, PageJsonValue } from '@veren/prompt-page'
import type { PageInstanceRecord } from '@veren/prompt-page'
import PageRegistryPlugin, { PAGE_LOAD_TIMEOUT_MS, PageRegistryService } from '../src/index.ts'
import { externalToolName } from '../src/runtime.ts'
import type { MountedTool, PageRuntimePorts, PageSessionPort } from '../src/runtime.ts'
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'

/** 内存 KV（与 app-pages 域表同形），可跨"重启"复用 */
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

/** 会话端口假件：记录创建/挂载/释放/销毁，可注入失败。
 *  releaseTools 真的把挂载记录摘掉——废弃语义（旧会话工具摘干净）由此可断言。 */
function fakeSessions() {
  const created: string[] = []
  const titles = new Map<string, string>()
  const messages = new Map<string, string[]>()
  const mounted = new Map<string, MountedTool[]>()
  const released: string[] = []
  const focused: string[] = []
  const destroyed: string[] = []
  let failCreate: Error | undefined
  let failMount: Error | undefined
  const port: PageSessionPort = {
    exists: (id) => created.includes(id) && !destroyed.includes(id),
    mintId: () => `s-${created.length + 1}`,
    async create(id, title) {
      if (failCreate) throw failCreate
      created.push(id)
      titles.set(id, title)
      messages.set(id, [])
    },
    async appendUserMessage(id, text, source) { messages.get(id)?.push(`${source}::${text}`) },
    async mountTools(id, tools) {
      if (failMount) throw failMount
      mounted.set(id, [...tools])
    },
    async releaseTools(id) {
      mounted.delete(id)
      released.push(id)
    },
    async focus(id) { focused.push(id) },
    async destroy(id) { destroyed.push(id) },
  }
  return {
    port, created, titles, messages, mounted, released, focused, destroyed,
    fail: (e?: Error) => { failCreate = e }, failMount: (e?: Error) => { failMount = e },
  }
}

function taskPage() {
  const items = [{ id: 't-1', title: '九' }]
  const store = { getState: () => items, subscribe: () => () => undefined }
  const registration = defineComponentPage(
    (props: { id?: string }) => createElement('p', { children: `任务 #${props.id ?? '?'}` }),
    {
      url: '/apps/demo/task/:id',
      description: '任务详情页',
      tools: ['read'],
      instructions: '先读材料，再作答。',
      instanceTitle: (params) => `任务 #${params.id ?? '?'}`,
      store,
    },
  )
  return { ...registration, store }
}

/** 组装一个带应用/工具/任务假件的注册表服务 */
function makeService(options: {
  appState?: 'active' | 'disabled' | 'broken'
  withApps?: boolean
  tasks?: { take: (id: string, claim: unknown) => Promise<unknown> }
  presetOf?: (sessionId: string) => string | undefined
  /** app 假件的兄弟页投影（map 推导的事实源）/ the app fake's sibling projection (the fact source for map derivation) */
  siblings?: ReadonlyArray<{ name: string; url: string; description: string }>
} = {}) {
  const ctx = new Context()
  const service = new PageRegistryService(ctx)
  const task = taskPage()
  const dispose = service.registerAppPage('demo', task.page, task.live)
  const kv = memKv()
  const sessions = fakeSessions()
  // 端口全部是纯参数（G13）：app 假件是完整 AppRecord / the app fake is a full AppRecord
  const app: AppRecord = {
    definition: { id: 'demo' as never, name: 'Demo', description: 'demo app', entry: 'task' as never },
    owner: 'test',
    version: '1.0.0',
    toolPrefix: 'demo',
    state: options.appState ?? 'active',
    pages: new Map([
      ['task', { url: '/apps/demo/task/:id', description: '任务详情页', component: true }],
      ...(options.siblings ?? []).map((s): [string, { url: string; description: string; component: boolean }] => [s.name, { url: s.url, description: s.description, component: true }]),
    ]),
  }
  // 目录值就是 DSH ToolDefinition 本体（defineTool 产物）/ the catalog value IS a DSH ToolDefinition
  const toolsOf = () => new Map([['read', defineTool({
    name: 'read', description: '读材料', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  })]])
  const ports = {
    sessions: sessions.port,
    apps: options.withApps === false ? { get: () => undefined } : { get: () => app },
    toolsOf,
    ...(options.tasks === undefined ? {} : { tasks: { take: (id: never, claim: never) => options.tasks!.take(String(id), claim) as Promise<TaskRecord> } }),
    ...(options.presetOf === undefined ? {} : { presetOf: options.presetOf }),
  } satisfies PageRuntimePorts
  service.bindPorts(ports, new KvPageInstanceIndex(kv, { sessionExists: (id) => sessions.port.exists(id) }))
  return { service, kv, sessions, ports, dispose }
}

describe('页面运行时：打开 URL 一律新建，旧会话废弃（§3.5.3、§9.1）', () => {
  it('①同一 URL 连开两次 → 两条不同会话；索引指向后一条，前一条状态为废弃', async () => {
    const { service, kv, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    const second = await service.openUrl('/apps/demo/task/1')
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(sessions.created).toEqual([first.sessionId, second.sessionId])
    // 索引（URL 键）指向最新的那条活会话
    expect(kv.map.get('/apps/demo/task/1')?.state).toBe('live')
    expect(kv.map.get('/apps/demo/task/1')?.sessionId).toBe(second.sessionId)
    // 前一条挪进废弃历史：状态 deprecated、可按 sessionId 找回
    const old = kv.map.get(deprecatedRowKey(first.sessionId))
    expect(old?.state).toBe('deprecated')
    expect(old?.sessionId).toBe(first.sessionId)
    expect(old?.deprecatedAt).toBeTypeOf('string')
  })

  it('②旧会话的页面工具已摘干净；新会话的工具不受影响', async () => {
    const { service, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    expect(sessions.mounted.get(first.sessionId)).toHaveLength(1)
    const second = await service.openUrl('/apps/demo/task/1')
    // 旧会话：工具整组摘除（released 记录 + mounted 表清空）
    expect(sessions.released).toEqual([first.sessionId])
    expect(sessions.mounted.has(first.sessionId)).toBe(false)
    // 新会话：自己的一套，完好
    expect(sessions.mounted.get(second.sessionId)).toHaveLength(1)
    // 新会话的 PAGE 块照写；旧会话不再追加任何块
    expect((sessions.messages.get(second.sessionId) ?? []).some((m) => m.startsWith('app/page::'))).toBe(true)
    expect(sessions.messages.get(first.sessionId)).toHaveLength(1)
  })

  it('/task/1 与 /task/2 互不干扰；重开 /task/1 只废弃 /task/1 的旧会话', async () => {
    const { service, kv, sessions } = makeService()
    const a = await service.openUrl('/apps/demo/task/1')
    const b = await service.openUrl('/apps/demo/task/2')
    expect(a.sessionId).not.toBe(b.sessionId)
    const a2 = await service.openUrl('/apps/demo/task/1')
    expect(a2.sessionId).not.toBe(a.sessionId)
    // 只有 /task/1 的旧会话被废弃；/task/2 的会话原样保留
    expect(kv.map.get(deprecatedRowKey(a.sessionId))?.state).toBe('deprecated')
    expect(kv.map.get('/apps/demo/task/2')?.sessionId).toBe(b.sessionId)
    expect(sessions.released).toEqual([a.sessionId])
  })

  it('会话标题：instanceTitle(params) 写进会话标题与索引（§3.6.1）', async () => {
    const { service, kv, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    expect(sessions.titles.get(opened.sessionId)).toBe('任务 #1')
    expect(kv.map.get('/apps/demo/task/1')?.instanceTitle).toBe('任务 #1')
  })

  it('PAGE 块随新会话写一次，呈 §3.3 骨架：pageKey + 规范 URL / tools（带用途）/ 说明 / Markdown 正文（无 params/data JSON 行）', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const blocks = sessions.messages.get(opened.sessionId) ?? []
    expect(blocks).toHaveLength(1)
    const block = blocks[0] ?? ''
    expect(block.startsWith('app/page::PAGE demo/task /apps/demo/task/1')).toBe(true)
    expect(block).not.toContain('params:')
    expect(block).not.toContain('data:')
    expect(block).toContain('tools: demo__read（读材料）')
    expect(block).toContain('先读材料，再作答。')
    expect(block).toContain('任务 #1')
  })

  it('能力地图由注册表推导进 PAGE 块：兄弟页"模板 → description"逐条成行，模型可照抄（§3.5 定案）', async () => {
    // map 不再手写：app 假件的 pages 投影就是事实源（排除自身、按注册序）
    const { service, sessions } = makeService({
      siblings: [
        { name: 'publish', url: '/apps/demo/publish', description: '要发布新任务时打开发布页' },
      ],
    })
    const opened = await service.openUrl('/apps/demo/task/1')
    const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
    expect(block).toContain('map:（能力地图')
    expect(block).toContain('- /apps/demo/publish → 要发布新任务时打开发布页')
    expect(block).not.toContain('- /apps/demo/task/:taskId')
  })

  it('单页应用不画 map 行（无兄弟页 → 推导为空，不给模型"隐藏出口"的想象空间）', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
    expect(block).not.toContain('map:')
  })

  it('首屏 load：结果经 useSnapshot 由组件渲染为正文（§3.10.3 组件页语义）', async () => {
    const { service, sessions } = makeService()
    const registration = defineComponentPage(
      () => {
        const snap = useSnapshot<{ id: string; lines: string[] }>()
        return createElement('p', { children: [snap?.id, ...(snap?.lines ?? [])].join(' ') })
      },
      {
        url: '/apps/demo/brief/:briefId', description: '简报页',
        instructions: '只读这份简报。',
        load: async (params) => ({ id: params.briefId, lines: ['a', 'b'] }),
      },
    )
    const dispose = service.registerAppPage('demo', registration.page, registration.live)
    try {
      const opened = await service.openUrl('/apps/demo/brief/7')
      const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
      expect(block).toContain('7 a b')
    } finally { dispose() }
  })

  it('首屏 load 的 env 带页面会话的预设 id（PageLoadEnv.preset），组件可把它渲染进正文', async () => {
    const { service, sessions } = makeService({ presetOf: (sessionId) => `preset-of-${sessionId}` })
    const registration = defineComponentPage(
      () => {
        const snap = useSnapshot<{ preset: string | null }>()
        return createElement('p', { children: `preset=${snap?.preset ?? 'null'}` })
      },
      {
        url: '/apps/demo/brief/:briefId', description: '简报页',
        instructions: '只读这份简报。',
        load: async (_params, env) => ({ preset: env.preset ?? null }),
      },
    )
    const dispose = service.registerAppPage('demo', registration.page, registration.live)
    try {
      const opened = await service.openUrl('/apps/demo/brief/7')
      const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
      expect(block).toContain('preset=preset-of-s-1')
    } finally { dispose() }
  })

  it('首屏 load 抛错 → 失败态进组件、由组件渲染为正文（page/load-failed + 重试指引），不静默空白', async () => {
    const { service, sessions } = makeService()
    const registration = defineComponentPage(
      () => {
        const snap = useSnapshot<{ error?: { code: string; message: string }; retry?: string }>()
        return createElement('pre', { children: JSON.stringify(snap) })
      },
      {
        url: '/apps/demo/brief/:briefId', description: '简报页',
        instructions: '只读这份简报。',
        load: async () => { throw new Error('boom') },
      },
    )
    const dispose = service.registerAppPage('demo', registration.page, registration.live)
    try {
      const opened = await service.openUrl('/apps/demo/brief/7')
      const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
      expect(block).toContain('page/load-failed')
      expect(block).toContain('boom')
      expect(block).toContain('重开本页 URL')
    } finally { dispose() }
  })

  it('首屏 load 超时 → 失败态进组件（§3.10.3 的超时兜底），会话照常建成', async () => {
    vi.useFakeTimers()
    try {
      const { service, sessions } = makeService()
      const registration = defineComponentPage(
        () => {
          const snap = useSnapshot<{ error?: { message: string } }>()
          return createElement('pre', { children: JSON.stringify(snap) })
        },
        {
          url: '/apps/demo/slow/:snap', description: '慢页',
          instructions: '慢慢读。',
          load: () => new Promise(() => {}),
        },
      )
      const dispose = service.registerAppPage('demo', registration.page, registration.live)
      try {
        const opening = service.openUrl('/apps/demo/slow/1')
        await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS + 1)
        const opened = await opening
        const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
        expect(block).toContain('page/load-failed')
        expect(block).toContain('timed out')
      } finally { dispose() }
    } finally { vi.useRealTimers() }
  })

  it('索引指向的会话被删除后：行失效并重建新会话', async () => {
    const { service, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    sessions.destroyed.push(first.sessionId) // 模拟用户删除会话
    const reopened = await service.openUrl('/apps/demo/task/1')
    expect(reopened.sessionId).not.toBe(first.sessionId)
    expect(sessions.created).toHaveLength(2)
  })

  it('④重启后：索引仍指向最新那条活会话，旧会话不会被误当活的', async () => {
    const first = makeService()
    const opened = await first.service.openUrl('/apps/demo/task/1')
    // "重启"：新服务 + 新索引实例 + 同一份 KV；宿主恢复了会话目录（旧会话还在）
    const second = makeService()
    for (const [key, value] of first.kv.map) second.kv.map.set(key, value)
    second.sessions.created.push(opened.sessionId) // 重启后宿主恢复的旧会话
    const reopened = await second.service.openUrl('/apps/demo/task/1')
    // 不再复用：新建一条；索引改指新会话；旧会话落废弃历史
    expect(reopened.sessionId).not.toBe(opened.sessionId)
    expect(second.kv.map.get('/apps/demo/task/1')?.sessionId).toBe(reopened.sessionId)
    expect(second.kv.map.get(deprecatedRowKey(opened.sessionId))?.state).toBe('deprecated')
    // 废弃历史跨重启可查：旧行不会重新变成活会话
    expect(second.kv.map.has('/apps/demo/task/1')).toBe(true)
  })

  it('reserved 阶段失败（建会话抛错）：清理半成品、删行、码 page/session-create-failed', async () => {
    const { service, kv, sessions } = makeService()
    sessions.fail(new Error('disk full'))
    await expect(service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'page/session-create-failed' })
    expect(kv.map.size).toBe(0) // 不留幽灵索引
    expect(sessions.created).toHaveLength(0) // 半成品会话不存在
  })

  it('挂工具失败（tool-conflict）：销毁半成品会话 + 删 reserved 行（§5.6）', async () => {
    const { service, kv, sessions } = makeService()
    sessions.failMount(new PageError('page/tool-conflict', 'name taken'))
    await expect(service.openUrl('/apps/demo/task/1')).rejects.toMatchObject({ code: 'page/tool-conflict' })
    expect(sessions.destroyed).toHaveLength(1)
    expect(kv.map.size).toBe(0)
  })

  it('废弃标记写失败：整步中止，旧会话仍是索引里的活会话（下次打开重试）', async () => {
    const { service, kv, sessions, ports } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    // 只破坏废弃路径：换一个 deprecate 会抛的索引（端口整体重传，纯参数）
    const failing = new KvPageInstanceIndex(kv)
    failing.deprecate = async () => { throw new Error('disk full') }
    service.bindPorts(ports, failing)
    await expect(service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'page/index-unavailable' })
    // 收敛：没有新会话、没有半成品，URL 仍指向旧会话
    expect(sessions.created).toEqual([first.sessionId])
    expect(kv.map.get('/apps/demo/task/1')?.sessionId).toBe(first.sessionId)
  })
})

describe('app_open 错误路径（稳定码）', () => {
  it('应用未注册 → app/not-found；应用被禁用 → app/disabled', async () => {
    const missing = makeService({ withApps: false })
    await expect(missing.service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'app/not-found' })
    const disabled = makeService({ appState: 'disabled' })
    await expect(disabled.service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'app/disabled' })
  })

  it('应用升级（页面定义换新）：打开不再拒绝，直接新建会话（§9.1）', async () => {
    const fresh = makeService()
    const old = await fresh.service.openUrl('/apps/demo/task/1')
    // 应用升级：旧页面定义摘除，新定义注册——没有升级分叉，直接新建
    fresh.dispose()
    fresh.service.register((taskPage() as unknown as { page: never }).page)
    const opened = await fresh.service.openUrl('/apps/demo/task/1')
    expect(opened.sessionId).not.toBe(old.sessionId)
    expect(fresh.sessions.created).toHaveLength(2) // 旧会话废弃、新会话建成
  })

  it('URL 未命中任何页面 → page/not-found', async () => {
    const { service } = makeService()
    await expect(service.openUrl('/apps/demo/missing/1'))
      .rejects.toMatchObject({ code: 'page/not-found' })
  })
})

describe('任务闭环（§5.3：先 take 再追加 TASK 块）', () => {
  it('task take 被调用且 TASK 块追加到目标会话；lease 带上 sessionId', async () => {
    const taken: Array<{ id: string; claim: unknown }> = []
    const { service, sessions } = makeService({
      tasks: { take: async (id, claim) => { taken.push({ id, claim }); return { title: `任务 ${id}` } } },
    })
    const opened = await service.openUrl('/apps/demo/task/1', { taskId: 't-42' })
    expect(taken).toEqual([{ id: 't-42', claim: { sessionId: opened.sessionId, actor: 'local', leaseUntil: expect.any(String) } }])
    const blocks = sessions.messages.get(opened.sessionId) ?? []
    expect(blocks.some((block) => block.startsWith('app/task::TASK t-42 任务 t-42'))).toBe(true)
  })

  it('③旧会话持任务时被废弃 → 租约释放 → 新会话可正常接取', async () => {
    const taken: string[] = []
    const released: string[] = []
    const { service, sessions, ports } = makeService({
      tasks: { take: async (id, claim) => { taken.push(id); return { title: `任务 ${id}`, claim } } },
    })
    // 注入真实的释放面：记录被释放租约的持有会话（端口整体重传，纯参数）
    service.bindPorts({ ...ports, releaseLeases: async (sessionId) => { released.push(sessionId) } })
    const first = await service.openUrl('/apps/demo/task/1', { taskId: 't-1' })
    expect(taken).toEqual(['t-1'])
    // 旧会话持有 t-1 的租约时，同 URL 重开：废弃会话释放租约，新会话再次接取成功
    const second = await service.openUrl('/apps/demo/task/1', { taskId: 't-1' })
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(released).toEqual([first.sessionId])
    expect(taken).toEqual(['t-1', 't-1']) // 新会话拿到任务，没有被 already-taken 挡住
    // TASK 块写进了新会话，而不是废弃的旧会话
    expect((sessions.messages.get(second.sessionId) ?? []).some((m) => m.startsWith('app/task::TASK t-1'))).toBe(true)
  })

  it('任务过期：错误码 task/expired 原样透出，页面会话已建成但不写 TASK 块', async () => {
    const { service, sessions } = makeService({
      tasks: { take: async () => { throw new PageError('task/expired', 'task t-9 expired') } },
    })
    await expect(service.openUrl('/apps/demo/task/1', { taskId: 't-9' }))
      .rejects.toMatchObject({ code: 'task/expired' })
    const opened = await service.openUrl('/apps/demo/task/1')
    expect((sessions.messages.get(opened.sessionId) ?? []).every((block) => !block.startsWith('app/task::'))).toBe(true)
  })

  it('索引不可用：openUrl 给 page/index-unavailable，不假成功', async () => {
    const ctx = new Context()
    const service = new PageRegistryService(ctx)
    service.register((taskPage() as unknown as { page: never }).page)
    // 端口齐备但 bindPorts 不传索引 → UnavailableIndex（fail loud，不假成功）
    service.bindPorts({ sessions: fakeSessions().port, apps: { get: () => ({ definition: { id: 'demo' as never, name: 'Demo', description: 'd', entry: 'task' as never }, owner: 'test', version: '1.0.0', toolPrefix: 'demo', state: 'active' }) }, toolsOf: () => new Map() })
    await expect(service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'page/index-unavailable' })
  })
})

describe('应用作用域注册（§3.1：对接 ctx.apps.pages(id)）', () => {
  it('registerAppPage：URL 必须在 /apps/<appId>/ 下；错前缀 fail loud', () => {
    const { service } = makeService()
    const wrong = taskPage()
    expect(() => service.registerAppPage('demo', { ...wrong, url: '/task/:id' } as never))
      .toThrow(/must register under/)
    expect(() => service.registerAppPage('demo', { ...wrong, url: '/apps/other/task/:id' } as never))
      .toThrow(/must register under/)
    expect(() => service.registerAppPage('demo', { ...wrong, name: 'entry', url: '/apps/demo/entry' } as never)).not.toThrow()
  })
})

describe('工具前缀与应用作用域（§3.4.3、§3.1）', () => {  it('页面工具对外名 = <toolPrefix>__<本地名>', () => {
    expect(externalToolName('review_workbench', 'read_diff')).toBe('review_workbench__read_diff')
  })

  it('挂载可验证：挂载记录在会话名下，DSH 本体直达', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const mounted = sessions.mounted.get(opened.sessionId) ?? []
    expect(mounted.map((tool) => tool.name)).toEqual(['demo__read'])
    expect(mounted[0]?.execute).toBeTypeOf('function')
    expect(sessions.destroyed).toHaveLength(0)
  })

  it('复用会话（提升路径）：不建会话、不落 PAGE 块，块随返回值交给首回合', async () => {
    const { service, sessions, kv } = makeService()
    // 复用目标：一条已存在的普通会话（GUI 里的"未命名"会话）
    // / the reuse target: an existing ordinary session (the GUI's blank session)
    const sessionId = 'session-existing'
    const opened = await service.openUrl('/apps/demo/task/1', { reuseSessionId: sessionId, focus: false })
    expect(opened.sessionId).toBe(sessionId)
    // 没有调用会话端口的 create（不新建会话）/ the session port's create is never called
    expect(sessions.created).not.toContain(sessionId)
    // 页面工具照样挂到该会话 / page tools still mount on that session
    expect(sessions.mounted.get(sessionId)?.map((tool) => tool.name)).toEqual(['demo__read'])
    // PAGE 块不落日志（由首回合的 pre-step 注入本轮决策），随返回值交付
    // / the PAGE block is not appended (the first turn's pre-step injects it into
    // the decision) and travels in the result instead
    expect(opened.block).toContain('PAGE demo/task /apps/demo/task/1')
    expect(sessions.messages.get(sessionId) ?? []).toEqual([])
    // 实例索引照样翻 live，URL 指向这条会话 / the index still flips live on this session
    expect(kv.map.get('/apps/demo/task/1')?.state).toBe('live')
    expect(kv.map.get('/apps/demo/task/1')?.sessionId).toBe(sessionId)
  })

  it('复用会话失败不销毁用户的会话（回滚只摘工具与索引行）', async () => {
    const { service, sessions } = makeService()
    // 让挂载阶段失败：mountTools 抛错 → 复用路径的回滚
    // / fail at the mount stage so the reuse path's rollback runs
    const sessionId = 'session-existing'
    sessions.failMount(new Error('boom'))
    await expect(service.openUrl('/apps/demo/task/1', { reuseSessionId: sessionId, focus: false }))
      .rejects.toBeDefined()
    expect(sessions.destroyed).not.toContain(sessionId)
  })

  it('组件动态注册：ctx.tools.register 的产物与目录工具一次挂载（都改外名）', async () => {
    const { service, sessions } = makeService()
    // 组件体内动态注册一个动作工具（RFC §5.4 动态面）
    // / a component body registering an action tool dynamically (RFC §5.4's dynamic face)
    const registration = defineComponentPage(
      (_props, ctx) => {
        ctx.tools.register(defineTool({
          name: 'extra_action',
          description: '动作工具',
          parameters: {},
          output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
          execute: async () => ({ ok: true }),
        }))
        return createElement('p', { children: '动态工具页' })
      },
      { url: '/apps/demo/dynamic', description: '动态工具页' },
    )
    service.registerAppPage('demo', registration.page, registration.live)
    const opened = await service.openUrl('/apps/demo/dynamic')
    const mounted = sessions.mounted.get(opened.sessionId) ?? []
    expect(mounted.map((tool) => tool.name)).toEqual(['demo__extra_action'])
  })
})

describe('缺口 1/4 收尾：通知投递泵、reserved 清扫', () => {
  /** 带投递面的装配 / assembly with a delivery face */
  function makeWithDelivery(notices: Array<{ deliveryId: string; text: string }>) {
    const harness = makeService()
    const marked: Array<{ id: string; error?: string }> = []
    // 绑定后的端口集（含投递面）原样回传，后续整体重传时不丢面
    // the bound port set (with the delivery face) is returned so later
    // wholesale rebinds never drop a face
    const ports = { ...harness.ports, deliveries: {
      pending: async () => notices,
      mark: async (id: string, error?: string) => { marked.push({ id, error }) },
    } }
    harness.service.bindPorts(ports)
    return { ...harness, ports, marked }
  }

  it('新会话启动即注入收件箱通知，并回报 delivered（§5.2 inbox）', async () => {
    const { service, sessions, marked } = makeWithDelivery([
      { deliveryId: 'd-1', text: '[task-center] 任务 A' },
      { deliveryId: 'd-2', text: '[task-center] 任务 B' },
    ])
    const opened = await service.openUrl('/apps/demo/task/1')
    const messages = sessions.messages.get(opened.sessionId) ?? []
    expect(messages.filter((m) => m.includes('[task-center]'))).toHaveLength(2)
    expect(marked).toEqual([{ id: 'd-1' }, { id: 'd-2' }])
  })

  it('注入失败保持 pending 并带原因，不阻塞页面打开（§4.5 降级）', async () => {
    const { service, sessions, ports, marked } = makeWithDelivery([{ deliveryId: 'd-1', text: 'x' }])
    // 会话端口假件没有 appendUserMessage 失败注入口：直接把 sessions 换成会抛的
    // （端口整体重传，纯参数）/ rebind wholesale with a failing session port
    service.bindPorts({
      ...ports,
      sessions: {
        ...sessions.port,
        appendUserMessage: async (_id, _text, source) => {
          // 只让通知注入失败，PAGE 块照常写入 / fail only the notice append
          if (source === 'task-center/notice') throw new Error('agent gone')
        },
      },
    })
    const opened = await service.openUrl('/apps/demo/task/1')
    expect(marked).toEqual([{ id: 'd-1', error: 'agent gone' }])
  })

  it('sweepReserved：会话不在的 reserved 行删除；live 行不动；无探测不动', async () => {
    const { service, sessions, kv } = makeService()
    await service.openUrl('/apps/demo/task/1')
    // 手工塞一条 reserved 幽灵行 / plant a ghost reserved row
    kv.map.set('/apps/demo/task/ghost', {
      url: '/apps/demo/task/ghost' as never, state: 'reserved', appId: 'demo',
      page: 'demo/task', sessionId: 's-missing', instanceTitle: 'x',
      params: {}, appVersion: '1', createdAt: 't', lastOpenedAt: 't',
    })
    const dropped = await service.instances.sweepReserved()
    expect(dropped).toEqual(['/apps/demo/task/ghost'])
    expect(kv.map.has('/apps/demo/task/1')).toBe(true)
    void sessions
  })
})
