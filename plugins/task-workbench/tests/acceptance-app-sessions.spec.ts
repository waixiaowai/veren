/**
 * 第 1 阶段验收 · 场景 1–4（docs/application-concept.cn.md §8.1）：应用可发现、
 * 两条 URL 两条会话、整机重启（真实落盘）后索引与重开语义、删除会话后的重建。
 * 与 page-registry 单测里的"内存 KV 重启"不同：这里走**真实持久化文件**——
 * 真实 storage 栈（json backend）落在临时目录，会话目录也是落盘的 JSON 文件；
 * "重启" = 整个 Context（含存储栈）销毁后在新 Context 上重开同一个目录。
 * Phase-1 acceptance, scenarios 1–4 (§8.1): app discovery, one session per
 * url, the restart (real persisted files) semantics, and the rebuild after a
 * deleted session. Unlike the in-memory-kv "restart" in page-registry unit
 * tests, these use real persisted files: the real storage stack (json backend)
 * under a temp dir, plus a file-backed session directory; "restart" = dispose
 * the whole Context (storage stack included) and boot a fresh one on the same
 * dir. No in-memory stand-ins.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, disposeTrackedBoot, flush, open, tempRoot } from './helpers/acceptance-boot.ts'

afterEach(async () => { await disposeTrackedBoot() })

// ---- 场景 1 ----

describe('场景 1：装示例应用 → 可发现、入口可解析、预设零新增', () => {
  it('app 目录含 task-workbench；入口 URL 可解析；没有 presets 服务/条目', async () => {
    const { ctx, apps, pages } = await boot(tempRoot())
    const record = apps.catalog().find((app) => app.definition.id === 'task-workbench')
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('task_workbench')
    // 入口 URL 可被 openUrl 解析（解析 = 建实例会话成功）
    const opened = await pages.openUrl('/apps/task-workbench/list')
    expect(opened.sessionId).toBeTypeOf('string')
    // 预设选择器零新增：装配里不存在 presets 服务；四个插件的注册路径全部
    // 走 ctx.apps / ctx.pageRegistry / ctx.taskCenter，没有任何预设注册调用
    // （grep 层面见 docs/phase1-acceptance.cn.md 的核对记录）。
    expect(ctx.get('presets' as never)).toBeUndefined()
  })
})

// ---- 场景 2 ----

describe('场景 2：/task/1 → 会话 A；/task/2 → 会话 B；A 原样保留', () => {
  it('两条 URL 两条会话；A 的工具和消息不被 B 影响', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    // v2 队列权威在中心：先落一条工作单，详情页首屏消息才能携带它
    // / v2 keeps the queue's authority in the center: seed one order so the detail first-screen message can carry it
    await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '示例任务 1',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const a = await open(pages, 't-1')
    const b = await open(pages, 't-2')
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(store.titles()).toContain('任务 #t-1')
    // A 的工具仍挂着（键 = task_workbench__* 且带会话分组的实现按名字记录）
    expect([...tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
    // A 的 PAGE 块还在，且首屏消息携带中心真身（含标题；投影正文随重建对齐）
    // / A's PAGE block is intact, and the first-screen message carries the center's real body (title included)
    const pageBlockA = store.messages(a.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockA).toBeDefined()
    await flush()
    expect(store.messages(a.sessionId).some((m) => m.includes('中心真身') && m.includes('示例任务 1'))).toBe(true)
  })
})

// ---- 场景 3（§9.1 反转后语义：重开 = 新建 + 旧废弃）----

describe('场景 3：整机重启（真实落盘）→ 索引仍指向最新活会话；重开新建并废弃旧会话', () => {
  it('销毁整个 Context（含存储栈）后重开同一目录：索引指针跨重启保留、指向最新活会话；再开一次新建且旧会话标废弃', async () => {
    const root = tempRoot()
    const first = await boot(root)
    // 先落一条工作单（顺带证明记录跨重启持久）/ seed one order (also proves records survive the restart)
    await first.tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '示例任务 1',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const a = await open(first.pages, 't-1')
    await first.stop() // 真实销毁：存储域关闭、fiber 逆序卸载

    const second = await boot(root) // 同一目录重开 = 重启后的宿主
    // 重启后：URL 索引行还在且指向 a（宿主恢复了会话目录，a 仍是"最新活会话"）
    const rows = await second.pages.instances.listByApp('task-workbench')
    const pointer = rows.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')
    expect(pointer?.sessionId).toBe(a.sessionId)
    expect(pointer?.state).toBe('live')
    // 但打开不再复用：新建会话 B；索引改指 B；a 落废弃历史，不会被误当活的
    const b = await open(second.pages, 't-1')
    expect(b.sessionId).not.toBe(a.sessionId)
    const after = await second.pages.instances.listByApp('task-workbench')
    expect(after.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')?.sessionId).toBe(b.sessionId)
    const deprecatedRow = after.find((row) => row.state === 'deprecated' && row.sessionId === a.sessionId)
    expect(deprecatedRow?.state).toBe('deprecated')
    // 新会话的 PAGE 块与页面工具照常；首屏消息携带中心真身
    // / the fresh session's PAGE block and tools are in place; the first-screen message carries the center's real body
    const pageBlockB = second.store.messages(b.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockB).toBeDefined()
    await flush()
    expect(second.store.messages(b.sessionId).some((m) => m.includes('中心真身') && m.includes('示例任务 1'))).toBe(true)
    expect([...second.tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
  })
})

// ---- 场景 4 ----

describe('场景 4：删除会话 A → /task/1 重建新会话，工具正常', () => {
  it('索引失效、重建会话 C；旧会话消失', async () => {
    const { pages, store, tools } = await boot(tempRoot())
    const a = await open(pages, '1')
    store.dsh.get(a.sessionId)!.dispose() // 用户删除会话 A（落盘）
    const c = await open(pages, '1')
    expect(c.sessionId).not.toBe(a.sessionId)
    expect(store.alive(a.sessionId)).toBe(false)
    expect(store.alive(c.sessionId)).toBe(true)
    expect([...tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
  })
})
